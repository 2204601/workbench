# 設計

Platform の [Architecture Standard](../../../desktop-platform/standards/architecture.md) に沿う。ここにはこのツール固有の境界だけを書く。振る舞いは [SPEC.md](SPEC.md)。

## 1. 方針

- **編集はフロントだけが持つ**。プロジェクト（`src/lib/project.ts`）は zustand の store にあり、変えるたびに新しいオブジェクトを作る（取り消しは前のオブジェクトを並べておくだけ）。Rust は編集の状態を持たない
- **Rust は ffmpeg を動かすだけ**：ファイルを読む（probe）、サムネイル・波形・プレビュー用のコピーを作る、書き出す。どれも同梱の ffmpeg を別のプロセスで動かす
- **プレビューと書き出しの見た目を合わせる**
  - 文字とスタンプは `overlayRender.ts` が canvas に描いた絵を、プレビューはそのまま、書き出しは PNG にして ffmpeg に重ねさせる。フォントや絵文字の違いが出ない
  - アニメーション（`anim.ts`）と切り替え（`transitions.ts`）は、ffmpeg の式と `xfade` に合わせて描く。片方を変えたら、もう片方も変える（`anim.test.ts` と `render.rs` のテストは同じ時刻の値を見る）
  - 時間はフレームで数え、`timeline.ts` の `layout` と `render.rs` の `frames` は同じ丸め方をする（同じ例でテストしている）
- ファイルに書くのは、プロジェクト（ユーザーが選んだ `.vstudio` だけ）、書き出し（ユーザーが選んだ `.mp4`）、キャッシュ（サムネイル、波形、コピー）、設定、ログ

## 2. 層

| 層 | 中身 |
|---|---|
| shell | proxy、updater、log の配線、single-instance、window-state、settings.json（Disk Analyzer から写した。desktop-base ができたら差し替える） |
| core | ffmpeg（`ffmpeg.rs`）、素材の下ごしらえ（`media.rs`）、書き出し（`render.rs`）。フロントでは `project.ts`、`timeline.ts`、`anim.ts` |
| features | タイムライン、プレビュー、左のパネル、右の設定、書き出しのダイアログ |

## 3. ディレクトリ

```text
video-studio/
  scripts/fetch-ffmpeg.mjs     同梱の ffmpeg を取ってくる（ffmpeg-static b6.1.1、SHA-256 で固定）
  src/
    store.ts                   プロジェクトと取り消しの履歴、選択、再生位置、素材の下ごしらえの状態、書き出し中
    lib/project.ts             プロジェクトの形、読み込み（古い形の補い）
    lib/timeline.ts            layout（どのクリップがいつ）、分割・削除・並べ替え・切り詰め、文字の段
    lib/player.ts              プレビュー：<video> をクリップごとに、canvas に描く、再生の時計
    lib/source.ts              素材の表示の範囲（開始点・終了点）、使っている部分（純粋関数）
    lib/sourcePlayer.ts        素材の表示：開いている動画の <video>、再生、範囲を決める
    lib/transitions.ts         切り替えを canvas に描く（xfade と同じ向きとぼかし）
    lib/anim.ts                文字・スタンプの出し方（render.rs の式と同じ）
    lib/overlayRender.ts       文字・スタンプを canvas に描く。絵はキャッシュ
    lib/images.ts              写真を Rust 経由で読んで ImageBitmap に（EXIF の向き）
    lib/media.ts               追加（probe）、下ごしらえ、開いたプロジェクトの素材の確認
    lib/exportJob.ts           書き出しのジョブ（写真と文字は PNG に）
    lib/actions.ts             操作（コマンドとボタンから呼ぶ）
    lib/commands.ts            コマンド表（メニュー、キー、ショートカット一覧の元）
    components/                Timeline、Preview、LeftPanel、Inspector、ExportDialog ほか
    dev/mockBackend.ts         ブラウザ開発用モック（ファイルは blob URL、書き出しはできない）
  src-tauri/src/
    lib.rs                     plugin の配線、setup、終わるときに ffmpeg を止める
    commands.rs                フロントから呼ぶコマンド
    ffmpeg.rs                  ffmpeg の場所、probe（-i の出力を読む）、run（進み具合と中止）
    media.rs                   サムネイル・波形・コピー、再生できるかの判定、キャッシュの場所
    render.rs                  書き出しのフィルタグラフと引数、export
  src-tauri/tests/ipc.rs       IPC 越しに probe → prepare → export を本物の ffmpeg で
  src-tauri/examples/export.rs 画面なしで書き出す（ジョブの JSON から）
```

## 4. コマンド

| コマンド | 引数 | 返す |
|---|---|---|
| `probe_media` | `path` | 種類、長さ、大きさ（回転を反映）、fps、音の有無、形式とコーデック。ページがそのファイルを読めるようにする（asset protocol の scope） |
| `prepare_media` | `id`, `path`, `forceProxy` | サムネイル、波形、プレビュー用のコピー（要るときだけ）のパス。実行中は `media-progress`。同時に 2 つまで |
| `read_image` | `path` | 写真のバイト列（`probe_media` したものだけ） |
| `export_video` | `job`, `output` | 書き出したパスとかかった時間。実行中は `export-progress`。同時に 1 つ |
| `cancel_export` | | |
| `save_project` / `load_project` | `path`(, `text`) | `.vstudio` だけ |
| `reveal_path` / `ffmpeg_version` | | |
| `get_app_settings` / `set_app_settings` / `system_proxy` / `reveal_log` | | shell |

## 5. 書き出しのフィルタグラフ（render.rs）

1. クリップごとに入力を 1 つ。動画は `-ss 開始 -t 長さ` で入力の側で切る（速くてフレーム単位で正確）。写真は PNG を `-loop 1`
2. 各クリップを `fps`、画面に合わせる（`scale` + `pad` か `crop`）、`tpad`（足りないときは最後のコマを延ばす）、`trim=end_frame`、`settb=1/fps`。音は 48 kHz ステレオにして `apad` + `atrim=end_sample`（音のない素材は `anullsrc`）。映像と音がサンプル単位で同じ長さになる
3. 前から順に、切り替えがあれば `xfade` + `acrossfade`、なければ `concat`（出力の時間の単位を `settb` で揃える）
4. 文字・スタンプは PNG を `-loop 1` で入力にし、`fade`（透明度）と `scale`（ポップ、`eval=frame`）、`overlay` の `x` `y` の式（スライド・ライズ）、`enable=between(t,開始,終了)`
5. グラフはファイルに書いて `-filter_complex_script`（Windows のコマンドラインの長さの上限を避ける）

切り替えの名前は `TRANSITIONS` にあるものだけを通す。数字は有限の値だけ。パスは引数として渡す（シェルを通さない）。

## 6. プレビュー（player.ts）

- 再生位置のまわりのクリップ（前 1、後ろ 2）にだけ `<video>` を持ち、ほかは手放す。次のクリップは最初のコマで待たせておく
- 再生は壁時計で進め、動画が 0.25 秒以上ずれたら合わせる。読み込み中の動画があれば時計を最大 1.5 秒止める
- 描くのは再生中は毎フレーム、止まっているときは変わったとき（プロジェクト、素材、選択、シーク）だけ
- canvas の大きさは表示の大きさ × devicePixelRatio（プロジェクトの大きさまで）

## 7. テスト

- `ffmpeg.rs`：ffmpeg の出力の読み取り（スマホの縦動画、写真、音楽ファイル）
- `media.rs`：再生できるかの判定、サムネイルの数
- `render.rs`：フレームの丸め、xfade / concat のつなぎ方、アニメーションの式、危ない値を断る
- `tests/ipc.rs`：本物の ffmpeg で、テスト用の動画を作って probe → prepare → export（切り替え 2 つ、写真、文字 2 つ）→ 書き出したものを probe（大きさ、長さ、音）
- `timeline.test.ts`、`anim.test.ts`、`source.test.ts`（vitest）：layout、分割、削除、並べ替え、切り詰め、段、アニメーションの値
- UI はブラウザのモック（`npm run dev`）で確かめる。モックの書き出しは、作ったジョブを `window.lastExportJob` に残す。動画のパスを本物に置き換えれば `examples/export.rs` で書き出せる

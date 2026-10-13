# Cutter

動画を切って貼って、文字やスタンプを重ね、つなぎ目に切り替えを入れて MP4 に書き出す、かんたんな動画編集アプリ（Tauri 2 / Windows・macOS）。

## できること

- **キリはり**：動画や写真を追加するとタイムラインに順に並ぶ。再生位置で分割（S）、いらない部分を選んで削除（Delete）、端をドラッグして切り詰め、ドラッグで並べ替え、コピー・ペースト・複製。取り消し（⌘Z）とやり直し（⌘⇧Z）
- **文字**：プリセット 7 種（タイトル、テロップ、強調、吹き出し、やわらか、明朝、左から）。フォント・大きさ・色・ふち・背景の帯・位置・回転を変えられる。改行もできる
- **スタンプ**：絵文字 50 種と、図形 8 種（矢印、丸・四角で囲む、吹き出し、星、ハート、チェック、バツ）。図形は色を選べる
- **出し方・消し方**：フェード、ポップ（弾むように拡大）、下から / 上へ、左から / 右へ
- **切り替え**：クロスフェード、黒・白を挟む、ワイプ（4 方向）、スライド（4 方向）、円で開く・閉じる。長さも変えられる
- **書き出し**：MP4（H.264 / AAC）。1080p・720p、画質 3 段階、24 / 30 / 60 fps
- 画面の形：横長 16:9、縦長 9:16、正方形 1:1（最初に入れた動画の向きで決まり、あとから変えられる）。形が違う素材は「全体を見せる（黒帯）」か「画面を埋める（はみ出しを切る）」
- クリップごとの音量・消音
- プロジェクトの保存（`.cutter`）。素材のファイルは保存したパスから読むので、動かさない

詳しくは [docs/SPEC.md](docs/SPEC.md)。

## 使い方

1. 動画や写真をウィンドウにドロップする（左の「動画・写真を追加」でも）
2. タイムラインのいらない部分を、再生位置で分割（S）して選んで削除（Delete）。端のドラッグでも切り詰められる
3. クリップの境目の ◇ を押して、左の「切り替え」から選ぶ
4. 「テキスト」「スタンプ」を押すと再生位置に入る。プレビューの上でドラッグして動かし、角で大きさ、上の丸で回転
5. 右上の「書き出す」

## キーボード

Windows は ⌘ → Ctrl。

| キー | 操作 |
|---|---|
| スペース | 再生 / 一時停止 |
| ← → | 1 コマ戻る / 進む |
| ⇧← ⇧→ | 1 秒戻る / 進む |
| ↑ ↓ | 前 / 次のつなぎ目へ |
| Home / End | 先頭 / 最後へ |
| S、⌘B | 再生位置で分割 |
| Delete、⌫ | 選んだものを削除 |
| ⌘C / ⌘X / ⌘V | コピー / カット / ペースト |
| ⌘D | 複製 |
| T | 文字を入れる |
| ⌘Z / ⌘⇧Z | 取り消す / やり直す |
| ⌘= / ⌘- / ⌘0 | タイムラインの拡大 / 縮小 / 全体（⌘ + ホイールでも） |
| ⌘N / ⌘O / ⌘S / ⌘⇧S | 新規 / 開く / 保存 / 別名で保存 |
| ⌘I | 動画・写真を追加 |
| ⌘E | 書き出す |
| ⌘, | 設定 |
| ? | ショートカット一覧 |

## インストール

[Releases](https://github.com/2204601/workbench/releases?q=cutter) から入れる。Apple や Microsoft の署名をしていないので、**初回だけ** 警告が出る。

- **Windows**：`-setup.exe` を実行 → SmartScreen が出たら「詳細情報」→「実行」
- **macOS**：`.dmg` を開いて「アプリケーション」へコピー → 起動すると「開発元を検証できない」と出るので「完了」→ **システム設定 › プライバシーとセキュリティ** の下にある「このまま開く」。ターミナルで `xattr -dr com.apple.quarantine /Applications/Cutter.app` でもよい

## アップデート

起動して数秒後に新しいバージョンを確かめ、あればダイアログで知らせる。「更新して再起動」で入れ替わる。手動では **Cutter › アップデートを確認…**（Windows は **ヘルプ › アップデートを確認…**）。自動の確認は設定（⌘,）で止められる。

## 再生できない動画

iPhone の HEVC（Windows）、AVCHD（.mts）、ProRes、10bit の H.264 など、ウィンドウがそのまま再生できない動画は、追加したときにプレビュー用の軽いコピー（720p）を作る（素材の一覧に「準備中 xx%」）。書き出しはいつも元のファイルから行うので、画質は落ちない。コピーとサムネイルは次の場所に残り、消しても次に開いたとき作り直す。

- macOS：`~/Library/Caches/dev.workbench.cutter/media`
- Windows：`%LOCALAPPDATA%\dev.workbench.cutter\media`

## ffmpeg について

読み込み、サムネイル、プレビュー用のコピー、書き出しは、アプリに同梱した [ffmpeg](https://ffmpeg.org/) 6.1.1（[ffmpeg-static](https://github.com/eugeneware/ffmpeg-static) の配布物）で行う。この ffmpeg は libx264 を含む **GPL** の build で、アプリとは別の実行ファイルとして同梱している。ffmpeg のライセンスとソースは ffmpeg-static のリリース（`b6.1.1`）にある。

## ログ

**ヘルプ › ログを表示** で開く。起動時の ffmpeg の版、書き出しの結果、ffmpeg が失敗したときのコマンドとエラーが残る。

- macOS：`~/Library/Logs/dev.workbench.cutter/cutter.log`
- Windows：`%LOCALAPPDATA%\dev.workbench.cutter\logs\cutter.log`

## 開発

開発の基準は [desktop-platform](https://github.com/jazmf-dx/desktop-platform) に従う。前提は [decisions/project-context.md](decisions/project-context.md)。コマンドは `cutter/` で実行する。

```bash
npm install
npm run ffmpeg         # ffmpeg を src-tauri/binaries/ に置く（初回だけ。tauri の build に要る）
npm run tauri dev      # アプリを起動
npm run dev            # ブラウザで UI だけ（モック。src/dev/mockBackend.ts。書き出しはできない）
npm test               # cargo test（本物の ffmpeg で書き出しまで）+ tsc --noEmit + vitest
npm run lint           # eslint + cargo fmt --check + clippy
cargo run --release --example export --manifest-path src-tauri/Cargo.toml -- job.json out.mp4   # 画面なしで書き出す
```

- 手元の ffmpeg を使うときは `FFMPEG_BIN=/usr/bin/ffmpeg npm run ffmpeg`
- Linux で Rust をビルドするには `libwebkit2gtk-4.1-dev` などが要る（CI の `test` job と同じ）
- ブラウザ版（`npm run dev`）は Chromium の制限で H.264 を再生できないことがある。WebM（VP9）の動画で試す

## 構成

| 場所 | 中身 |
|---|---|
| `src/lib/project.ts` | プロジェクトの形（素材、クリップ、文字・スタンプ） |
| `src/lib/timeline.ts` | 時間の計算と、タイムラインの編集（分割、削除、並べ替え、切り詰め）。フレーム単位の丸めは `render.rs` と同じ |
| `src/lib/player.ts` | プレビュー（canvas に描く、再生） |
| `src/lib/transitions.ts`、`anim.ts` | 切り替えと、文字・スタンプの出し方の描き方。書き出しの ffmpeg と同じ見た目になるように合わせてある |
| `src/lib/overlayRender.ts`、`stamps.ts` | 文字とスタンプを絵にする（プレビューも書き出しも同じ絵を使う） |
| `src/lib/exportJob.ts` | 書き出しのジョブを作る |
| `src/components/` | タイムライン、プレビュー、左のパネル、右の設定、書き出しのダイアログ |
| `src-tauri/src/ffmpeg.rs` | ffmpeg の場所、ファイルの中身を読む、進み具合と中止 |
| `src-tauri/src/media.rs` | サムネイル、波形、プレビュー用のコピー |
| `src-tauri/src/render.rs` | 書き出し（ffmpeg のフィルタを組み立てる） |
| `src-tauri/tests/ipc.rs` | コマンドを JS と同じ引数で呼び、本物の ffmpeg で書き出すテスト |
| `scripts/fetch-ffmpeg.mjs` | 同梱する ffmpeg を取ってくる（版とハッシュを固定） |
| [docs/SPEC.md](docs/SPEC.md) | 機能仕様 |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | 設計 |

雛形（`proxy.rs`、`settings.rs`、`log.ts`、`titleBar.ts`、`update.ts`、`menuBar.ts`、`Toasts.tsx`、ビルド設定）は [Disk Analyzer](../disk-analyzer/) から写した。desktop-base ができたら差し替える。

## リリース

workbench の決まり（リポジトリ直下の README「リポジトリの決まりごと」）に従う。

1. バージョンを `package.json`、`src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml` の 3 か所で上げ、lockfile も更新する（`npm version X --no-git-tag-version`、`cargo update -p cutter --manifest-path src-tauri/Cargo.toml`）
2. `CHANGELOG.md` に `## <version>` の節を書く（変更点 / ダウンロード / 注意。リリースの本文になり、変更点はアップデートのダイアログにも出る）
3. `chore: cutter v<version>` を PR で `main` に入れる
4. Actions › **cutter** › **Run workflow** で `main`、`release` にチェックを入れて実行する。`cutter-v<version>` の tag を push しても同じ
5. CI が tag と version の一致、CHANGELOG の節、更新ファイルの有無を確かめ、`Cutter v<version>` のリリースを作って公開し、固定リリース `cutter-updater` の `latest.json` を差し替える

署名鍵は workbench の Secrets（`TAURI_SIGNING_PRIVATE_KEY`、`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`。ほかのツールと共有）。**`cutter-updater` のリリースと tag は消さない**（配布済みのアプリが更新を見つけられなくなる）。

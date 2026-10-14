# PDF One

PDF を見る・ページを整理する・書き込む・フォームに入力するデスクトップアプリ（Tauri 2 / Windows・macOS）。目標は Acrobat。0.1 は閲覧とページ編集、注釈、フォーム入力。0.2 で画面を **編集するためのもの** に作り直した（[docs/UX.md](docs/UX.md)）：Word に似た作業タブ、絵と言葉の付いた道具、右の「詳細」、下の案内の行。入力と署名、印鑑、印刷、下書きもこの版から。テーマは OS に合わせ、設定で文字を大きくできる。

**元のファイルは書き換えない** のが基本。最初の保存は「〜_編集.pdf」という別名を提案する。同じ名前を選んで上書きしたときは、上書き前の版をバックアップに残す。

## 機能

- **開く**：⌘O、ドロップ、「このアプリで開く」、ダブルクリック（PDF の既定のアプリにした場合）。タブでいくつでも並べて開ける。最近使ったファイルはスタート画面に
- **見る**：幅に合わせる・ページ全体・拡大縮小（⌘ + ホイールやピンチでも）、回転して見る（ファイルは変えない）、ページ番号で移動、左の一覧（ページ・書き込み・しおり）、文字の選択とコピー、リンク
- **検索**（⌘F）：大文字小文字、全角半角（ＡＢＣ＝ABC、ｶﾀｶﾅ＝カタカナ）、空白の違いは無視して探す
- **ページ**（「すべてのページを並べる」⌘⇧O）：サムネイルを並べてドラッグで並べ替え、回転、削除、白紙を足す、別の PDF のページを足す（結合）、選んだページを抜き出す（抽出）、N ページずつの分割。左の一覧でも同じことができる
- **書き込み**：マーカー・下線・取り消し線（文字を選ぶ。文字の無いスキャン PDF は範囲をドラッグ）、文字を置く、付箋（コメント）、ペン（消しゴムで線ごとに消せる）、四角・丸・線・矢印、印鑑・画像。選んで動かす・大きさを変える・色や太さ・濃さを右の「詳細」で変える・コメントを書く。⌘D で複製。図形や文字は 1 回置くと「選択」に戻る（「続けて置く」で戻らない）
- **文字を直す**（「文字と画像」タブ）：PDF にもともとある文字（Word などから出した、文字の情報が入っているもの）を、行ごとにクリックして打ち直す。保存すると、もとの文字はファイルから消え、新しい文字が同じ場所に、もとのフォントで書かれる（そのフォントに無い文字だけ日本語フォント）。直せない行は理由を案内する
- **印鑑・画像**：PNG / JPEG を置く（ファイル、ドロップ、⌘V で貼り付け）。よく使う印鑑や署名は「ライブラリ」に入れておける。背景が透明な PNG がよい。**日付印**（部署・日付・名前の 3 段）と **文字の印**（承認済み、社外秘…）はその場で作れ、線と文字で描くので拡大してもきれい、あとから文字も直せる
- **入力と署名**：入力欄の無い PDF にも書き入れる。記入（枠なしの文字）、チェック・バツ・黒丸・横線、今日の日付、手書きの署名（書いてライブラリに入れ、どの PDF にも置ける）
- **フォーム入力**：PDF の入力欄（テキスト、チェック、ラジオ、選択）にそのまま入力して保存。開いたとき「入力欄があります」と知らせる
- **元に戻す**：ページと書き込みの変更は ⌘Z / ⌘⇧Z で戻せる（100 回まで）
- **保存**：⌘S、⌘⇧S。最初の保存で「新しいファイルとして保存 / 元のファイルに上書き」を選ぶ。書き込みは PDF の標準の注釈として書くので、Acrobat や Edge、プレビューでもそのまま見えて、Acrobat で編集もできる
- **下書き**：保存していない変更は 30 秒ごとに下書きに残る。アプリが急に終わっても、次の起動で「戻す」
- **印刷**（⌘P）：ページの範囲、用紙、用紙に合わせる、1 枚に 2 ページ、向き。プリンター・部数・両面は OS の画面で
- **使い方**（F1）：アプリの中に、作業ごとの手順
- **何をしますか**：作業タブの右端に言葉を打つと（「ハンコ」「結合」「小さく」）、合う操作が並ぶ

詳しくは [docs/SPEC.md](docs/SPEC.md)。

### 日本語の文字について

テキストボックスとフォームに入れた文字は、パソコンの日本語フォント（Windows は游ゴシック、macOS はヒラギノ角ゴシック）を **PDF に埋め込んで** 保存する。使った文字だけを埋め込むので、ファイルは数 KB〜数十 KB しか増えない。どのパソコンで開いても同じ文字で見える。

### できないこと

- PDF にもともとある文字の書き換えは、文字の情報が入っている PDF の、横書きの行だけ（もとのフォントに無い文字は日本語フォントになる）。画像になっている文字（スキャン）、縦書き、斜めの文字は直せない（[docs/SPEC.md](docs/SPEC.md) §6「文字を直す」）
- パスワードや権限で保護された PDF の編集（表示だけ）、XFA フォーム
- 電子署名のある PDF を保存すると、署名は無効になる（保存の前に確認が出る）

## キーボード

Windows は ⌘ → Ctrl、⌥ → Alt。

| キー | 操作 |
|---|---|
| ⌘O | 開く |
| ⌘S / ⌘⇧S | 保存 / 名前を付けて保存 |
| ⌘P | 印刷 |
| ⌘W | タブを閉じる |
| ⌘Z / ⌘⇧Z（⌘Y） | 元に戻す / やり直す |
| ⌘F、⌘G / ⌘⇧G | 検索、次 / 前 |
| ⌘+ / ⌘- | 拡大 / 縮小 |
| ⌘0 / ⌘1 / ⌘2 | ページ全体 / 100% / 幅に合わせる |
| ← → 、PageUp / PageDown、Home / End | 前後のページ、最初 / 最後のページ |
| F4 | 左の一覧（ページ・書き込み・しおり） |
| ⌘⇧O | すべてのページを並べる |
| ⌘⇧R / ⌘⇧L | ページを右 / 左に回転 |
| ⌘⇧I | ファイルからページを足す |
| V / H | 選択 / 手のひら（スペースを押しながらドラッグでも動かせる） |
| M / U / K | マーカー / 下線 / 取り消し線 |
| T / N / P / E | 文字を置く / 付箋 / ペン / 消しゴム |
| R / O / L / A | 四角 / 丸 / 線 / 矢印 |
| I | 印鑑・画像 |
| Delete、⌫ | 選んだ書き込みを削除（左の一覧や「すべてのページ」では選んだページを削除） |
| ⌘D | 選んだ書き込みを複製 |
| 矢印（⇧ で 10 倍） | 選んだ書き込みを動かす |
| Esc | 選択を解除 / 「選択」に戻す |
| ⌘, | 設定 |
| F1 | 使い方 |
| ? | ショートカット一覧 |

図形を描くとき ⇧ を押すと、正方形・正円・45° 刻みの線になる。

## データの置き場所

| もの | 場所 |
|---|---|
| 設定（作成者名、アップデートの自動確認、最近使ったファイル、見た案内） | macOS：`~/Library/Application Support/dev.workbench.pdf-one/settings.json`、Windows：`%APPDATA%\dev.workbench.pdf-one\settings.json` |
| 上書き前のバックアップ（新しい 30 個） | macOS：`~/Library/Application Support/dev.workbench.pdf-one/backups/`、Windows：`%APPDATA%\dev.workbench.pdf-one\backups\`。**ファイル › バックアップのフォルダを開く** |
| 印鑑・署名のライブラリ | 同じフォルダの `stamps/` |
| 下書き（保存していない変更。30 秒ごと） | 同じフォルダの `drafts/`。保存するか「保存しない」で閉じると消える |

## インストール

[Releases](https://github.com/2204601/workbench/releases?q=pdf-one) から入れる。Apple や Microsoft の署名をしていないので、**初回だけ** 警告が出る。

- **Windows**：`-setup.exe` を実行 → SmartScreen が出たら「詳細情報」→「実行」
- **macOS**：`.dmg` を開いて「アプリケーション」へコピー → 起動すると「開発元を検証できない」と出るので「完了」→ **システム設定 › プライバシーとセキュリティ** の下にある「このまま開く」。ターミナルで `xattr -dr com.apple.quarantine "/Applications/PDF One.app"` でもよい

PDF をダブルクリックで開きたいときは、PDF の「プログラムから開く」（macOS は「情報を見る › このアプリケーションで開く」）で PDF One を既定にする。

## アップデート

起動して数秒後に新しいバージョンを確かめ、あればダイアログで知らせる。「更新して再起動」で入れ替わる（2 回目以降は警告が出ない）。手動では **PDF One › アップデートを確認…**（Windows は **ヘルプ › アップデートを確認…**）。自動の確認は設定（⌘,）で止められる。

## ログ

**ヘルプ › ログを表示** で開く。開いたファイル、保存したファイル、エラーが残る（ファイルの中身は残さない）。

- macOS：`~/Library/Logs/dev.workbench.pdf-one/pdf-one.log`
- Windows：`%LOCALAPPDATA%\dev.workbench.pdf-one\logs\pdf-one.log`

## 開発

開発の基準は [desktop-platform](https://github.com/jazmf-dx/desktop-platform) に従う。前提は [decisions/project-context.md](decisions/project-context.md)。コマンドは `pdf-one/` で実行する。

```bash
npm install
npm run tauri dev      # アプリを起動
npm run dev            # ブラウザで UI だけ（モック。src/dev/mockBackend.ts。どのファイルを開いても同じ見本）
npm test               # cargo test + tsc --noEmit
npm run lint           # eslint + cargo fmt --check + clippy
cargo run --example sample --manifest-path src-tauri/Cargo.toml -- <in.pdf|-> <out.pdf> [画像.png]   # 注釈を 1 つずつ書いた PDF を作る（ほかのビューアでの見え方の確認用）
```

Linux で Rust をビルドするには `libwebkit2gtk-4.1-dev` などが要る（CI の `test` job と同じ）。Linux でテキストを埋め込むには IPA ゴシックか Noto Sans CJK を入れる（`fonts-ipafont-gothic`）。

## 構成

| 場所 | 中身 |
|---|---|
| `src/` | React の UI。`lib/commands.ts` がコマンド表（名前と言い換え）、`lib/ribbon.ts` が作業タブの表、`lib/hints.ts` が下の案内の文、`lib/api.ts` が Rust コマンドの型付きラッパ、`lib/pdfjs.ts` が pdf.js の設定と開いている文書、`lib/geometry.ts` が PDF の座標と画面の座標の変換、`lib/seal.ts` が印鑑の文字の配置、`lib/drafts.ts` が下書き、`lib/print.ts` が印刷 |
| `src/components/` | `Viewer.tsx`（ページの並び、ズーム、スクロール）、`PageView.tsx`（1 ページ：pdf.js の絵・文字・フォームの層）、`Overlay.tsx`（書き込みの描画と道具）、`Ribbon.tsx`（作業タブと道具）、`CommandSearch.tsx`（何をしますか）、`DetailsPanel.tsx`（右の詳細）、`StatusBar.tsx`（下の案内）、`Sidebar.tsx`（左の一覧）、`Organizer.tsx`（すべてのページ） |
| `src-tauri/src/pdf/` | Rust の PDF 処理。`open.rs`（開く、注釈を取り出す）、`compose.rs`（ページを組み立てて書く）、`annots.rs`（注釈と見た目。印鑑もここ）、`forms.rs`（フォームの値）、`font.rs`（日本語フォントの埋め込み）、`image.rs`（画像） |
| `src-tauri/src/` | `commands.rs`（フロントから呼ぶコマンド）、`files.rs`（安全な書き込み、バックアップ、スタンプのライブラリ、下書き）、`lib.rs`（plugin の配線、「このアプリで開く」） |
| `src-tauri/tests/ipc.rs` | コマンドを JS と同じ引数で IPC 越しに呼ぶテスト（開く → 注釈を足して保存 → 開き直す） |
| `src-tauri/icons/` | アプリアイコン（`app-icon.svg` から `npx tauri icon` で生成） |
| [docs/SPEC.md](docs/SPEC.md) | 機能仕様 |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | 設計（PDF をどこで読み書きするか、座標、フォント、テスト） |
| [docs/ROADMAP.md](docs/ROADMAP.md) | これから（Acrobat との対応表、版ごとの計画） |
| [docs/UX.md](docs/UX.md) | 画面の決まり（編集が前提、やさしい言葉と配置） |

雛形（`proxy.rs`、`settings.rs`、`log.ts`、`titleBar.ts`、`update.ts`、`menuBar.ts`、`Toasts.tsx`、ビルド設定）は [Disk Analyzer](../disk-analyzer/) から写した。desktop-base ができたら差し替える。

## リリース

workbench の決まり（リポジトリ直下の README「リポジトリの決まりごと」、Platform Optional「複数ツール同居リポジトリ」）に従う。

1. バージョンを `package.json`、`src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml` の 3 か所で上げ、lockfile も更新する（`npm version X --no-git-tag-version`、`cargo update -p pdf-one --manifest-path src-tauri/Cargo.toml`）
2. `CHANGELOG.md` に `## <version>` の節を書く（変更点 / ダウンロード / 注意。リリースの本文になり、変更点はアップデートのダイアログにも出る）
3. `chore: pdf-one v<version>` を PR で `main` に入れる
4. Actions › **pdf-one** › **Run workflow** で `main`、`release` にチェックを入れて実行する。`pdf-one-v<version>` の tag を push しても同じ
5. CI が tag と version の一致、CHANGELOG の節、更新ファイルの有無を確かめ、`PDF One v<version>` のリリースを作って公開し、固定リリース `pdf-one-updater` の `latest.json` を差し替える。配布済みのアプリはここを見て更新する

製品名に空白があるので、CI はリリースに載せるファイル名の空白を `_` に変える（GitHub が空白を `.` に変えて、`latest.json` の URL とずれるため）。

署名鍵は workbench の Secrets（`TAURI_SIGNING_PRIVATE_KEY`、`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`。ほかのツールと共有）。**`pdf-one-updater` のリリースと tag は消さない**（配布済みのアプリが更新を見つけられなくなる）。

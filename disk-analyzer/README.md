# Disk Analyzer

ドライブやフォルダの中で、何が容量を使っているかをグラフと一覧で見るデスクトップアプリ（Tauri 2 / Windows・macOS）。macOS の DaisyDisk のような使い方を、Windows でも同じようにできる。

**見るだけ** のアプリで、ファイルを消したり動かしたりはしない。片付けは「エクスプローラーで表示」（macOS は「Finder で表示」）から行う。

## 機能

- スタート画面にドライブ（ネットワークドライブ、USB も）とホームフォルダ。使用量と空き容量が出る。任意のフォルダ（`\\server\共有\…` も）は「フォルダを選ぶ」かドロップで
- スキャン中は、見つけた容量・ファイル数・フォルダ数と、いま読んでいるフォルダを表示。中止できる
- グラフは 5 種類を切り替えられる
  - **サンバースト**：DaisyDisk と同じ形。中心から外へ深くなる
  - **ツリーマップ**：WizTree と同じ形。面積が大きさ
  - **アイシクル**：左から右へ深くなる。名前が読みやすい
  - **円グラフ**：いまのフォルダの直下だけ。横の凡例に名前・大きさ・割合
  - **棒グラフ**：いまのフォルダの直下だけ。大きい順に名前・棒・大きさ・割合。いちばん読みやすい
- 右に、いまのフォルダの中身を大きい順の一覧で。色はグラフと同じ
- フォルダを押すと中へ。パンくずや ↑ で戻る。右クリックで「開く / エクスプローラーで表示 / パスをコピー」

詳しくは [docs/SPEC.md](docs/SPEC.md)。

## 容量の数え方

- リンク（シンボリックリンク、ジャンクション）はたどらない。同じものを 2 回数えない
- OneDrive の「オンラインのみ」など、このパソコンに無いファイルは 0 として数える（数はステータスバーの「クラウドのみ」に出る）
- macOS では、ハードリンクのあるファイルは 1 回だけ数え、起動ディスクの中の別のボリュームには入らない
- アクセスの許可が無いフォルダは飛ばす（数はステータスバー、パスはログ）。C ドライブ全体のように、管理者しか読めないフォルダがある場所では、実際の使用量より少なく出る
- 単位は 1024 進（エクスプローラーと同じ）

## キーボード

Windows は ⌘ → Ctrl。

| キー | 操作 |
|---|---|
| ⌘O | フォルダを選んでスキャン |
| ⌘R | もう一度スキャン |
| ⌘1 / ⌘2 / ⌘3 / ⌘4 / ⌘5 | サンバースト / ツリーマップ / アイシクル / 円グラフ / 棒グラフ |
| ⌘↑、Backspace | 上のフォルダへ |
| ⌘⇧↑ | スキャンしたフォルダへ |
| ↑ ↓ | 一覧で選ぶ項目を動かす |
| Enter | 選んだフォルダを開く |
| Esc | 選択を解除 |
| ⌘⇧R | 選んだ項目（無ければいまのフォルダ）をエクスプローラー / Finder で表示 |
| ⌘⇧C | 選んだ項目（無ければいまのフォルダ）のパスをコピー |
| ⌘, | 設定 |
| ? | ショートカット一覧 |

## インストール

[Releases](https://github.com/2204601/workbench/releases?q=disk-analyzer) から入れる。Apple や Microsoft の署名をしていないので、**初回だけ** 警告が出る。

- **Windows**：`-setup.exe` を実行 → SmartScreen が出たら「詳細情報」→「実行」
- **macOS**：`.dmg` を開いて「アプリケーション」へコピー → 起動すると「開発元を検証できない」と出るので「完了」→ **システム設定 › プライバシーとセキュリティ** の下にある「このまま開く」。ターミナルで `xattr -dr com.apple.quarantine "/Applications/Disk Analyzer.app"` でもよい
  - 起動ディスク全体を正しく数えるには、**システム設定 › プライバシーとセキュリティ › フルディスクアクセス** で Disk Analyzer を許可する（許可しないと、メールや写真ライブラリなどが「読めないフォルダ」になる）

## アップデート

起動して数秒後に新しいバージョンを確かめ、あればダイアログで知らせる。「更新して再起動」で入れ替わる（2 回目以降は警告が出ない）。手動では **Disk Analyzer › アップデートを確認…**（Windows は **ヘルプ › アップデートを確認…**）。自動の確認は設定（⌘,）で止められる。

## ログ

**ヘルプ › ログを表示** で開く。スキャンの開始と結果、読めなかったフォルダ（最初の 20 件）が残る。

- macOS：`~/Library/Logs/dev.workbench.disk-analyzer/disk-analyzer.log`
- Windows：`%LOCALAPPDATA%\dev.workbench.disk-analyzer\logs\disk-analyzer.log`

## 開発

開発の基準は [desktop-platform](https://github.com/jazmf-dx/desktop-platform) に従う。前提は [decisions/project-context.md](decisions/project-context.md)。コマンドは `disk-analyzer/` で実行する。

```bash
npm install
npm run tauri dev      # アプリを起動
npm run dev            # ブラウザで UI だけ（モック。src/dev/mockBackend.ts）
npm test               # cargo test + tsc --noEmit
npm run lint           # eslint + cargo fmt --check + clippy
cargo run --release --example scan --manifest-path src-tauri/Cargo.toml -- <フォルダ>   # 画面なしでスキャンし、時間と上位 10 件を出す
```

Linux で Rust をビルドするには `libwebkit2gtk-4.1-dev` などが要る（CI の `test` job と同じ）。

## 構成

| 場所 | 中身 |
|---|---|
| `src/` | React の UI。`lib/commands.ts` がコマンド表、`lib/api.ts` が Rust コマンドの型付きラッパ、`lib/charts.ts` がグラフ 5 種の設定と色、`components/charts/` がレイアウトと描画 |
| `src-tauri/src/` | Rust。`lib.rs` が plugin の配線、`commands.rs` がフロントから呼ぶコマンド、`scan.rs` がスキャン、`view.rs` がグラフと一覧に渡す形、`places.rs` がドライブの一覧と空き容量、`volume.rs` がネットワークの判定 |
| `src-tauri/tests/ipc.rs` | コマンドを JS と同じ引数で IPC 越しに呼ぶテスト（Tauri のモックランタイム） |
| `src-tauri/icons/` | アプリアイコン（`app-icon.svg` から `npx tauri icon` で生成） |
| [docs/SPEC.md](docs/SPEC.md) | 機能仕様 |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | 設計（層、コマンド、ツリーの持ち方、テスト） |

雛形（`proxy.rs`、`settings.rs`、`log.ts`、`titleBar.ts`、`update.ts`、`menuBar.ts`、`Toasts.tsx`、ビルド設定）は [Renamer](../renamer/) から写した。desktop-base ができたら差し替える。

## リリース

workbench の決まり（リポジトリ直下の README「リポジトリの決まりごと」、Platform Optional「複数ツール同居リポジトリ」）に従う。

1. バージョンを `package.json`、`src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml` の 3 か所で上げ、lockfile も更新する（`npm version X --no-git-tag-version`、`cargo update -p disk-analyzer --manifest-path src-tauri/Cargo.toml`）
2. `CHANGELOG.md` に `## <version>` の節を書く（変更点 / ダウンロード / 注意。リリースの本文になり、変更点はアップデートのダイアログにも出る）
3. `chore: disk-analyzer v<version>` を PR で `main` に入れる
4. Actions › **disk-analyzer** › **Run workflow** で `main`、`release` にチェックを入れて実行する。`disk-analyzer-v<version>` の tag を push しても同じ
5. CI が tag と version の一致、CHANGELOG の節、更新ファイルの有無を確かめ、`Disk Analyzer v<version>` のリリースを作って公開し、固定リリース `disk-analyzer-updater` の `latest.json` を差し替える。配布済みのアプリはここを見て更新する

製品名に空白があるので、CI はリリースに載せるファイル名の空白を `_` に変える（GitHub が空白を `.` に変えて、`latest.json` の URL とずれるため）。

署名鍵は workbench の Secrets（`TAURI_SIGNING_PRIVATE_KEY`、`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`。Shelf・Renamer と共有）。**`disk-analyzer-updater` のリリースと tag は消さない**（配布済みのアプリが更新を見つけられなくなる）。

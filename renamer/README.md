# Renamer

フォルダの中のファイル名を、ルールに沿って一括で変えるデスクトップアプリ（Tauri 2 / Windows・macOS）。社内の共有フォルダでも安全に使えることを優先する。

> **開発中**。v0.1.0 に向けて実装している。進み具合は [docs/ROADMAP.md](docs/ROADMAP.md)。

## 機能（予定）

- ルール 4 種：置換・正規表現、連番・テンプレート、ファイルの日付、文字種の整形（全角半角、NFC など）
- 実行前のプレビュー。名前の衝突や Windows で使えない名前は実行させない
- 直前の 1 回を元に戻せる。途中で失敗しても、アプリが落ちても戻せる
- 簡単モード（一般ユーザー向け）と詳細モード（正規表現、テンプレート）

詳しくは [docs/SPEC.md](docs/SPEC.md)。

## キーボード

Windows は ⌘ → Ctrl、⌥ → Alt。

| キー | 操作 |
|---|---|
| ⌘O | フォルダを開く（新しい一覧） |
| ⌘⇧O | ファイルを追加 |
| ⌘F | 名前で絞り込む |
| ⌘1〜⌘4 | ルール：置換、連番、日付、整形 |
| ⌘⇧D | 簡単 / 詳細モードの切り替え |
| ⌘Enter | 名前を変更（確認のダイアログが出る） |
| ⌘Z | 直前の変更を元に戻す（入力欄では入力の取り消し） |
| ↑ ↓、⇧↑ ⇧↓、Home、End | 行の選択 |
| ⌘A | すべて選択 |
| スペース | 選択した行を対象にする / 外す |
| Esc | 選択を解除 |
| ⌘, | 設定 |
| ? | ショートカット一覧 |

## インストール

[Releases](https://github.com/2204601/workbench/releases?q=renamer) から入れる。Apple や Microsoft の署名をしていないので、**初回だけ** 警告が出る。

- **macOS**：`.dmg` を開いて「アプリケーション」へコピー → 起動すると「開発元を検証できない」と出るので「完了」→ **システム設定 › プライバシーとセキュリティ** の下にある「このまま開く」。ターミナルで `xattr -dr com.apple.quarantine "/Applications/Renamer.app"` でもよい
- **Windows**：`-setup.exe` を実行 → SmartScreen が出たら「詳細情報」→「実行」

## アップデート

起動して数秒後に新しいバージョンを確かめ、あればダイアログで知らせる。「更新して再起動」で入れ替わる（2 回目以降は警告が出ない）。手動では **Renamer › アップデートを確認…**（Windows は **ヘルプ › アップデートを確認…**）。自動の確認は設定（⌘,）で止められる。

## 安全のための仕組み

- 名前を変える直前に 1 件ずつ、読み込んだときと同じファイルかを確かめる。同じ名前のファイルがあれば上書きせずに止まる
- 途中で失敗したら止まって、「元に戻す / 飛ばして続ける / ここで終える」を選べる
- 変更の記録（ジャーナル）を先に書くので、アプリを閉じても、落ちても、次に起動したときに元に戻せる。記録はアプリのデータフォルダの `journal.jsonl`（macOS：`~/Library/Application Support/jp.co.jazmf.renamer/`、Windows：`%APPDATA%\jp.co.jazmf.renamer\`）

詳しくは [docs/SAFETY.md](docs/SAFETY.md)。

## ログ

**ヘルプ › ログを表示** で開く。

- macOS：`~/Library/Logs/jp.co.jazmf.renamer/renamer.log`
- Windows：`%LOCALAPPDATA%\jp.co.jazmf.renamer\logs\renamer.log`

## 開発

開発の基準は [desktop-platform](https://github.com/jazmf-dx/desktop-platform) に従う。前提は [decisions/project-context.md](decisions/project-context.md)。コマンドは `renamer/` で実行する。

```bash
npm install
npm run tauri dev      # アプリを起動
npm run dev            # ブラウザで UI だけ（モック。src/dev/mockBackend.ts）
npm test               # cargo test + tsc --noEmit
npm run lint           # eslint + cargo fmt --check + clippy
cargo run --example seed --manifest-path src-tauri/Cargo.toml -- <フォルダ> 10000   # 試し用のファイルを作る
```

Linux で Rust をビルドするには `libwebkit2gtk-4.1-dev` などが要る（CI の `test` job と同じ）。

## 構成

| 場所 | 中身 |
|---|---|
| `src/` | React の UI。`lib/commands.ts` がコマンド表、`lib/api.ts` が Rust コマンドの型付きラッパ |
| `src-tauri/src/` | Rust。`lib.rs` が plugin の配線、`commands.rs` がフロントから呼ぶコマンド、`scan.rs` が読み込み、`preview.rs` が一覧（絞り込み・並び順・新しい名前・衝突の検査）、`rules/` がルール、`validate.rs` が Windows 基準の検査、`plan.rs` が実行の順番、`execute.rs` と `journal.rs` が実行・取り消し・記録、`fs_os.rs` が上書きしないリネーム、`volume.rs` がネットワークの判定 |
| `src-tauri/tests/ipc.rs` | コマンドを JS と同じ引数で IPC 越しに呼ぶテスト（Tauri のモックランタイム） |
| [docs/SPEC.md](docs/SPEC.md) | 機能仕様 |
| [docs/SAFETY.md](docs/SAFETY.md) | 安全に名前を変える仕組み（ネットワークドライブ、取り消し、ジャーナル） |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | 設計（層、コマンド、依存、テスト） |
| [docs/ROADMAP.md](docs/ROADMAP.md) | マイルストーンと未決事項 |

雛形は [stockroom](https://github.com/2204601/stockroom) の `170b90c` から写した（`proxy.rs`、`log.ts`、`titleBar.ts`、`osNotify.ts`、`ime.ts`、`update.ts`、`Toasts.tsx`、ビルド設定）。desktop-base ができたら差し替える。

## リリース

workbench の決まり（リポジトリ直下の README「リポジトリの決まりごと」、Platform Optional「複数ツール同居リポジトリ」）に従う。

1. バージョンを `package.json`、`src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml` の 3 か所で上げ、lockfile も更新する（`npm version X --no-git-tag-version`、`cargo update -p renamer --manifest-path src-tauri/Cargo.toml`）
2. `CHANGELOG.md` に `## <version>` の節を書く（変更点 / ダウンロード / 注意。リリースの本文になり、変更点はアップデートのダイアログにも出る）
3. `chore: renamer v<version>` を PR で `main` に入れる
4. Actions › **renamer** › **Run workflow** で `main`、`release` にチェックを入れて実行する。`renamer-v<version>` の tag を push しても同じ
5. CI が tag と version の一致、CHANGELOG の節、更新ファイルの有無を確かめ、`Renamer v<version>` のリリースを作って公開し、固定リリース `renamer-updater` の `latest.json` を差し替える。配布済みのアプリはここを見て更新する

署名鍵は workbench の Secrets（`TAURI_SIGNING_PRIVATE_KEY`、`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`。Shelf と共有）。**`renamer-updater` のリリースと tag は消さない**（配布済みのアプリが更新を見つけられなくなる）。

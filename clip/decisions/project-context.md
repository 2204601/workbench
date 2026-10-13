# Project Context

AI と人が実装前に確認する **現在の前提**。機能要件、ロードマップ、画面仕様は `README.md` に置き、ここには書かない。
変更したら日付を更新する。変更の理由を将来説明する価値がある場合だけ、別の ADR を残す。

**更新日**：2026-10-13

| 項目 | 現在の前提 |
|---|---|
| ツールの種類 | トレイ常駐（Platform Optional「トレイ常駐」）。ウィンドウはショートカットで出すポップアップ（`popup`）と、スニペットと設定のウィンドウ（`manage`）の 2 つ |
| UI の実装 | 素の TypeScript + CSS（React なし）。トレイ常駐の小物なので Platform Optional「トレイ常駐」のとおり |
| データの置き場 | `app_data_dir()` の `snippets.json`・`history.json`・`settings.json` と、ログイン項目の目印 `launch-at-login-set`。README「知っておくとよいこと」 |
| 扱う機密 | 履歴にはコピーしたものがそのまま入る。記録しないもの（パスワード管理ソフトの印付きのコピー、ファイルのコピー、10 万バイトを超えるもの）を除き、件数と期間で上限を付けてディスクに平文で置く |
| 外との接続 | なし（自分から出る通信は updater の feed だけ） |
| OS の権限 | macOS で前のアプリに ⌘V を送るのにアクセシビリティの許可が要る。無いときはコピーだけにする。Windows は不要 |
| 配布の形 | workbench 同居（Platform Optional「複数ツール同居リポジトリ」。tag `clip-v*`、feed は固定リリース `clip-updater`） |
| 識別子 | `dev.workbench.clip`（一度配布したら変えない） |
| productName | `Clip` |
| desktop-base | 未採用（まだ無い）。`proxy.rs`・`update.rs`・`login_item.rs` は Shelf から写した。desktop-base ができたら差し替える |
| updater の署名鍵 | workbench の Secrets の鍵（Shelf・Renamer と共有。公開鍵 ID `50FEA12A1D8F04D1`） |

## 該当しない Standard

- Optional「ローカル受付」は該当なし（外との接続が無い）
- Architecture §3 コマンド表、§5 の zustand、UI §7 の仮想スクロールは該当なし（React を使わないトレイ常駐の小物。一覧は多くて数百件）
- UI §4 のウィンドウの大きさ・位置の記憶と macOS のタイトルバーは、ポップアップには該当なし（枠なしで、毎回マウスのある画面に置く）

## まだ Standard にそろっていないところ（Adopt going forward）

- ログ（Architecture §8）：`tauri-plugin-log` と panic の記録が無い
- release profile（Distribution §7）：`[profile.release]` が無い。`panic = "abort"` にするのはログで panic を残せるようになってから
- desktop-base の `proxy` / `updater` への差し替え

## 逸脱

- [ADR-0001](adr-0001-json-storage-and-tray.md)：データは SQLite ではなく JSON。トレイとテーマは Shelf の ADR-0001 に合わせる

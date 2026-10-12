# Project Context

AI と人が実装前に確認する **現在の前提**。機能要件、ロードマップ、画面仕様は `README.md` に置き、ここには書かない。
変更したら日付を更新する。変更の理由を将来説明する価値がある場合だけ、別の ADR を残す。

**更新日**：2026-10-12

| 項目 | 現在の前提 |
|---|---|
| ツールの種類 | トレイ常駐（Platform Optional「トレイ常駐」）。ウィンドウは画面右端の棚と、右端の細い線（`edge`）の 2 つ |
| UI の実装 | 素の TypeScript + CSS（React なし）。トレイ常駐の小物なので Platform Optional「トレイ常駐」のとおり |
| データの置き場 | `app_data_dir()` の `shelf.json`（ファイルの場所の一覧だけ。中身はコピーしない）と、ログイン項目の目印 `launch-at-login-set`。README「知っておくとよいこと」 |
| 外との接続 | なし（自分から出る通信は updater の feed だけ） |
| 配布の形 | workbench 同居（Platform Optional「複数ツール同居リポジトリ」。tag `shelf-v*`、feed は固定リリース `shelf-updater`） |
| 識別子 | `dev.workbench.shelf`（配布済み。変えない） |
| productName | `Shelf` |
| desktop-base | 未採用（まだ無い）。`proxy.rs` と `update.rs` はツール内にある。desktop-base ができたら差し替える |
| updater の署名鍵 | workbench の Secrets の鍵（Renamer と共有。公開鍵 ID `50FEA12A1D8F04D1`） |

## 該当しない Standard

- Optional「ローカル受付」は該当なし（外との接続が無い）
- Architecture §3 コマンド表、§5 の zustand、UI §7 の仮想スクロールは該当なし（React を使わないトレイ常駐の小物。棚に置く件数も数十件まで）
- Architecture §6 の SQLite とロックファイルは該当なし（データは JSON 1 ファイル）
- UI §4 のウィンドウの大きさ・位置の記憶と macOS のタイトルバーは該当なし（棚は枠なしで、毎回画面右端に置く）

## まだ Standard にそろっていないところ（Adopt going forward）

- ログ（Architecture §8）：`tauri-plugin-log` と panic の記録が無い
- release profile（Distribution §7）：`[profile.release]` が無い。`panic = "abort"` にするのはログで panic を残せるようになってから
- desktop-base の `proxy` / `updater` への差し替え

## 逸脱

- [ADR-0001](adr-0001-tray-click-and-theme.md)：トレイアイコンはどのクリックでもメニューを出す。テーマは OS に合わせてライト / ダークを切り替える（Optional「トレイ常駐」、UI §1 から）

# Project Context

AI と人が実装前に確認する **現在の前提**。機能要件、ロードマップ、画面仕様は `README.md` に置き、ここには書かない。
変更したら日付を更新する。変更の理由を将来説明する価値がある場合だけ、別の ADR を残す。

**更新日**：2026-10-13

| 項目 | 現在の前提 |
|---|---|
| ツールの種類 | トレイ常駐（Platform Optional「トレイ常駐」）。ウィンドウはトレイのアイコンのそばに開くポップアップ（`popup`）1 つ |
| トレイの形 | Windows は項目（CPU・メモリ・ディスク・ネットワーク）ごとにアイコン 1 つ、値をアイコンに描く。macOS はメニューバーに文字で 1 つ（利用者と相談して決めた。2026-10-13） |
| 見る項目 | CPU・メモリ・ディスク・ネットワークの 4 つ（利用者と相談して決めた）。ポップアップでは、使用量の多いアプリの上位も出す |
| UI の実装 | 素の TypeScript + CSS（React なし）。トレイ常駐の小物なので Platform Optional「トレイ常駐」のとおり |
| 値の読み取り | sysinfo（Recommendations に未収録。健全性チェックは PR の説明に書いた） |
| データの置き場 | `app_config_dir()` の `settings.json`（出す項目と更新の間隔）と、`app_data_dir()` のログイン項目の目印 `launch-at-login-set`。測った値はメモリにだけ持つ |
| 外との接続 | なし（自分から出る通信は updater の feed だけ） |
| 配布の形 | workbench 同居（Platform Optional「複数ツール同居リポジトリ」。tag `meter-v*`、feed は固定リリース `meter-updater`） |
| 識別子 | `dev.workbench.meter`（一度配布したら変えない） |
| productName | `Meter` |
| 主な利用 OS | Windows（社内のほぼ全員）。macOS も Platform の基準どおり配布するが、確認の優先度は Windows を先にする |
| desktop-base | 未採用（まだ無い）。`proxy.rs`・`update.rs`・`login_item.rs` は Clip から、ログの配線は Disk Analyzer から写した。desktop-base ができたら差し替える |
| updater の署名鍵 | workbench の Secrets の鍵（Shelf・Clip・Renamer・Disk Analyzer と共有。公開鍵 ID `50FEA12A1D8F04D1`） |

## 該当しない Standard

- Optional「ローカル受付」は該当なし（外との接続が無い）
- Architecture §3 コマンド表、§5 の zustand、UI §3 のキーボード、§7 の一覧は該当なし（React を使わないトレイ常駐の小物。操作は Esc で閉じるだけ）
- Architecture §6 の SQLite とロックファイルは該当なし（ディスクに持つデータは設定だけ）
- UI §4 のウィンドウの大きさ・位置の記憶と macOS のタイトルバーは該当なし（ポップアップは枠なしで、毎回クリックしたアイコンのそばに置く）
- UI §9 の設定ダイアログは該当なし（設定は 2 つだけで、トレイのメニューに置く）

## 逸脱

- [ADR-0001](adr-0001-theme-follows-os.md)：テーマは OS に合わせてライト / ダークを切り替える（UI §1 から）

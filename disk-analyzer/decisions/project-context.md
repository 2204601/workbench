# Project Context

AI と人が実装前に確認する **現在の前提**。機能要件、ロードマップ、画面仕様は `docs/` に置き、ここには書かない。
変更したら日付を更新する。変更の理由を将来説明する価値がある場合だけ、別の ADR を残す。

**更新日**：2026-10-13

| 項目 | 現在の前提 |
|---|---|
| ツールの種類 | ウィンドウアプリ |
| UI の実装 | React + zustand + Tailwind 4。グラフのレイアウトは d3-hierarchy と d3-shape（描画は React の SVG） |
| グラフ | サンバースト・ツリーマップ・アイシクルの 3 種（利用者と相談して決めた。試作の比較は 2026-10-13）に、円グラフ・棒グラフを足した 5 種を切り替え（「グラフが難しい」という声を受けて足した。3 種はそのまま残す） |
| ファイルへの操作 | 見るだけ。削除・ごみ箱への移動は入れない（利用者と相談して決めた。必要になったら人が決める） |
| データの置き場 | `settings.json`（アップデートの自動確認）だけ。スキャンの結果はメモリにだけ持つ |
| 外との接続 | なし（自分から出る通信は updater の feed だけ） |
| 配布の形 | workbench 同居（Platform Optional「複数ツール同居リポジトリ」。tag `disk-analyzer-v*`、feed は固定リリース `disk-analyzer-updater`） |
| 識別子 | `dev.workbench.disk-analyzer`（一度配布したら変えない） |
| productName | `Disk Analyzer`（空白入り。CI がリリースのファイル名の空白を `_` に変える） |
| 主な利用 OS | Windows（社内のほぼ全員）。macOS も Platform の基準どおり配布するが、確認の優先度は Windows を先にする |
| desktop-base | 未採用（まだ無い）。Renamer の雛形から写す。desktop-base ができたら差し替える |
| updater の署名鍵 | workbench の Secrets の鍵（Shelf・Renamer と同じ。公開鍵 ID `50FEA12A1D8F04D1`） |

## 該当しない Standard

- Optional「ローカル受付」は該当なし（外との接続が無い）
- Optional「トレイ常駐」は該当なし（ウィンドウアプリ）
- Architecture §6 の SQLite とロックファイルは該当なし（ディスクに持つデータが無い）

## 逸脱

- なし

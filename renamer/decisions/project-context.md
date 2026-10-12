# Project Context

AI と人が実装前に確認する **現在の前提**。機能要件、ロードマップ、画面仕様は `docs/` に置き、ここには書かない。
変更したら日付を更新する。変更の理由を将来説明する価値がある場合だけ、別の ADR を残す。

**更新日**：2026-10-12

| 項目 | 現在の前提 |
|---|---|
| ツールの種類 | ウィンドウアプリ |
| UI の実装 | React + zustand + Tailwind 4 |
| データの置き場 | `app_data_dir()` の JSON（直前の実行のジャーナルだけ。docs/ARCHITECTURE.md「ジャーナル」） |
| 外との接続 | なし（自分から出る通信は updater の feed だけ） |
| 配布の形 | workbench 同居（Platform Optional「複数ツール同居リポジトリ」。tag `renamer-v*`、feed は固定リリース `renamer-updater`） |
| 識別子 | `jp.co.jazmf.renamer`（一度配布したら変えない） |
| productName | `Renamer` |
| 主な利用 OS | Windows（社内のほぼ全員）。macOS も Platform の基準どおり配布するが、確認の優先度は Windows を先にする |
| desktop-base | 未採用（まだ無い）。[stockroom](https://github.com/2204601/stockroom)（旧 image-library）の `170b90c`（v0.17.0）から写す。desktop-base ができたら差し替える |
| リポジトリ | [2204601/workbench](https://github.com/2204601/workbench) の `renamer/`（jazmf-dx/renamer → 2204601/renamer → workbench と移した。それまでの履歴は 2204601/renamer に残る） |
| updater の署名鍵 | workbench の Secrets の鍵（Shelf と同じ。公開鍵 ID `50FEA12A1D8F04D1`）。stockroom の鍵とは別 |

## 該当しない Standard

- Optional「ローカル受付」は該当なし（外との接続が無い）
- Optional「トレイ常駐」は該当なし（ウィンドウアプリ）
- Architecture §6 の SQLite とロックファイルは該当なし（大量のデータを持たない）

## 逸脱

- なし

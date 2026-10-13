# Project Context

AI と人が実装前に確認する **現在の前提**。機能要件、ロードマップ、画面仕様は `docs/` に置き、ここには書かない。
変更したら日付を更新する。変更の理由を将来説明する価値がある場合だけ、別の ADR を残す。

**更新日**：2026-10-13

| 項目 | 現在の前提 |
|---|---|
| ツールの種類 | ウィンドウアプリ（タブで複数の PDF） |
| 利用者 | 社内のほぼ全員。パソコンに詳しくない人も使う。ショートカットや右クリックを前提にしない（`docs/UX.md` §1） |
| UI の方向 | **編集するためのアプリ** として作る。開いたらすぐ編集でき、道具には言葉を付け、画面の下に案内を出す（`docs/UX.md`）。Acrobat を目標に版ごとに機能を足す（`docs/ROADMAP.md`） |
| UI の実装 | React + zustand + Tailwind 4。PDF の表示は pdf.js（`pdfjs-dist` の legacy ビルド）。注釈は React の SVG と HTML |
| PDF の書き込み | Rust（lopdf、subsetter、skrifa、image）。pdf.js の保存は使わない（docs/ARCHITECTURE.md §1） |
| 0.1 の範囲 | 閲覧＋ページ編集、注釈・書き込み、フォーム入力（利用者と相談して決めた。もとの文字の編集は入れない）。0.2 以降は `docs/ROADMAP.md` |
| ファイルへの操作 | 元のファイルは変えないのが基本。最初の保存は別名を提案、上書きは前の版をバックアップ（利用者と相談して決めた） |
| データの置き場 | `settings.json`（作成者名、アップデートの自動確認、最近使ったファイル）、`backups/`（上書き前の版、30 個）、`stamps/`（印鑑・署名の画像）。開いた PDF はメモリだけ |
| フォント | アプリはフォントを持たず、OS の日本語フォントを埋め込む（游ゴシック、ヒラギノ角ゴシック W3 など） |
| 外との接続 | なし（自分から出る通信は updater の feed だけ。PDF のリンクは確認してから OS のブラウザで開く） |
| 配布の形 | workbench 同居（Platform Optional「複数ツール同居リポジトリ」。tag `pdf-one-v*`、feed は固定リリース `pdf-one-updater`） |
| 識別子 | `dev.workbench.pdf-one`（一度配布したら変えない） |
| productName | `PDF One`（空白入り。CI がリリースのファイル名の空白を `_` に変える） |
| ファイルの関連付け | `.pdf`（`bundle.fileAssociations`、役割は Editor）。既定のアプリにするかは利用者が OS で選ぶ |
| 主な利用 OS | Windows（社内のほぼ全員）。macOS も Platform の基準どおり配布するが、確認の優先度は Windows を先にする |
| desktop-base | 未採用（まだ無い）。Disk Analyzer の雛形から写す（workbench `166b802`）。desktop-base ができたら差し替える |
| updater の署名鍵 | workbench の Secrets の鍵（ほかのツールと同じ。公開鍵 ID `50FEA12A1D8F04D1`） |

## 該当しない Standard

- Optional「ローカル受付」は該当なし（外との接続が無い）
- Optional「トレイ常駐」は該当なし（ウィンドウアプリ）
- Architecture §6 の SQLite とロックファイルは該当なし（ディスクに持つデータは設定とバックアップと画像だけ）

## 逸脱

- Security §1 の CSP：`connect-src` に `'self'` を足した（[ADR-0001](adr-0001-csp-connect-self.md)）

# Project Context

AI と人が実装前に確認する **現在の前提**。機能要件、ロードマップ、画面仕様は `docs/` に置き、ここには書かない。
変更したら日付を更新する。変更の理由を将来説明する価値がある場合だけ、別の ADR を残す。

**更新日**：2026-10-13

| 項目 | 現在の前提 |
|---|---|
| ツールの種類 | ウィンドウアプリ |
| UI の実装 | React + zustand + Tailwind 4。プレビューは canvas 2D と `<video>` |
| 動画の処理 | 同梱の ffmpeg（ffmpeg-static `b6.1.1` の配布物。中の版は Windows 6.1.1、macOS 6.0、開発用の Linux 7.0.2。GPL build、libx264 入り）を sidecar（`bundle.externalBin`）で動かす。プレビューはウィンドウの動画再生を使い、再生できない形式だけ ffmpeg でプレビュー用のコピーを作る |
| 書き出しの形式 | MP4（H.264 / AAC）だけ |
| 編集の範囲 | キリはり、文字、スタンプ、切り替え、クリップの音量（利用者の依頼「キリはりして、スタンプや文字を入れたり、切り替えのアニメーション」）。BGM のトラック、複数の映像トラック、速さ、色の調整は入れていない |
| データの置き場 | プロジェクトは利用者が選んだ `.cutter`（JSON、素材はフルパス）。サムネイル・波形・コピーはアプリのキャッシュフォルダ。`settings.json`（アップデートの自動確認） |
| 外との接続 | なし（自分から出る通信は updater の feed だけ） |
| 配布の形 | workbench 同居（Platform Optional「複数ツール同居リポジトリ」。tag `cutter-v*`、feed は固定リリース `cutter-updater`） |
| 識別子 | `dev.workbench.cutter`（一度配布したら変えない） |
| productName | `Cutter` |
| 主な利用 OS | Windows（社内のほぼ全員）。macOS も Platform の基準どおり配布するが、確認の優先度は Windows を先にする |
| desktop-base | 未採用（まだ無い）。Disk Analyzer の雛形から写す |
| updater の署名鍵 | workbench の Secrets の鍵（ほかのツールと同じ。公開鍵 ID `50FEA12A1D8F04D1`） |

## 人が決めること

- **ffmpeg のライセンス**：同梱の ffmpeg は GPL の build（H.264 で書き出すための libx264 を含む）。アプリとは別の実行ファイルとして同梱し、README にライセンスと入手元を書いている。社外へ配る、または GPL を避ける必要が出たら、LGPL の build と OS の H.264 エンコーダ（Windows：Media Foundation、macOS：VideoToolbox）に切り替える
- **インストーラの大きさ**：ffmpeg の分（数十 MB）大きくなる

## 該当しない Standard

- Optional「ローカル受付」は該当なし（外との接続が無い）
- Optional「トレイ常駐」は該当なし（ウィンドウアプリ）
- Architecture §6 の SQLite とロックファイルは該当なし（編集はプロジェクトのファイルにだけ持つ）

## 逸脱

- asset protocol を有効にしている（素材の動画をプレビューで再生するため）。scope は空で、`probe_media` を通したファイルとアプリのキャッシュフォルダだけを、起動中に 1 つずつ許す

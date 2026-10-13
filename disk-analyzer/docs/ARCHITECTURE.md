# 設計

Platform の [Architecture Standard](../../../desktop-platform/standards/architecture.md) に沿う。ここにはこのツール固有の境界だけを書く。振る舞いは [SPEC.md](SPEC.md)。

## 1. 方針

- **スキャンしたツリーは Rust 側だけが持つ**。フロントは、いま描く分（`view_tree`）と一覧の分（`folder_info`）だけを受け取る（Platform Stack「Rust 側の状態と二重に持たない」）
  - 数百万ファイルのツリーを IPC で送らない。小さい項目は Rust 側で 1 つにまとめてから送る
- 大きさの集計、並べ替え、小さい項目のまとめは Rust 側で行う。フロントはレイアウト（d3-hierarchy）と描画だけ
- ファイルシステムに触るのは `scan.rs`（読むだけ）と `reveal_item`（Finder / エクスプローラーで表示）だけ。書き込みは設定ファイルとログだけ

## 2. 層

| 層 | 中身 |
|---|---|
| shell | proxy、updater、log の配線、single-instance、window-state、settings.json（Renamer から写した。desktop-base ができたら差し替える） |
| core | スキャン（`scan.rs`）、グラフと一覧に渡す形（`view.rs`）、ドライブの一覧と空き容量（`places.rs`） |
| features | グラフ 3 種（`src/components/charts/`）、一覧、スタート画面、スキャン中の画面 |

## 3. ディレクトリ

```text
disk-analyzer/
  src/
    App.tsx                    画面の切り替え（スタート / スキャン中 / 結果）
    store.ts                   いまのフォルダ、グラフの種類、重ねている項目、選んだ項目、スキャンの進み具合
    lib/api.ts                 Rust コマンドの型付きラッパ
    lib/commands.ts            コマンド表（メニュー、キー、ショートカット一覧の元）
    lib/actions.ts             スキャン、移動、表示、パスのコピー
    lib/charts.ts              グラフ 3 種の深さとまとめる割合、色の割り当て
    lib/contextMenu.ts         右クリックのメニュー（ネイティブ）
    components/charts/
      layouts.ts               サンバースト・ツリーマップ・アイシクルのレイアウト（d3-hierarchy、d3-shape）
      shapes.ts                レイアウトの結果の型、色、文字の切り詰め
      ChartArea.tsx            描画、ツールチップ、重ねたときの枠、クリック
    components/                一覧、ツールバー、ステータスバー、スタート画面、スキャン中、トースト
    dev/mockBackend.ts         ブラウザ開発用モック（同じサンプルのツリーを返す）
  src-tauri/src/
    lib.rs                     plugin の配線、setup、invoke_handler
    commands.rs                フロントから呼ぶコマンド
    scan.rs                    並列のスキャン、大きさの数え方、ツリー（配列に幅優先で並べる）
    view.rs                    view_tree / folder_info（純粋関数）
    places.rs                  ドライブの一覧と空き容量（cfg(windows) / cfg(unix)）
    volume.rs                  ネットワーク上かどうか
  src-tauri/tests/ipc.rs       コマンドを JS と同じ引数で IPC 越しに呼ぶテスト
  src-tauri/examples/scan.rs   画面なしでスキャンして時間を測る
```

## 4. コマンド

| コマンド | 引数 | 返す |
|---|---|---|
| `list_places` | | ドライブとホームフォルダ |
| `scan_folder` | `path` | 合計、中止したか、読めないフォルダ、クラウドのみ、空き容量。実行中は `scan-progress` イベント |
| `cancel_scan` / `close_scan` | | |
| `view_tree` | `id`, `depth`, `minShare` | グラフに描く部分木 |
| `folder_info` | `id`, `limit` | 一覧、パンくず、パス |
| `item_path` / `reveal_item` | `id` | パス / Finder・エクスプローラーで表示 |
| `get_app_settings` / `set_app_settings` / `system_proxy` / `reveal_log` | | shell |

`id` はツリーの配列の位置。スキャンし直すと変わる。

## 5. ツリーの持ち方

- スキャン中は `Raw`（子を `Vec` で持つ木）を rayon で並列に作る。終わったら幅優先で 1 本の配列（`Vec<Node>`）に並べ直す。各フォルダの子は配列の中で連続し、大きい順
- `Node` は名前、大きさ、ファイル数、フォルダ数、親、子の範囲だけ。100 万ファイルで 100 MB 前後
- スレッド数は CPU の数の 2 倍（8〜32）。フォルダを読むのはほとんど待ち時間なので

## 6. テスト

- `scan.rs`：大きさの合計、大きい順、パス、リンクをたどらない、ハードリンクを 1 回、読めないフォルダ、中止
- `view.rs`：小さい項目のまとめ、深さ、一覧の上限
- `tests/ipc.rs`：スキャン → 一覧 → グラフ → パス → 閉じる を IPC 越しに
- UI はブラウザのモック（`npm run dev`）で確かめる

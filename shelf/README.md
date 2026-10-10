# Shelf

ファイルを移動するときの「一時置き場」になる、[Yoink](https://eternalstorms.at/yoink/) 風の小さなアプリです。macOS（Apple Silicon）と Windows で動きます。

![screenshot](docs/screenshot.png)

フォルダを行ったり来たりしながらファイルを運ぶとき、いったん Shelf に置いておき、移動先のフォルダを開いてからそこへドラッグして出す、という使い方を想定しています。

## インストール

[Releases](https://github.com/2204601/workbench/releases?q=shelf) から最新版をダウンロードしてください。

| OS | ファイル | 入れ方 |
| --- | --- | --- |
| macOS（Apple Silicon / M1 以降） | `Shelf_<バージョン>_aarch64.dmg` | 開いて `Shelf.app` を「アプリケーション」フォルダへドラッグ |
| Windows（64 ビット） | `Shelf_<バージョン>_x64-setup.exe` | 実行してインストーラの指示に従う |

Intel Mac 向けの版は配布していません。

### 初回起動

コード署名をしていないため、初回は OS の警告が出ます。

- **macOS**: `Shelf.app` を右クリック →「開く」→ 確認ダイアログで「開く」。「壊れているため開けません」と出る場合は、ターミナルで次を実行してから開いてください。

  ```sh
  xattr -cr /Applications/Shelf.app
  ```

- **Windows**: SmartScreen の画面で「詳細情報」→「実行」。

### アップデート

自動アップデートはありません。新しい版をダウンロードして上書きインストールしてください。棚の中身はそのまま残ります。

## 使い方

Shelf は画面の右端に、常に最前面で表示される小さなウィンドウです。棚が空のあいだは隠れていて、ファイルをドラッグすると出てきます。

### 置く

Finder / エクスプローラからファイルやフォルダを Shelf にドロップします。複数まとめて置けます。

棚が隠れているときは、次のどちらかで出てきます。

- **ファイルを画面の右端まで持っていく**（macOS / Windows）: 右端の中ほどにある細い青い線が目印です。線の上に直接ドロップしても棚に置けます
- **ファイルをドラッグし始める**（macOS のみ）: Finder などでファイルをドラッグし始めた時点で出てきます

何も置かずにドラッグを終えると、棚はまた隠れます。

### 出す

Shelf のアイテムを、移動先のフォルダやアプリへドラッグします。

- ヘッダーの「**移動** / **コピー**」ボタンで、出したときの動作を切り替えます（既定は移動）
- **Alt**（macOS は **Option**）を押しながらドラッグすると、その回だけ逆の動作になります
- 移動で出したファイルは、Shelf からも自動で消えます

### まとめて出す

- クリックで選択、**⌘/Ctrl + クリック**で追加選択、**Shift + クリック**で範囲選択
- 選択中のアイテムをドラッグすると、選択したものすべてを一度に出せます
- 下の「まとめてドラッグ」からは、選択中のアイテム（何も選んでいなければ全部）を出せます

### その他の操作

| 操作 | 動作 |
| --- | --- |
| ダブルクリック | ファイルを開く |
| 行のフォルダボタン | Finder / エクスプローラで場所を表示 |
| 行の × ボタン、Delete / Backspace | 棚から外す（ファイルは消えません） |
| ヘッダーのゴミ箱ボタン | 棚を空にする（ファイルは消えません） |
| ⌘/Ctrl + A | すべて選択 |
| Esc | 選択を解除 |
| ヘッダーの「—」 | ウィンドウを隠す（次にドラッグすると出てきます） |
| メニューバー / タスクトレイのアイコン | クリックで表示・非表示。右クリックのメニューから終了 |

棚の最後のアイテムを出し終える（または棚を空にする）と、ウィンドウは自動で隠れます。棚にアイテムがある状態で起動したときは、最初から表示されます。

macOS では Dock にアイコンは出ません。メニューバーのアイコンから操作してください。

### 知っておくとよいこと

- Shelf が覚えているのはファイルの**場所だけ**です。アプリの中にコピーは作らないので、棚から外したり Shelf を終了したりしても、ファイル自体はそのまま残ります
- 元の場所でファイルが移動・削除されると、そのアイテムはグレーで「見つかりません」と表示されます。× で棚から外してください
- 画像ファイルはサムネイルが表示されます
- 棚の中身は次の場所に保存され、再起動しても残ります
  - macOS: `~/Library/Application Support/dev.workbench.shelf/shelf.json`
  - Windows: `%APPDATA%\dev.workbench.shelf\shelf.json`

### アンインストール

- **macOS**: 「アプリケーション」フォルダの `Shelf.app` をゴミ箱へ
- **Windows**: 「設定」→「アプリ」から Shelf をアンインストール

棚の中身も消したい場合は、上の保存先のフォルダも削除してください。

## 開発

Tauri 2（Rust）＋ TypeScript（Vite、フレームワークなし）で作っています。

### 必要なもの

[Tauri の前提ツール](https://v2.tauri.app/start/prerequisites/)を入れてください。

- Rust（stable）
- Node.js 20 以上
- macOS: Xcode Command Line Tools
- Windows: Microsoft C++ Build Tools と WebView2（Windows 11 には最初から入っています）

### コマンド

```sh
cd shelf
npm install
npm run tauri dev      # 開発モードで起動（画面の変更はすぐ反映されます）
npm run tauri build    # インストーラを作成（macOS は .app/.dmg、Windows は -setup.exe）
cargo test --manifest-path src-tauri/Cargo.toml   # Rust のテスト
```

作成したインストーラは `src-tauri/target/release/bundle/` に出力されます。

### 構成

| パス | 役割 |
| --- | --- |
| `index.html`, `src/styles.css` | 画面のレイアウトと見た目 |
| `src/main.ts` | 画面の動作。ドロップの受け取り、選択、ドラッグで出す処理 |
| `src-tauri/src/shelf.rs` | 棚のデータ（パスの一覧）と JSON への保存。ユニットテストもここ |
| `src-tauri/src/lib.rs` | 画面から呼ぶコマンド、トレイアイコン、ウィンドウの配置 |
| `src-tauri/src/drag_watch.rs` | ドラッグ中に棚を出す処理（macOS のドラッグ開始検知、ドラッグ終了の判定） |
| `edge.html`, `src/edge.ts` | 画面右端の細いウィンドウ。ドラッグが触れたら棚を出す |
| `src-tauri/tauri.conf.json` | アプリ名・バージョン・ウィンドウ設定・作るインストーラの種類 |
| `src-tauri/capabilities/default.json` | 画面に許可する操作（権限） |
| `src-tauri/icons/` | アプリアイコン（`app-icon.svg` から `npx tauri icon` で生成） |

アプリの外へファイルをドラッグして出すには OS ネイティブのドラッグ操作が必要なため、[tauri-plugin-drag](https://github.com/crabnebula-dev/drag-rs) を使っています。

### CI

`shelf/` 以下か `.github/workflows/shelf.yml` が変わると、GitHub Actions で macOS（Apple Silicon）と Windows のテストとビルドが走ります。作られたインストーラは、実行結果ページの Artifacts からダウンロードできます。

### リリース手順

1. バージョンを上げる（3 か所とも同じ値にします）
   - `package.json` … `npm version <バージョン> --no-git-tag-version`（`package-lock.json` も更新されます）
   - `src-tauri/tauri.conf.json` の `version`
   - `src-tauri/Cargo.toml` の `version`（`Cargo.lock` は `cargo update -p shelf` で更新）
2. [`CHANGELOG.md`](CHANGELOG.md) に `## <バージョン>` の節を書く。この節がそのままリリースの本文になります
3. PR を作って `main` にマージする
4. GitHub の Actions → **shelf** → **Run workflow** で、ブランチ `main`、`release` にチェックを入れて実行する

ビルドが通ると `shelf-v<バージョン>` のタグと Release が作られ、`.dmg` と `-setup.exe` が添付されます。`shelf-v<バージョン>` のタグを直接 push しても同じ動きになります。

- 同じバージョンのタグがすでにある場合は失敗します（先にバージョンを上げてください）
- `CHANGELOG.md` に該当バージョンの節がない場合も失敗します

## 今後の候補

- ショートカットキーで表示・非表示を切り替える
- Windows でもドラッグを始めた時点で棚を出す（他のアプリのドラッグ開始を直接知る方法がないため未対応）
- 画面端の線の位置や、自動で出す動作のオン・オフを設定できるようにする
- テキストや画像データ（ファイル以外）のドロップ
- アイテムのプレビュー（Quick Look など）

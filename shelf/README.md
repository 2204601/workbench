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

署名（Apple Developer ID / Windows コード署名）なしのビルドなので、**初回インストール時だけ**警告が出ます。

- **macOS**: `.dmg` を開いて `Shelf.app` を「アプリケーション」へコピー → 起動すると「開発元を検証できない」と出るので「完了」→ **システム設定 › プライバシーとセキュリティ** の下にある「このまま開く」を押します。
  ターミナルで `xattr -dr com.apple.quarantine /Applications/Shelf.app` を実行しても構いません。
- **Windows**: `-setup.exe` を実行 → SmartScreen が出たら「詳細情報」→「実行」。

### ログイン時に起動

0.1.4 から、初めて起動したときに「ログイン時に起動」がオンになります。Shelf は起動していないとドラッグに反応できないためです。メニューバー / タスクトレイのアイコンのメニューにある「ログイン時に起動」で、いつでもオン・オフできます（一度オフにすれば、勝手にオンに戻ることはありません）。

- macOS では、オンになったときに「バックグラウンド項目が追加されました」という通知が出ることがあります。**システム設定 › 一般 › ログイン項目** にも表示されます
- macOS で `.dmg` の中から直接起動しているとき（「アプリケーション」へコピーしていないとき）は、オンにしません

### アップデート

2 回目以降はアプリ内で更新します（0.1.3 から。0.1.2 以前を使っている場合は、一度だけ新しい版を上書きインストールしてください）。

- 起動から数秒後と、起動したままなら 1 日 1 回、新しいバージョンを確認します。あればダイアログで知らせます（「更新して再起動」で適用、「あとで」なら次の確認でまた知らせます）
- 手動で確認するには、メニューバー / タスクトレイのアイコンをクリック →「アップデートを確認…」
- ダウンロード中の進み具合は、同じメニューの項目に表示されます
- 棚の中身はそのまま残ります

会社のネットワークなどでプロキシが必要な場合は、OS のプロキシ設定（自動プロキシ設定の PAC を含む）をそのまま使います。

アプリ自身が書き出したファイルには macOS の quarantine 属性が付かないので、この経路で更新すると Gatekeeper / SmartScreen の警告は出ません。更新ファイルは Tauri Updater の鍵（minisign）で署名されていて、アプリ側の公開鍵と一致しないものは適用されません。

## 使い方

Shelf は画面の右端に、常に最前面で表示される小さなウィンドウです。棚が空のあいだは隠れていて、ファイルをドラッグすると出てきます。

### 置く

Finder / エクスプローラからファイルやフォルダを Shelf にドロップします。複数まとめて置けます。

棚が隠れているときは、次のどちらかで出てきます。

- **ファイルを画面の右端まで持っていく**（macOS / Windows）: 右端の中ほどにある細い青い線が目印です。線の上に直接ドロップしても棚に置けます
- **ファイルをドラッグし始める**（macOS のみ）: Finder や Dock のスタックなどでファイルをドラッグし始めた時点で出てきます

何も置かずにドラッグを終えると、棚はまた隠れます。

### 出す

Shelf のアイテムを、移動先のフォルダやアプリへドラッグします。

- ヘッダーの「**移動** / **コピー**」ボタンで、出したときの動作を切り替えます（既定は移動）
- **Alt**（macOS は **Option**）を押しながらドラッグすると、その回だけ逆の動作になります
- 移動で出したファイルは、Shelf からも自動で消えます

### 一緒に置いたファイルはひとまとまりに

複数のファイルを一度にドロップする（またはコピーして置く）と、棚では 1 行の「まとまり」になります。左のアイコンの数字が、まとまっているファイルの数です。何度も複数のファイルを置いても、置いた回ごとに分かれるので棚が散らかりません。

- まとまりの行をドラッグすると、中のファイルをすべて一度に出せます
- 右の **›** をクリック（または行をダブルクリック）すると中身が開き、1 件ずつ出したり外したりできます
- 行にマウスを乗せると出るボタンで、まとめを解除して 1 件ずつに分けたり、まとまりごと棚から外したりできます
- 中のファイルが 1 件だけになると、普通の行に戻ります

### まとめて出す

- クリックで選択、**⌘/Ctrl + クリック**で追加選択、**Shift + クリック**で範囲選択
- 選択中のアイテムをドラッグすると、選択したものすべてを一度に出せます
- 下の「まとめてドラッグ」からは、選択中のアイテム（何も選んでいなければ全部）を出せます

### ショートカットキー

どのアプリを使っているときでも使えます。

| キー | 動作 |
| --- | --- |
| **Ctrl + Alt + S**（macOS は **⌃ Control + ⌥ Option + S**） | 棚の表示 / 非表示 |
| 同じキーを素早く 2 回 | Finder / エクスプローラでコピーしたファイルを棚に置いて、棚を出す |

ほかのアプリがすでに同じキーを使っている場合は、ショートカットは使えません（メニューの「表示 / 非表示」の横にキーが表示されていなければ、この状態です）。

コピーしたファイルは、棚を選んだ状態で **⌘V / Ctrl+V** を押すか、メニューの「コピーしたファイルを置く」でも置けます。棚に置かれるのはファイルの場所だけで、コピーや切り取りをしたファイルそのものは元の場所から動きません。

### その他の操作

| 操作 | 動作 |
| --- | --- |
| ダブルクリック | ファイルを開く |
| 行のフォルダボタン | Finder / エクスプローラで場所を表示 |
| 行の × ボタン、Delete / Backspace | 棚から外す（ファイルは消えません） |
| ヘッダーのゴミ箱ボタン | 棚を空にする（ファイルは消えません） |
| ⌘/Ctrl + A | すべて選択 |
| ⌘/Ctrl + V | コピーしたファイルを棚に置く |
| Esc | 選択を解除 |
| ヘッダーの「—」 | ウィンドウを隠す（次にドラッグすると出てきます） |
| メニューバー / タスクトレイのアイコン | クリックでメニューを表示（表示 / 非表示、コピーしたファイルを置く、ログイン時に起動、アップデートを確認…、終了） |

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

- **macOS**: メニューの「ログイン時に起動」をオフにしてから、「アプリケーション」フォルダの `Shelf.app` をゴミ箱へ（オフにし忘れたときは `~/Library/LaunchAgents/Shelf.plist` を削除）
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

`npm run tauri build` にはアプリ内アップデート用の署名鍵が要ります（`createUpdaterArtifacts` が有効なため）。鍵なしでインストーラだけ作るときは、更新ファイルを作らない設定を足します。

```sh
TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.tauri/shelf.key)" npm run tauri build
# 鍵なし
echo '{"bundle":{"createUpdaterArtifacts":false}}' > /tmp/no-updater.json
npm run tauri build -- --config /tmp/no-updater.json
```

開発モード（`npm run tauri dev`）では自動のアップデート確認はしません（トレイの「アップデートを確認…」は動きます）。「ログイン時に起動」も自動ではオンにしません（トレイから手動でオンにすると、開発用のバイナリが登録されるので注意してください）。

### 構成

| パス | 役割 |
| --- | --- |
| `index.html`, `src/styles.css` | 画面のレイアウトと見た目 |
| `src/main.ts` | 画面の動作。ドロップの受け取り、選択、ドラッグで出す処理 |
| `src-tauri/src/shelf.rs` | 棚のデータ（パスの一覧）と JSON への保存。ユニットテストもここ |
| `src-tauri/src/lib.rs` | 画面から呼ぶコマンド、トレイアイコン、ウィンドウの配置 |
| `src-tauri/src/shortcut.rs` | ショートカットキー（1 回で表示 / 非表示、2 回でコピーしたファイルを置く） |
| `src-tauri/src/clipboard.rs` | クリップボードからコピーしたファイルのパスを読む |
| `src-tauri/src/login_item.rs` | ログイン時に起動（初回に一度だけオンにする、トレイのチェック項目） |
| `src-tauri/src/update.rs` | アプリ内アップデート（起動時の確認、トレイの「アップデートを確認…」、ダイアログ） |
| `src-tauri/src/proxy.rs` | OS のプロキシ設定（PAC を含む）を調べる。アップデートの確認とダウンロードに使う |
| `src-tauri/src/drag_watch.rs` | ドラッグ中に棚を出す処理（macOS のドラッグ開始検知、ドラッグ終了の判定） |
| `edge.html`, `src/edge.ts` | 画面右端の細いウィンドウ。ドラッグが触れたら棚を出す |
| `src-tauri/tauri.conf.json` | アプリ名・バージョン・ウィンドウ設定・作るインストーラの種類 |
| `src-tauri/capabilities/default.json` | 画面に許可する操作（権限） |
| `src-tauri/icons/` | アプリアイコン（`app-icon.svg` から `npx tauri icon` で生成） |

アプリの外へファイルをドラッグして出すには OS ネイティブのドラッグ操作が必要なため、[tauri-plugin-drag](https://github.com/crabnebula-dev/drag-rs) を使っています。

### CI

`shelf/` 以下か `.github/workflows/shelf.yml` が変わると、GitHub Actions で macOS（Apple Silicon）と Windows のテストとビルドが走ります。作られたインストーラは、実行結果ページの Artifacts からダウンロードできます。

署名鍵の Secrets（下記）が使えないとき（フォークからの PR など）は、アップデート用のファイルを作らずにインストーラだけをビルドします。

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
- アップデート用のファイル（署名）がない場合も失敗します（Secrets を確認してください）

### アプリ内アップデートの仕組み

リリースには、インストーラのほかにアプリ内アップデート用のファイルが添付されます。

- `Shelf_<バージョン>_aarch64.dmg` / `Shelf_<バージョン>_x64-setup.exe`：初回インストール用
- `Shelf.app.tar.gz` と `.sig`、`-setup.exe` の `.sig`、`latest.json`：アプリ内アップデート用

インストール済みのアプリは `https://github.com/2204601/workbench/releases/download/shelf-updater/latest.json` を見ます（`tauri.conf.json` の `plugins.updater.endpoints`）。このリポジトリには他のツールのリリースも並ぶため、image-library のように `releases/latest` は使えません。そこでリリースのたびに、`shelf-updater` という固定のリリース（プレリリース扱い）の `latest.json` を新しい版のものに置き換えています。**`shelf-updater` のリリースとタグは消さないでください**（配布済みのアプリが更新を見つけられなくなります）。

更新ファイルの署名鍵は GitHub Actions の Secrets に置きます（`TAURI_SIGNING_PRIVATE_KEY`：秘密鍵ファイルの中身、`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`：パスワード、なければ空）。鍵は Shelf 専用で（`~/.tauri/shelf.key`）、対応する公開鍵は `tauri.conf.json` の `plugins.updater.pubkey` です。**秘密鍵を失うと配布済みのアプリに更新を届けられなくなる**ので、必ずバックアップを取ってください。鍵の作り直しは `npx @tauri-apps/cli signer generate -w ~/.tauri/shelf.key`（作り直すと、それまでに配布した版には更新が届かなくなります）。

## 今後の候補

- ショートカットキーを変更できるようにする
- Windows でもドラッグを始めた時点で棚を出す（他のアプリのドラッグ開始を直接知る方法がないため未対応）
- 画面端の線の位置や、自動で出す動作のオン・オフを設定できるようにする
- テキストや画像データ（ファイル以外）のドロップ
- アイテムのプレビュー（Quick Look など）

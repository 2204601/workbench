# Meter

CPU・メモリ・ディスク・ネットワークの使用状況を、タスクトレイ（macOS はメニューバー）にいつも出しておくアプリです。アイコンをクリックすると、直近 1 分のグラフと、CPU やメモリを多く使っているアプリが見られます。Windows と macOS（Apple Silicon）で動きます。

| タスクトレイ（Windows） | ポップアップ |
| --- | --- |
| ![tray](docs/tray.png) | <img src="docs/screenshot.png" width="360" alt="ポップアップ"> |

上の段が 100 %（16 px）、下の段が 200 %（32 px）の表示倍率での見え方です。

## 機能

### タスクトレイ / メニューバー

- **Windows**：項目ごとに小さなアイコンが 1 つずつ並び、上に項目名、下に値が出ます
  - `CPU` と `MEM`（メモリ）は使用率（%）。背景の色は、使用率が上がると緑 → 黄 → 赤に変わります（CPU は 60 % と 85 %、メモリは 75 % と 90 % が境目）
  - `DSK`（ディスク）と `NET`（ネットワーク）は、読み書き / 送受信を合わせた速さ。`45K` は 45 KB/s、`4.5M` は 4.5 MB/s、`.5M` は 0.5 MB/s です
- **macOS**：メニューバーに `CPU 12%  メモリ 54%` のように文字で並びます
- 出す項目は、アイコンを右クリック →「タスクトレイに表示」（macOS は「メニューバーに表示」）で選べます。最初は CPU とメモリです。全部は消せません（1 つは残ります）
- アイコンにマウスを乗せると、4 項目すべての値がまとめて出ます

### ポップアップ

アイコンを**左クリック**すると、アイコンのそばに開きます。ほかの場所をクリックするか Esc で閉じます。

| 項目 | 内容 |
| --- | --- |
| CPU | 全体の使用率と直近 1 分のグラフ、コアごとの使用率、CPU の名前とコア数 |
| メモリ | 使用率と使用量、スワップ（ページファイル）の使用量、グラフ |
| ディスク | 読み書きの速さのグラフと、ドライブごとの空き容量 |
| ネットワーク | 受信・送信の速さのグラフ |
| よく使っているアプリ | CPU かメモリを多く使っているアプリの上位 5 つ。同じアプリのプロセスはまとめて数えます（右の小さな数字がプロセスの数） |

グラフにマウスを乗せると、その時点の値と何秒前かが出ます。

### メニュー（右クリック）

| 項目 | 動作 |
| --- | --- |
| 詳細を表示 | ポップアップを開く |
| タスクトレイに表示 / メニューバーに表示 | アイコンに出す項目を選ぶ |
| 更新の間隔 | 1 秒 / 2 秒 / 5 秒 |
| ログイン時に起動 | 次のログインから自動で起動するか |
| アップデートを確認… | 新しい版があるか確かめる |
| ログを表示 | ログのフォルダを開く |
| 終了 | Meter を終わらせる |

### 数え方

- サイズは 1024 単位で、KB / MB / GB と書きます（エクスプローラーやタスク マネージャーと同じ）。ネットワークも bit ではなく byte で数えます（1 MB/s ≒ 8 Mbps）
- メモリの「使用中」は、全体から「すぐ使える分（利用可能）」を引いた量です
- アプリごとの CPU は、タスク マネージャーと同じく「CPU 全体を 100 %」として数えます。メモリはワーキング セット（実際にメモリに載っている量）なので、タスク マネージャーの既定の列（プライベート ワーキング セット）より少し大きく出ます
- ネットワークは、ループバックと VPN・仮想アダプタ（同じ通信が実際のアダプタでも数えられるため）を除いて合計しています
- アプリの一覧は、ポップアップを開いているあいだだけ調べます（常に調べると Meter 自身が重くなるため）。開いた直後の CPU の一覧は、次の更新まで「計測しています…」と出ます

## インストール

[Releases](https://github.com/2204601/workbench/releases?q=meter) から最新版をダウンロードしてください。

| OS | ファイル | 入れ方 |
| --- | --- | --- |
| macOS（Apple Silicon / M1 以降） | `Meter_<バージョン>_aarch64.dmg` | 開いて `Meter.app` を「アプリケーション」フォルダへドラッグ |
| Windows（64 ビット） | `Meter_<バージョン>_x64-setup.exe` | 実行してインストーラの指示に従う |

Intel Mac 向けの版は配布していません。

### 初回起動

署名（Apple Developer ID / Windows コード署名）なしのビルドなので、**初回インストール時だけ**警告が出ます。

- **macOS**: `.dmg` を開いて `Meter.app` を「アプリケーション」へコピー → 起動すると「開発元を検証できない」と出るので「完了」→ **システム設定 › プライバシーとセキュリティ** の下にある「このまま開く」を押します。
  ターミナルで `xattr -dr com.apple.quarantine /Applications/Meter.app` を実行しても構いません。
- **Windows**: `-setup.exe` を実行 → SmartScreen が出たら「詳細情報」→「実行」。

自分で起動したときは、ポップアップが一度開きます。

### Windows：アイコンをタスクバーに出す

Windows 11 は、新しいアプリのアイコンを最初はタスクバーの「^」（隠れているインジケーター）の中に入れます。いつも見えるようにするには、次のどちらかをしてください。

- 「^」を開き、Meter のアイコンをタスクバーへドラッグする（項目ごとに 1 つずつ）
- **設定 › 個人用設定 › タスク バー › その他のシステム トレイ アイコン** で Meter をオンにする（項目の数だけ並んでいます）

一度出せば、次の起動からも同じ場所に出ます。アイコンどうしの並び順も、ドラッグで変えられます。

### ログイン時に起動

初めて起動したときに「ログイン時に起動」がオンになります。メニューの「ログイン時に起動」で、いつでもオン・オフできます（一度オフにすれば、勝手にオンに戻ることはありません）。ログイン時の起動では、ポップアップは開かずにタスクトレイ / メニューバーで待機します。

- macOS では、オンになったときに「バックグラウンド項目が追加されました」という通知が出ることがあります。**システム設定 › 一般 › ログイン項目** にも表示されます
- macOS で `.dmg` の中から直接起動しているとき（「アプリケーション」へコピーしていないとき）は、オンにしません

### アップデート

アプリ内で更新します。

- 起動から数秒後と、起動したままなら 1 日 1 回、新しいバージョンを確認します。あればダイアログで知らせます（「更新して再起動」で適用、「あとで」なら次の確認でまた知らせます）
- 手動で確認するには、アイコンを右クリック →「アップデートを確認…」。ダウンロード中の進み具合は、同じメニューの項目に表示されます

会社のネットワークなどでプロキシが必要な場合は、OS のプロキシ設定（自動プロキシ設定の PAC を含む）をそのまま使います。

### 知っておくとよいこと

- 設定（出す項目、更新の間隔）は次の場所に保存されます
  - macOS: `~/Library/Application Support/dev.workbench.meter/settings.json`
  - Windows: `%APPDATA%\dev.workbench.meter\settings.json`
- ログは、メニューの「ログを表示」で開くフォルダにあります（`meter.log`）
- 測った値はディスクに残しません。グラフは起動してからの直近 2 分ぶんだけをメモリに持っています
- macOS のメニューバーは文字の幅が値によって少し変わるため、数字が変わると表示がわずかに動くことがあります

### アンインストール

- **macOS**: メニューの「ログイン時に起動」をオフにしてから、「アプリケーション」フォルダの `Meter.app` をゴミ箱へ（オフにし忘れたときは `~/Library/LaunchAgents/Meter.plist` を削除）
- **Windows**: 「設定」→「アプリ」から Meter をアンインストール

設定も消したい場合は、上の保存先のフォルダも削除してください。

## 開発

Tauri 2（Rust）＋ TypeScript（Vite、フレームワークなし）で作っています。値は Rust の [sysinfo](https://github.com/GuillaumeGomez/sysinfo) で読んでいます。

### 必要なもの

[Tauri の前提ツール](https://v2.tauri.app/start/prerequisites/)を入れてください。

- Rust（stable）
- Node.js 20 以上
- macOS: Xcode Command Line Tools
- Windows: Microsoft C++ Build Tools と WebView2（Windows 11 には最初から入っています）

### コマンド

```sh
cd meter
npm install
npm run tauri dev      # 開発モードで起動（画面の変更はすぐ反映されます）
npm run dev            # ブラウザでポップアップだけ（作り物の値。src/dev/mockBackend.ts）
npm run tauri build    # インストーラを作成（macOS は .app/.dmg、Windows は -setup.exe）
npm test               # Rust のテストと型チェック
npm run lint           # ESLint、cargo fmt --check、clippy（CI と同じ）
```

作成したインストーラは `src-tauri/target/release/bundle/` に出力されます。

`npm run tauri build` にはアプリ内アップデート用の署名鍵が要ります（`createUpdaterArtifacts` が有効なため）。鍵なしでインストーラだけ作るときは、更新ファイルを作らない設定を足します。

```sh
TAURI_SIGNING_PRIVATE_KEY="$(cat <秘密鍵のファイル>)" npm run tauri build
# 鍵なし
echo '{"bundle":{"createUpdaterArtifacts":false}}' > /tmp/no-updater.json
npm run tauri build -- --config /tmp/no-updater.json
```

開発モード（`npm run tauri dev`）では自動のアップデート確認はしません（メニューの「アップデートを確認…」は動きます）。「ログイン時に起動」も自動ではオンにしません。

Linux でもビルドとテストはできます。トレイは Windows と同じ項目ごとのアイコンになります（Linux 向けには配布しません）。

### 構成

| パス | 役割 |
| --- | --- |
| `index.html`, `src/main.ts` | ポップアップ。受け取った値を各カードに描く |
| `src/chart.ts` | 直近 1 分の折れ線グラフ（canvas）と、マウスを乗せたときの値 |
| `src/api.ts`, `src/dev/mockBackend.ts` | Rust のコマンドとイベントの型付きの呼び出し口と、ブラウザで開いたときの作り物の値 |
| `src/format.ts`, `src/log.ts`, `src/styles.css` | 数の書き方、ログへの送り出し、見た目（ライト / ダークは OS に合わせる） |
| `src-tauri/src/sampler.rs` | CPU・メモリ・ディスク・ネットワーク・アプリごとの使用量を読む（sysinfo）。速さの計算、仮想アダプタの除外、アプリへのまとめ方。ユニットテストもここ |
| `src-tauri/src/monitor.rs` | 一定の間隔で読むループ。トレイへ渡し、ポップアップが開いていればそちらにも送る。グラフ用の直近 120 回分 |
| `src-tauri/src/tray.rs` | トレイのアイコン（Windows は項目ごと、macOS は文字 1 つ）とメニュー |
| `src-tauri/src/badge.rs` | Windows のトレイアイコンの描画。16 × 16 の升目で作ったドット文字を、実際のアイコンの大きさで描く |
| `src-tauri/src/format.rs` | メニューバーの文字、ツールチップ、アイコンに入る短い値（`4.5M`） |
| `src-tauri/src/popup.rs` | ポップアップを開く位置（クリックしたアイコンのそば、タスクバーの反対側）と、ほかをクリックしたら閉じる |
| `src-tauri/src/settings.rs` | 出す項目と更新の間隔、`settings.json` への保存 |
| `src-tauri/src/lib.rs` | plugin の配線、ログ、画面から呼ぶコマンド |
| `src-tauri/src/login_item.rs` | ログイン時に起動（初回に一度だけオンにする、メニューのチェック項目） |
| `src-tauri/src/update.rs`, `src-tauri/src/proxy.rs` | アプリ内アップデートと、OS のプロキシ設定（PAC を含む）の確認。Clip から写したもの |
| `CLAUDE.md`, `decisions/` | 開発の基準（[desktop-platform](https://github.com/jazmf-dx/desktop-platform)）への参照、前提（`project-context.md`）、基準から外れているところの記録（ADR） |
| `src-tauri/tauri.conf.json` | アプリ名・バージョン・ウィンドウ設定・作るインストーラの種類 |
| `src-tauri/capabilities/default.json` | 画面に許可する操作（権限） |
| `src-tauri/icons/` | アプリアイコン（`app-icon.svg` から `npx tauri icon` で生成） |

### CI

`meter/` 以下か `.github/workflows/meter.yml` を変える PR を作ったとき（その後の push も含む）と、それが `main` にマージされたときに、GitHub Actions で macOS（Apple Silicon）と Windows のテストとビルドが走ります。PR のない作業ブランチへの push では走りません。作られたインストーラは、実行結果ページの Artifacts からダウンロードできます。

署名鍵の Secrets（下記）が使えないとき（フォークからの PR など）は、アップデート用のファイルを作らずにインストーラだけをビルドします。

### リリース手順

1. バージョンを上げる（3 か所とも同じ値にします）
   - `package.json` … `npm version <バージョン> --no-git-tag-version`（`package-lock.json` も更新されます）
   - `src-tauri/tauri.conf.json` の `version`
   - `src-tauri/Cargo.toml` の `version`（`Cargo.lock` は `cargo update -p meter` で更新）
2. [`CHANGELOG.md`](CHANGELOG.md) に `## <バージョン>` の節を書く。この節がそのままリリースの本文になります
3. PR を作って `main` にマージする
4. GitHub の Actions → **meter** → **Run workflow** で、ブランチ `main`、`release` にチェックを入れて実行する

ビルドが通ると `meter-v<バージョン>` のタグと Release が作られ、`.dmg` と `-setup.exe` が添付されます。`meter-v<バージョン>` のタグを直接 push しても同じ動きになります。

- 同じバージョンのタグがすでにある場合は失敗します（先にバージョンを上げてください）
- `CHANGELOG.md` に該当バージョンの節がない場合も失敗します
- アップデート用のファイル（署名）がない場合も失敗します（Secrets を確認してください）

### アプリ内アップデートの仕組み

リリースには、インストーラのほかにアプリ内アップデート用のファイル（`Meter.app.tar.gz` と `.sig`、`-setup.exe` の `.sig`、`latest.json`）が添付されます。

インストール済みのアプリは `https://github.com/2204601/workbench/releases/download/meter-updater/latest.json` を見ます（`tauri.conf.json` の `plugins.updater.endpoints`）。このリポジトリには他のツールのリリースも並ぶため、リリースのたびに `meter-updater` という固定のリリース（プレリリース扱い）の `latest.json` を新しい版のものに置き換えています。**`meter-updater` のリリースとタグは消さないでください**（配布済みのアプリが更新を見つけられなくなります）。

更新ファイルの署名鍵は、workbench の他のツールと共通の GitHub Actions の Secrets（`TAURI_SIGNING_PRIVATE_KEY`、`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`）を使います。対応する公開鍵は `tauri.conf.json` の `plugins.updater.pubkey` です。

## 今後の候補

- GPU の使用率、CPU の温度
- バッテリーの残量と充電の状態
- 使用率が高い状態が続いたときの通知
- アイコンの色の境目を設定で変えられるようにする

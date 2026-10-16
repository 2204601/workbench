# ブラウザで動かす試し（WebAssembly）

PDF One の画面と保存の処理を、そのまま **普通のブラウザ** で動かせるかを確かめた記録（2026-10-16）。きっかけは、DX ポータル（Web）の便利ツール「PDFツール」を PDF One のようにできないか、という相談。

**結論：動く。** `src-tauri/src/pdf/` の Rust をそのまま WebAssembly にでき、PDF One の画面（`src/`）はブラウザで本物の PDF を開き、書き込み、保存できた。コードの写しは作っていない。

## 1. 仕組み

```
src/（画面。そのまま）
  └ api.ts の invoke ──▶ src/dev/wasmBackend.ts（Tauri のコマンドに答える）
                            ├ PDF の読み書き ──▶ wasm/（src-tauri/src/pdf/ を #[path] で読み込んでビルド）
                            ├ ファイルを開く ──▶ ブラウザのファイル選択
                            ├ 保存 ──▶ ダウンロード
                            └ ほか（設定・下書き） ──▶ mockBackend.ts の mockCommand
```

- `wasm/`：`src-tauri/src/pdf/mod.rs` を `#[path]` で取り込むだけのクレート。`AppState` の代わりに、開いた文書と画像をメモリに持ち、`open` / `takeView` / `textLines` / `compose` / `addImage` / `imageBytes` / `setFont` を出す
- `src/dev/wasmBackend.ts`：`mockBackend.ts` と同じく `mockIPC` で Tauri のコマンドに答える。画面（`src/components/`、`src/lib/`）は変えていない。`main.tsx` で `?backend=wasm` のときにこちらを使う
- `src-tauri/src/pdf/` の変更は 2 か所だけ
  - `font.rs`：`FontFile::from_bytes`（メモリにあるフォントから。`load` はこれを呼ぶ）
  - `mod.rs`：`pdf_date_now` の時刻。wasm では `SystemTime::now()` が panic するので `js_sys::Date::now()`
- lopdf は乱数（getrandom）を使うので、wasm では `wasm_js` 機能で `crypto.getRandomValues` を使う

## 2. 動かし方

```bash
rustup target add wasm32-unknown-unknown
cargo install wasm-bindgen-cli --version 0.2.129 --locked   # wasm/Cargo.toml の wasm-bindgen と同じ版
npm run build:wasm                                          # wasm/pkg/ ができる（git には入れない）
mkdir -p public/fonts && cp <日本語フォント> public/fonts/jp.ttf   # 下の §4
npm run dev                                                 # http://localhost:1420/?backend=wasm
```

`?backend=wasm` を付けないときは、これまでどおりモック（`mockBackend.ts`）。

## 3. 確かめたこと

Chromium（Playwright）で、ブラウザ版の PDF One を操作した。

| 操作 | 結果 |
|---|---|
| 「PDF を開く」→ ファイル選択 → 表示（10 ページの PDF） | ○ |
| 文字を置く（日本語）→ 保存 → ダウンロード | ○ 画面と同じ位置・同じフォント。フォントは使った文字だけ埋め込み（`CID TrueType / Identity-H`、pdffonts で確認） |
| 文字を直す（もとの行をクリックして打ち直す） | ○ 保存した PDF から元の文字が消え、新しい文字になっている（pdftotext で確認） |
| ページを回転して保存 | ○ `/Rotate 90` |
| 日付印・四角・テキストボックスを付けて保存 → 開き直す | ○ 同じ注釈が戻る（Node から wasm を直接呼んで確認） |
| 白紙ページ・ほかのページを混ぜて組み立て | ○ |
| Rust のテスト（`src-tauri/src/pdf/` の 36 件） | ○ 変更後も全部通る |

### 大きさと速さ

| | |
|---|---|
| wasm の大きさ | 2.4 MB（gzip 0.87 MB） |
| 読み込み（初期化） | 約 10 ms（Node）、フォントの登録を含めて約 120 ms（Chromium） |
| 100 ページを組み立てて保存 | 28 ms（1.2 MB） |
| 300 ページを組み立てて保存 | 44 ms（3.7 MB） |
| 日本語フォント（IPA ゴシック） | 6.2 MB（gzip 4.3 MB）。これがいちばん重い |

## 4. デスクトップ版と違うところ

- **日本語フォント**：ブラウザからは OS のフォント（游ゴシック、ヒラギノ）を読めない。サーバーから 1 つ配る（`public/fonts/jp.ttf`。ライセンスと大きさのため git には入れない）。使えるのは TrueType か OpenType（CFF）で、可変フォントは使えない（subsetter が対応していない）。候補：IPAex ゴシック、Noto Sans JP（静的な版）。Chromium だけなら Local Font Access API（`queryLocalFonts`）で OS のフォントを読む手もある（許可の確認が出る）
- **保存**：上書きとバックアップは無い。毎回ダウンロード。分割は 1 ファイルずつダウンロードになる
- **ドロップで開く**：Tauri のドロップの仕組みを使っているので、ブラウザでは効かない（試しでは作っていない）
- **印鑑のライブラリ・下書き・設定**：試しではページを閉じると消える。Web 版にするなら IndexedDB か、サーバー（人ごとに持てる）
- **アップデート、「このアプリで開く」、メニューバー、二重起動の防止**：Web には要らない
- **pdf.js の版**：PDF One は 6.x、DX ポータルの PDF ツールは 3.11.174 を `static/js/vendor/` に置いている

## 5. DX ポータルに載せるなら

1. **共有の形を決める**：`src-tauri/src/pdf/` は今の場所のまま、wasm と画面を npm パッケージ（GitHub Packages）にして DX ポータルから使う、が手堅い。DX ポータルはもう `@jazmf-dx/application-ui-kit` を同じ形で使っている
2. **画面の差し替え口**：`api.ts` は今 `invoke` を直接呼ぶ。Web 版では `mockIPC` ではなく、`api.ts` の下に「Tauri / ブラウザ」を切り替える層を置く
3. **島として載せる**：DX ポータルの React Islands の 1 つにする。React 19・Tailwind v4・lucide-react は同じ。色は DX ポータルの Semantic Token に合わせる
4. **今の PDF ツールとの関係**：軽くする・鍵をかける・画像にする・文字認識は今の PDF ツールにあり、PDF One に無い。置き換えではなく「編集する」の入口を足す
5. **ファイルはサーバーに送らない**（今の PDF ツールの約束）は、このやり方なら守れる。処理はすべてブラウザの中

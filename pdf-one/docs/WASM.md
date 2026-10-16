# ブラウザで動かす試し（WebAssembly）

PDF One の画面と保存の処理を、そのまま **普通のブラウザ** で動かせるかを確かめた記録（2026-10-16）。きっかけは、DX ポータル（Web）の便利ツール「PDFツール」を PDF One のようにできないか、という相談。

**結論：動く。** `src-tauri/src/pdf/` の Rust をそのまま WebAssembly にでき、PDF One の画面（`src/`）はブラウザで本物の PDF を開き、書き込み、保存できた。コードの写しは作っていない。

## 1. 仕組み

```
src/（画面。そのまま）
  └ api.ts の invoke ──▶ src/dev/wasmBackend.ts（Tauri のコマンドに答える）
                            ├ PDF の読み書き ──▶ wasm/（src-tauri/src/pdf/ を #[path] で読み込んでビルド）
                            ├ ファイルを開く ──▶ ブラウザのファイル選択、ドロップ（src/lib/browserFiles.ts）
                            ├ 保存 ──▶ ダウンロード
                            └ ほか（設定・下書き） ──▶ mockBackend.ts の mockCommand
```

- `wasm/`：`src-tauri/src/pdf/mod.rs` を `#[path]` で取り込むだけのクレート。`AppState` の代わりに、開いた文書と画像をメモリに持ち、`open` / `takeView` / `textLines` / `compose` / `addImage` / `imageBytes` / `setFont` を出す
- `src/dev/wasmBackend.ts`：`mockBackend.ts` と同じく `mockIPC` で Tauri のコマンドに答える。`main.tsx` で `?backend=wasm` のときにこちらを使う
- 画面の変更は `DropZone.tsx` だけ：Tauri の外では、ページ自身のドロップのイベントで同じことをする（PDF を開く、ページ一覧に落とせばページとして足す、画像はページに置く）。Tauri の `isTauri()` を偽って Tauri のドロップを真似ると、メニューバーやアップデートまで動き出すので、そうしない
- `src/lib/browserFiles.ts`：ブラウザから受け取ったファイル（選択・ドロップ）に仮のパスを付けて持つ。アプリはファイルをパスで渡すので、`wasmBackend.ts` はこのパスで読み戻す
- 日本語フォントは Noto Sans JP（SIL OFL 1.1）の Regular。npm の `@expo-google-fonts/noto-sans-jp`（Google Fonts の静的な版。版は固定）から Vite が配る
- `src-tauri/src/pdf/` の変更は 2 か所だけ
  - `font.rs`：`FontFile::from_bytes`（メモリにあるフォントから。`load` はこれを呼ぶ）
  - `mod.rs`：`pdf_date_now` の時刻。wasm では `SystemTime::now()` が panic するので `js_sys::Date::now()`
- lopdf は乱数（getrandom）を使うので、wasm では `wasm_js` 機能で `crypto.getRandomValues` を使う

## 2. 動かし方

```bash
rustup target add wasm32-unknown-unknown
cargo install wasm-bindgen-cli --version 0.2.129 --locked   # wasm/Cargo.toml の wasm-bindgen と同じ版
npm run build:wasm                                          # wasm/pkg/ ができる（git には入れない）
npm run dev                                                 # http://localhost:1420/?backend=wasm
```

`?backend=wasm` を付けないときは、これまでどおりモック（`mockBackend.ts`）。

## 3. 確かめたこと

Chromium（Playwright）で、ブラウザ版の PDF One を操作した。

| 操作 | 結果 |
|---|---|
| 「PDF を開く」→ ファイル選択 → 表示（10 ページの PDF） | ○ |
| ドロップ：PDF を開く／左のページ一覧に PDF を落としてページを足す（10 → 20 ページ）／画像をページに置く | ○ ドラッグ中は「ドロップして開く」が出る |
| 文字を置く（日本語）→ 保存 → ダウンロード | ○ 画面と同じ位置・同じフォント（Noto Sans JP）。使った文字だけ埋め込み（`NotoSansJP-Regular`、`CID TrueType / Identity-H`、pdffonts で確認） |
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
| 日本語フォント（Noto Sans JP Regular） | 5.5 MB（gzip 3.1 MB）。これがいちばん重い。最初に 1 回読めば、あとはブラウザのキャッシュ |

## 4. デスクトップ版と違うところ

- **日本語フォント**：ブラウザからは OS のフォント（游ゴシック、ヒラギノ）を読めないので、Noto Sans JP を配る。画面のテキストボックスも同じフォントで描く（`FontFace` で登録）ので、画面とファイルの改行は同じ。デスクトップ版とは字の形が違う。可変フォントは使えない（subsetter が対応していない）ので、静的な版を使う
- **保存**：上書きとバックアップは無い。毎回ダウンロード。分割は 1 ファイルずつダウンロードになる
- **ドロップ**：同じように使える。ただしドラッグ中はファイル名が分からない（種類は分かる）ので、「ドロップして開く」を出すかは種類（`application/pdf`）で決める
- **印鑑のライブラリ・下書き・設定**：試しではページを閉じると消える。Web 版にするなら IndexedDB か、サーバー（人ごとに持てる）
- **アップデート、「このアプリで開く」、メニューバー、二重起動の防止**：Web には要らない
- **pdf.js の版**：PDF One は 6.x、DX ポータルの PDF ツールは 3.11.174 を `static/js/vendor/` に置いている

## 5. DX ポータルに載せるなら

1. **共有の形を決める**：`src-tauri/src/pdf/` は今の場所のまま、wasm と画面を npm パッケージ（GitHub Packages）にして DX ポータルから使う、が手堅い。DX ポータルはもう `@jazmf-dx/application-ui-kit` を同じ形で使っている
2. **画面の差し替え口**：`api.ts` は今 `invoke` を直接呼ぶ。Web 版では `mockIPC` ではなく、`api.ts` の下に「Tauri / ブラウザ」を切り替える層を置く
3. **島として載せる**：DX ポータルの React Islands の 1 つにする。React 19・Tailwind v4・lucide-react は同じ。色は DX ポータルの Semantic Token に合わせる
4. **今の PDF ツールとの関係**：軽くする・鍵をかける・画像にする・文字認識は今の PDF ツールにあり、PDF One に無い。置き換えではなく「編集する」の入口を足す
5. **ファイルはサーバーに送らない**（今の PDF ツールの約束）は、このやり方なら守れる。処理はすべてブラウザの中

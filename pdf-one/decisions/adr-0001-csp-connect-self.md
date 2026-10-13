# ADR-0001: CSP の connect-src に 'self' を足す

**状態**：採用
**日付**：2026-10-13

## 状況

Platform Security §1 の既定の CSP は `connect-src` が `ipc: http://ipc.localhost` だけで、アプリ自身のファイルを fetch できない。

pdf.js のワーカーは、実行中に次をアプリ自身のファイル（`dist/pdfjs/`）から fetch する。

- CMap（`cmaps/*.bcmap`）：フォントを埋め込んでいない日本語の PDF（官公庁や古い帳票に多い）を表示するのに要る
- 標準 14 フォント（`standard_fonts/`）
- JPEG 2000 と JBIG2 の JavaScript デコーダ（`wasm/*_nowasm_fallback.js`、こちらは import）

既定の CSP のままでは CMap の読み込みが拒否され、日本語が表示されない（ブラウザで同じ CSP を付けて再現した）。

## 決定

`tauri.conf.json` の `app.security.csp` の `connect-src` を `'self' ipc: http://ipc.localhost` にする。ほかの項目は既定のまま。

## 理由

- `'self'` はアプリに同梱したファイルだけで、外への通信は増えない
- 退けた案：CMap などを JavaScript に埋め込んで fetch を無くす。pdf.js の `CMapReaderFactory` を差し替えれば可能だが、pdf.js の内部に依存し、更新のたびに壊れうる。CMap だけで約 1 MB あり、起動時に読み込むことになる
- 退けた案：WebAssembly のデコーダを使う。`'wasm-unsafe-eval'` が要り、CSP の緩和が大きい。JavaScript 版で足りる（`useWasm: false`）

## 影響

- `src-tauri/tauri.conf.json` の CSP だけ。ほかのツールは関係ない（Optional improvement にもならない）
- 外のリソースを読む機能を足すときは、引き続き CSP にその出どころを書き足す（`*` で開けない）

## 見直す条件

- pdf.js が fetch 以外で同梱ファイルを読めるようになったとき
- Platform の既定の CSP に `'self'` が入ったとき（この ADR は不要になる）

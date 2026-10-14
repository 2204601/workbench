# 設計

Platform の [Architecture Standard](../../../desktop-platform/standards/architecture.md) に沿う。ここにはこのツール固有の境界だけを書く。振る舞いは [SPEC.md](SPEC.md)。

## 1. 方針：表示は pdf.js、書き込みは Rust

| | 担当 | 理由 |
|---|---|---|
| 表示（ページの絵、文字の層、フォームとリンクの層、サムネイル、検索の文字） | pdf.js（`pdfjs-dist` の legacy ビルド、ワーカーで動く） | 表示の互換性が高い。Firefox の PDF 表示そのもの |
| 編集中の状態（ページの並び、回転、注釈） | フロントの store（ただのデータ） | 並べ替えや回転を、ファイルを作り直さずにすぐ見せられる。元に戻すがデータのスナップショットで済む |
| 注釈の描画と道具 | React（`Overlay.tsx`、画面の座標で SVG と HTML） | 選択、移動、大きさの変更、入力をそのまま扱える |
| 保存（ページの組み立て、注釈、フォームの値、フォントと画像の埋め込み） | Rust（lopdf、subsetter、skrifa、image） | 重い処理をウィンドウの外で。テストが cargo test で書ける |

**pdf.js の保存（`saveDocument`）は使わない**。日本語のテキストを、埋め込まないフォント名（`InvalidPDFjsFont_…`）で書くので、pdf.js 以外（Acrobat など）では文字化けする。

## 2. 開くとき（`pdf/open.rs`）

1. Rust がファイルを読み、中身で PDF か確かめ、lopdf で読む（1 つのストリームを 512 MB 以上に展開しない）
2. 保護（/Encrypt）、XFA、読めない PDF は **表示だけ**：pdf.js には元のバイト列をそのまま渡す
3. 編集できる注釈（SPEC §6 の種類）をページから **取り出し**、`Annot` のデータとしてフロントへ返す。pdf.js にはそれを除いた PDF を渡す。同じ注釈を pdf.js と Overlay が二重に描かないため
   - 取り出すものが無ければ、元のバイト列をそのまま渡す（書き直さない）
4. 取り出した後の lopdf の文書を、保存のもととしてメモリに持つ（`AppState.docs`）

自分で書いた注釈は /NM が `pdfe-` で始まり、標準の項目に入らないもの（テキストボックスの塗りと文字の大きさ、画像の回転、印鑑の形）を `/PDFOneStyle`（JSON）に持つ。画像と印鑑（Stamp）は、自分で書いたものだけを読み戻す（見た目の作り方が分かっているため）。印鑑は線と埋め込みフォントの文字で描き、文字の置き方（`annots.rs` の `seal_layout`）は画面（`lib/seal.ts`）と同じ規則にする。

## 3. 保存するとき（`pdf/compose.rs`）

フロントが送るもの：ページの並び（どの文書の何ページ目か、または白紙、回転）、ページごとの注釈、文書ごとのフォームの値（pdf.js のフォームの保存領域）。テキストボックスの行の折り返しはフロントで決めて送る（§5）。

1. 最初のページの文書を **土台** にする（カタログ、しおり、メタデータ、フォームの設定はこれのもの）
2. ほかの文書は、オブジェクト番号を土台の後ろへずらしてから、全部を土台へ写す（使わないものは最後に消える）
3. フォームの値を書く（`forms.rs`）
4. ページを新しい 1 段のページツリーに並べ直す。親から受け継いでいた Resources、MediaBox、CropBox、Rotate はページ自身に書く。同じページが 2 回あれば、2 つ目は注釈の無い写しにする
5. 注釈を書く（`annots.rs`）。どの注釈にも見た目（/AP）を付けるので、ビューアが勝手に描かない
6. フォームのフィールド一覧を、残ったページのウィジェットから作り直す。ほかの文書のフィールドと名前が重なれば `_2` を付ける。XFA は消す
7. 外したページを指していたもの（しおり、リンク）は null にする。でないと、見えないページがファイルに残る
8. 届かないオブジェクトを消し（lopdf の `prune_objects` は大きなファイルで遅いので自前）、オブジェクトストリームで書く
9. 同じフォルダの一時ファイルに書いてから入れ替える。上書きなら先にバックアップ（`files.rs`）

### ページの中身を書き換える例外（`pdf/textedit.rs`）

文字の修正（`AnnotKind::Edit`）だけは、注釈ではなくページの内容ストリームを書き換える（[ADR-0003](../decisions/adr-0003-rewrite-page-content-for-text-fixes.md)）。`lines(doc, page)` が内容を読んで文字の行（位置・大きさ・色・フォント、`ops` = 描いた命令の番号）を返し、`apply` が `compose` の中で、直された行の命令を「位置だけ進める」命令に置き換えて新しい文字を足す。フロントの `lib/textedit.ts` は箱の高さの定数（`BOX_ASCENT` / `BOX_DESCENT`）を Rust と同じにする。

## 4. 座標

- 注釈の座標は **ページ自身の PDF 座標**（ポイント、左下が原点、/Rotate の前）で持つ。ページを回転・移動しても注釈は変わらない
- 画面との変換は pdf.js の PageViewport と同じ行列（`lib/geometry.ts` の `viewportTransform`）。回転は 90° 単位なので、四角は四角のまま
- テキストボックスと画像の `rotation` は「そのページを何度回して見ているときに正立するか」。PDF には外観ストリームの /Matrix と /Rotate（Acrobat が読む）で書く
- マーカーの /QuadPoints は、文字が画面でどちら向きに流れているか（文字の層の回転）から、上下左右を決める

## 5. 日本語フォント（`pdf/font.rs`、`lib/text.ts`）

- アプリはフォントを持たない。OS の日本語フォントを探し（SPEC §9）、使った文字のグリフだけを subsetter で抜き出して埋め込む。CID フォント（Identity-H）、TrueType は FontFile2、CFF（ヒラギノ）は FontFile3/OpenType。ToUnicode を付けるので、検索とコピーができる
- 埋め込みが禁止されたフォント（OS/2 fsType）は使わない
- 画面のテキストボックスは同じフォント（CSS のファミリー名を Rust が返す）で描き、折り返しは canvas で測って決める。決めた行を保存に送るので、画面とファイルの改行が同じになる。カーニングは使わない（PDF 側に無いため）

## 6. 層

| 層 | 中身 |
|---|---|
| shell | proxy、updater、log の配線、single-instance、window-state、settings.json、「このアプリで開く」（Disk Analyzer から写した。desktop-base ができたら差し替える） |
| core | PDF の読み書き（`src-tauri/src/pdf/`）、ファイル（`files.rs`）、pdf.js の文書（`lib/pdfjs.ts`）、store、コマンド表 |
| features | ビューア、注釈の道具、ページの整理、検索、フォーム、画像・印鑑 |

## 7. IPC

| コマンド | |
|---|---|
| `open_pdf` → `pdf_view_bytes` | 開いて、pdf.js に見せるバイト列を 1 回だけ渡す（`tauri::ipc::Response` でそのままのバイト列） |
| `save_pdf` | ページ・注釈・フォームの値から書く。重いので別スレッド |
| `add_image` / `add_image_bytes` / `image_bytes` | 画像はRust の画像置き場に持ち、id で指す。貼り付けはバイト列のまま送る |
| `compose_pdf` | `save_pdf` と同じ組み立てをして、書かずにバイト列で返す（印刷。`lib/print.ts` が pdf.js で絵にする） |
| `text_lines` | 開いた文書の 1 ページの文字の行を返す（直せるものと、直せない理由付きのもの。`pdf/textedit.rs`）。「文字を直す」の道具を持っている間だけ、ページごとに 1 回呼ぶ |
| `list_stamps` / `add_stamp` / `add_stamp_bytes` / `remove_stamp` / `use_stamp` | ライブラリ（`stamps/`）。id はファイル名で、フォルダの外を指すものは断る。`add_stamp_bytes` はアプリで描いた署名（PNG のバイト列） |
| `write_draft` / `list_drafts` / `remove_draft` | 下書き（`drafts/<場所のハッシュ>/`：state.json、meta.json、使った画像）。`lib/drafts.ts` が 30 秒ごとに書き、起動時に一覧して「戻す」 |
| `take_open_requests` | OS から来た「開く」（起動時の引数、2 つ目の起動、macOS の Opened）。ページが読み込まれる前に来ても失わないよう、Rust が貯めておく |

## 8. 印刷

ページを画像にして WebView の印刷に渡す（`lib/print.ts`）。Rust が保存と同じ PDF を組み（`compose_pdf`。注釈の見た目と入力欄の値が入っている）、pdf.js で 150 dpi に描いた絵を、`#print-root`（印刷のときだけ見える）に用紙サイズのシートとして並べ、`window.print()` を呼ぶ。OS の印刷ダイアログはプリンター・部数・両面を受け持つ。WebView の印刷が使えない環境になったら、Rust から OS の印刷（Windows は XPS、macOS は `NSPrintOperation`）に切り替える（ROADMAP 0.2 の技術メモ）。

## 9. CSP

pdf.js のワーカーは、CMap（埋め込まれていない日本語のフォント用）、標準フォント、JPEG 2000 と JBIG2 の JavaScript デコーダを、アプリ自身のファイルから fetch / import する。そのため `connect-src` に `'self'` を足した（[ADR-0001](../decisions/adr-0001-csp-connect-self.md)）。WebAssembly は使わない（`useWasm: false`）ので `'wasm-unsafe-eval'` は要らない。

## 10. テスト

- Rust のユニットテスト：注釈の種類ごとの外観、開く→取り出す、ページの並べ替え・回転・結合・白紙・重複、フォームの値、フォントの埋め込み（`tests/fixtures/LiberationSans-Regular.ttf`、SIL OFL）、画像、バックアップ
- `tests/ipc.rs`：JS と同じ引数で、開く → 注釈 6 種（印鑑を含む）と別の文書のページと白紙で保存 → 開き直して同じ注釈が戻る、印刷用の組み立て、上書きのバックアップ、エラーの文言、設定とライブラリ
- `examples/sample.rs`：注釈を 1 つずつ書いた PDF を作る。Acrobat、Edge、プレビュー、pdftoppm での見え方を目で確かめる用
- フロント：型チェックと eslint。UI はブラウザのモック（`npm run dev`）で確かめる

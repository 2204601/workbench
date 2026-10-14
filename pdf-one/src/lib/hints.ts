/**
 * What the status bar says (docs/UX.md §4, §6): the tool in hand and what
 * to do with it, or what is selected. Written for someone who has never
 * used the app: what to do next, and how to get back to 選択.
 */
import type { AnnotKind } from "./api";
import { activeDoc, findAnnot, type S, type Tool } from "../store";

/** Annotation kinds in everyday words (UX §3). */
export const KIND_LABEL: Record<AnnotKind, string> = {
  highlight: "マーカー",
  underline: "下線",
  strikeout: "取り消し線",
  ink: "ペン",
  rect: "四角",
  ellipse: "丸",
  line: "線",
  arrow: "矢印",
  text: "文字",
  note: "付箋",
  image: "印鑑・画像",
  seal: "印",
  edit: "文字の修正",
};

const BACK = "終わるには「選択」を押すか Esc";

/** Tools that stay in hand until 選択 is pressed. */
export const CONTINUOUS: Tool[] = ["highlight", "underline", "strikeout", "ink", "hand"];

function toolHint(tool: Tool, sticky: boolean): string {
  const again = sticky ? `続けて置けます。${BACK}` : "置くと「選択」に戻ります";
  switch (tool) {
    case "select":
      return "ページの上のものはクリックで選べます。文字をなぞると、マーカーやコピーのメニューが出ます";
    case "hand":
      return `いま：手のひら。ドラッグでページを動かせます。${BACK}`;
    case "highlight":
      return `いま：マーカー。文字をなぞると引けます。文字の無いところはドラッグで囲みます。${BACK}`;
    case "underline":
      return `いま：下線。文字をなぞると引けます。${BACK}`;
    case "strikeout":
      return `いま：取り消し線。文字をなぞると引けます。${BACK}`;
    case "text":
      return `いま：文字を置く。置きたい場所をクリックして入力します。${sticky ? `続けて置けます。${BACK}` : "入力が終わると「選択」に戻ります"}`;
    case "note":
      return `いま：付箋。置きたい場所をクリックしてコメントを入力します。${again}`;
    case "ink":
      return `いま：ペン。ドラッグで書けます。${BACK}`;
    case "rect":
      return `いま：四角。ドラッグで描きます（⇧ で正方形）。${again}`;
    case "ellipse":
      return `いま：丸。ドラッグで描きます（⇧ で正円）。${again}`;
    case "line":
      return `いま：線。ドラッグで引きます（⇧ で 45° 刻み）。${again}`;
    case "arrow":
      return `いま：矢印。ドラッグで引きます。先が矢になります。${again}`;
    case "image":
      return `いま：印鑑・画像。置きたい場所をクリックします（ドラッグで大きさも決められます）。${again}`;
    case "fill":
      return `いま：記入。書き入れたい場所をクリックして入力します。${sticky ? `続けて書けます。${BACK}` : "入力が終わると「選択」に戻ります"}`;
    case "check":
      return `いま：チェック。付けたい場所をクリックします。${again}`;
    case "cross":
      return `いま：バツ。付けたい場所をクリックします。${again}`;
    case "dot":
      return `いま：黒丸。付けたい場所をクリックします。${again}`;
    case "dash":
      return `いま：横線。引きたい場所をクリックします。${again}`;
    case "date":
      return `いま：日付。置きたい場所をクリックすると今日の日付が入ります（あとで直せます）。${again}`;
    case "eraser":
      return `いま：消しゴム。ペンで書いた線の上をなぞると消えます。${BACK}`;
    case "seal":
      return `いま：印。押したい場所をクリックします。${again}`;
    case "editText":
      return `いま：文字を直す。直したい行をクリックして打ちます（Enter か、ほかをクリックで終わり）。画像の文字や特別な文字は直せません。${BACK}`;
  }
}

/** The line for the current state. */
export function hint(s: S): string {
  const d = activeDoc(s);
  if (!d) return "";
  if (d.readOnly) return `表示だけできます：${d.readOnly}`;
  if (s.organizer) return "ページをドラッグで並べ替えます。クリックで選んで回転・削除。ダブルクリックでそのページを開きます";
  const sel = s.tool === "select" ? findAnnot(d, d.selectedAnnot) : null;
  if (sel) {
    const k = sel.annot.kind;
    const label = KIND_LABEL[k];
    if (k === "edit") return `選んでいます：${label}。ダブルクリックでもう一度直せます。Delete でもとの文字に戻せます`;
    const how =
      k === "highlight" || k === "underline" || k === "strikeout"
        ? "右の「詳細」で色を変えられます"
        : k === "text"
          ? "ダブルクリックで文字を直せます。ドラッグで動かせます"
          : k === "note"
            ? "コメントは横の吹き出しに書きます。ドラッグで動かせます"
            : "ドラッグで動かし、角で大きさを変えられます";
    return `選んでいます：${label}。${how}。Delete で消せます`;
  }
  return toolHint(s.tool, s.sticky);
}

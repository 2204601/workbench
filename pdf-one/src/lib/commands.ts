/**
 * Every operation of the app, defined once (Platform Architecture §3). The
 * menu bar, the ribbon, the right-click menus, the key handling, the
 * shortcut list and 何をしますか are made from this table, so a name and its
 * key read the same everywhere. Add an operation here first, never straight
 * into a menu or a key handler.
 *
 * Names are the everyday words of docs/UX.md §3 (書き込み, not 注釈; 印鑑, not
 * スタンプ). `words` are other things people might type to find them.
 */
import {
  ArrowRight,
  BadgeCheck,
  CalendarCheck,
  CalendarDays,
  Check,
  Circle,
  CircleDot,
  Columns2,
  Copy,
  Download,
  Eraser,
  FileInput,
  FilePlus2,
  FolderOpen,
  Hand,
  Highlighter,
  ImagePlus,
  LayoutGrid,
  Minus,
  MousePointer2,
  PanelLeft,
  PanelRight,
  PenLine,
  Plus,
  Redo2,
  RotateCcw,
  RotateCw,
  Save,
  Search,
  Signature,
  Square,
  Stamp,
  StickyNote,
  Strikethrough,
  TextCursorInput,
  Trash2,
  Type,
  Underline,
  Undo2,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  chooseAndOpen,
  chooseImage,
  closeDoc,
  deleteTargetPages,
  extractPages,
  insertBlankPage,
  insertFromFiles,
  rotateTarget,
  save,
} from "./actions";
import { api } from "./api";
import { addAnnot, moved, updateAnnot } from "./edit";
import { comboMatches, fromField } from "./keys";
import { invert, viewportTransform } from "./geometry";
import { pageBox, stepZoom } from "./layout";
import { findNext } from "./search";
import { checkForUpdate } from "./update";
import { bringToFront, deleteSelectedAnnot } from "../components/Overlay";
import { useSealDialog } from "../components/SealDialog";
import { activeDoc, findAnnot, newAnnotId, useStore, type S, type Tool } from "../store";

export interface Command {
  id: string;
  /** Name in the shortcut list and the default label. */
  title: string;
  /** The label for the current state. */
  label?: (s: S) => string;
  icon?: LucideIcon;
  /** The first is the one menus show; ⌘ / Ctrl combos become the menu's accelerator. */
  keys?: string[];
  /** Other words people type to find it (何をしますか). */
  words?: string[];
  enabled?: (s: S) => boolean;
  checked?: (s: S) => boolean;
  run: (s: S) => void;
  /** Who handles the key: the page's handler (default), or only the menu bar's accelerator. */
  keyBy?: "page" | "menu";
}

const hasDoc = (s: S) => activeDoc(s) !== null;
const editable = (s: S) => {
  const d = activeDoc(s);
  return !!d && !d.readOnly;
};
const annotSelected = (s: S) => editable(s) && !!activeDoc(s)?.selectedAnnot;
const scrollToPage = (page: number) =>
  useStore.getState().patchDoc((d) => ({ scrollTo: { page, seq: (d.scrollTo?.seq ?? 0) + 1 } }));

const zoomBy = (s: S, dir: 1 | -1) => {
  const d = activeDoc(s);
  if (d) s.patchDoc({ zoom: { mode: "scale", value: stepZoom(d.scale, dir) } });
};

/** Moves the selected annotation by (dx, dy) points as seen on screen. */
const nudge = (s: S, dx: number, dy: number) => {
  const d = activeDoc(s);
  const id = d?.selectedAnnot;
  if (!d || !id) return;
  const uid = Object.entries(d.annots).find(([, l]) => l.some((a) => a.id === id))?.[0];
  const page = d.pages.find((p) => p.uid === uid);
  if (!page) return;
  // Screen directions to PDF space, for the page's rotation.
  const { view, rotation } = pageBox(page, d.viewRotate);
  const inv = invert(viewportTransform(view, 1, rotation));
  const px = inv[0] * dx + inv[2] * dy;
  const py = inv[1] * dx + inv[3] * dy;
  s.commit((x) => updateAnnot(x, id, (a) => moved(a, px, py)));
};

/** A copy of the selected annotation, a little down and right, selected. */
const duplicate = (s: S) => {
  const d = activeDoc(s);
  const found = d && findAnnot(d, d.selectedAnnot);
  if (!d || !found) return;
  const a = { ...found.annot, ...moved(found.annot, 10, -10), id: newAnnotId(), modified: "", author: s.author };
  s.commit((x) => addAnnot(x, found.uid, a));
  s.patchDoc({ selectedAnnot: a.id });
};

export const TOOLS: { tool: Tool; title: string; icon: LucideIcon; key?: string; words?: string[] }[] = [
  { tool: "select", title: "選択", icon: MousePointer2, key: "V", words: ["選ぶ", "矢印", "カーソル"] },
  { tool: "hand", title: "手のひら", icon: Hand, key: "H", words: ["スクロール", "動かす", "つかむ"] },
  { tool: "highlight", title: "マーカー", icon: Highlighter, key: "M", words: ["ハイライト", "蛍光ペン", "黄色", "強調"] },
  { tool: "underline", title: "下線", icon: Underline, key: "U", words: ["アンダーライン"] },
  { tool: "strikeout", title: "取り消し線", icon: Strikethrough, key: "K", words: ["打ち消し", "消し線", "訂正"] },
  { tool: "text", title: "文字を置く", icon: Type, key: "T", words: ["テキスト", "文字", "入力", "書く", "記入", "タイプ"] },
  { tool: "note", title: "付箋", icon: StickyNote, key: "N", words: ["コメント", "メモ", "ノート"] },
  { tool: "ink", title: "ペン", icon: PenLine, key: "P", words: ["手書き", "サイン", "署名", "インク", "描く"] },
  { tool: "rect", title: "四角", icon: Square, key: "R", words: ["四角形", "枠", "矩形", "囲む"] },
  { tool: "ellipse", title: "丸", icon: Circle, key: "O", words: ["楕円", "円", "囲む"] },
  { tool: "line", title: "線", icon: Minus, key: "L", words: ["直線"] },
  { tool: "arrow", title: "矢印", icon: ArrowRight, key: "A", words: ["やじるし"] },
  { tool: "eraser", title: "消しゴム", icon: Eraser, key: "E", words: ["消す", "ペンを消す", "手書きを消す", "イレーザー"] },
  // 入力と署名
  { tool: "fill", title: "記入", icon: TextCursorInput, words: ["入力", "書き込む", "フォーム", "申込書", "文字を入れる", "記入する"] },
  { tool: "check", title: "チェック", icon: Check, words: ["レ点", "✓", "チェックマーク", "はい"] },
  { tool: "cross", title: "バツ", icon: X, words: ["✗", "×", "いいえ", "取り消し"] },
  { tool: "dot", title: "黒丸", icon: CircleDot, words: ["●", "丸", "選択肢", "塗りつぶし"] },
  { tool: "dash", title: "横線", icon: Minus, words: ["─", "線を引く", "下線", "空欄"] },
  { tool: "date", title: "日付", icon: CalendarDays, words: ["今日", "年月日", "日にち"] },
];

export const COMMANDS: Command[] = [
  { id: "file.open", title: "開く…", icon: FolderOpen, keys: ["Mod+O"], words: ["ひらく", "読み込む", "ファイル"], run: () => void chooseAndOpen() },
  { id: "file.save", title: "保存", icon: Save, keys: ["Mod+S"], words: ["セーブ", "上書き", "しまう"], enabled: editable, run: () => void save(false) },
  {
    id: "file.saveAs",
    title: "名前を付けて保存…",
    keys: ["Mod+Shift+S"],
    words: ["別名", "新しいファイル", "コピーを保存"],
    enabled: editable,
    run: () => void save(true),
  },
  { id: "file.close", title: "タブを閉じる", icon: X, keys: ["Mod+W"], words: ["閉じる"], enabled: hasDoc, run: () => void closeDoc() },
  {
    id: "file.backups",
    title: "バックアップのフォルダを開く",
    words: ["前の版", "戻す", "上書き前"],
    run: (s) => void api.revealBackups().catch((e) => s.toast(String(e), true)),
  },

  {
    id: "edit.undo",
    title: "元に戻す",
    icon: Undo2,
    keys: ["Mod+Z"],
    words: ["取り消す", "アンドゥ", "戻る", "やり直し"],
    enabled: (s) => !!activeDoc(s)?.past.length,
    run: (s) => s.undo(),
  },
  {
    id: "edit.redo",
    title: "やり直す",
    icon: Redo2,
    keys: ["Mod+Shift+Z", "Mod+Y"],
    words: ["リドゥ", "進む"],
    enabled: (s) => !!activeDoc(s)?.future.length,
    run: (s) => s.redo(),
  },
  {
    id: "annot.delete",
    title: "書き込みを削除",
    icon: Trash2,
    keys: ["Delete", "Backspace"],
    words: ["消す", "注釈"],
    enabled: annotSelected,
    run: () => deleteSelectedAnnot(),
  },
  { id: "annot.duplicate", title: "書き込みを複製", icon: Copy, keys: ["Mod+D"], words: ["コピー", "同じものをもう一つ"], enabled: annotSelected, run: duplicate },
  { id: "annot.front", title: "最前面へ", enabled: annotSelected, words: ["手前", "上に"], run: () => bringToFront() },
  {
    id: "edit.deselect",
    title: "選択を解除・「選択」に戻す",
    keys: ["Esc"],
    enabled: (s) => hasDoc(s) && (s.tool !== "select" || !!activeDoc(s)?.selectedAnnot || s.search.open),
    run: (s) => {
      if (s.tool !== "select") s.setTool("select");
      else if (activeDoc(s)?.selectedAnnot) s.patchDoc({ selectedAnnot: null });
      else s.setSearch({ open: false });
    },
  },
  {
    id: "edit.find",
    title: "検索",
    icon: Search,
    keys: ["Mod+F"],
    words: ["探す", "さがす", "見つける", "文字を探す"],
    enabled: hasDoc,
    run: (s) => s.setSearch({ open: true, focusSeq: s.search.focusSeq + 1 }),
  },
  { id: "edit.findNext", title: "次を検索", keys: ["Mod+G"], enabled: (s) => s.search.results.length > 0, run: () => findNext(1) },
  { id: "edit.findPrev", title: "前を検索", keys: ["Mod+Shift+G"], enabled: (s) => s.search.results.length > 0, run: () => findNext(-1) },

  { id: "view.zoomIn", title: "拡大", icon: Plus, keys: ["Mod+=", "Mod++", "Mod+;"], words: ["大きく", "ズーム"], enabled: hasDoc, run: (s) => zoomBy(s, 1) },
  { id: "view.zoomOut", title: "縮小", icon: Minus, keys: ["Mod+-"], words: ["小さく", "ズーム"], enabled: hasDoc, run: (s) => zoomBy(s, -1) },
  {
    id: "view.fitPage",
    title: "ページ全体",
    keys: ["Mod+0"],
    words: ["全体を見る", "1 ページ"],
    enabled: hasDoc,
    checked: (s) => activeDoc(s)?.zoom.mode === "fit-page",
    run: (s) => s.patchDoc({ zoom: { mode: "fit-page" } }),
  },
  {
    id: "view.actualSize",
    title: "実際のサイズ（100%）",
    keys: ["Mod+1"],
    words: ["原寸", "等倍"],
    enabled: hasDoc,
    run: (s) => s.patchDoc({ zoom: { mode: "scale", value: 1 } }),
  },
  {
    id: "view.fitWidth",
    title: "幅に合わせる",
    icon: Columns2,
    keys: ["Mod+2"],
    words: ["横幅"],
    enabled: hasDoc,
    checked: (s) => activeDoc(s)?.zoom.mode === "fit-width",
    run: (s) => s.patchDoc({ zoom: { mode: "fit-width" } }),
  },
  {
    id: "view.panel",
    title: "一覧（ページ・書き込み・しおり）",
    icon: PanelLeft,
    keys: ["F4"],
    words: ["サイドバー", "サムネイル", "左のパネル", "目次"],
    // The page organizer takes the list's place: there the button shows
    // it off, and brings back the pages with the list.
    checked: (s) => s.panel !== null && !s.organizer,
    run: (s) => {
      if (s.organizer) {
        s.setOrganizer(false);
        if (!s.panel) s.setPanel("pages");
      } else s.setPanel(s.panel ? null : "pages");
    },
  },
  {
    id: "view.details",
    title: "詳細（選んだものの色や大きさ）",
    icon: PanelRight,
    words: ["プロパティ", "色", "太さ", "右のパネル", "設定"],
    checked: (s) => s.details,
    run: (s) => s.setDetails(!s.details),
  },
  {
    id: "view.organizer",
    title: "すべてのページを並べる",
    icon: LayoutGrid,
    keys: ["Mod+Shift+O"],
    words: ["ページを整理", "並べ替え", "順番", "入れ替え", "サムネイル", "整理"],
    enabled: hasDoc,
    checked: (s) => s.organizer,
    run: (s) => s.setOrganizer(!s.organizer),
  },

  { id: "go.next", title: "次のページ", keys: ["ArrowRight", "PageDown"], enabled: (s) => hasDoc(s) && !annotSelected(s), run: (s) => scrollToPage(Math.min(activeDoc(s)!.pages.length - 1, activeDoc(s)!.page + 1)) },
  { id: "go.prev", title: "前のページ", keys: ["ArrowLeft", "PageUp"], enabled: (s) => hasDoc(s) && !annotSelected(s), run: (s) => scrollToPage(Math.max(0, activeDoc(s)!.page - 1)) },
  { id: "go.first", title: "最初のページ", keys: ["Home"], enabled: hasDoc, run: () => scrollToPage(0) },
  { id: "go.last", title: "最後のページ", keys: ["End"], enabled: hasDoc, run: (s) => scrollToPage(activeDoc(s)!.pages.length - 1) },
  { id: "annot.nudgeLeft", title: "書き込みを左へ（⇧で大きく）", keys: ["ArrowLeft", "Shift+ArrowLeft"], enabled: annotSelected, run: (s) => nudge(s, -nudgeStep, 0) },
  { id: "annot.nudgeRight", title: "書き込みを右へ", keys: ["ArrowRight", "Shift+ArrowRight"], enabled: annotSelected, run: (s) => nudge(s, nudgeStep, 0) },
  { id: "annot.nudgeUp", title: "書き込みを上へ", keys: ["ArrowUp", "Shift+ArrowUp"], enabled: annotSelected, run: (s) => nudge(s, 0, -nudgeStep) },
  { id: "annot.nudgeDown", title: "書き込みを下へ", keys: ["ArrowDown", "Shift+ArrowDown"], enabled: annotSelected, run: (s) => nudge(s, 0, nudgeStep) },

  {
    id: "page.rotateRight",
    title: "右に回転",
    icon: RotateCw,
    keys: ["Mod+Shift+R"],
    words: ["ページを回転", "向き", "横向き", "縦向き", "回す"],
    enabled: editable,
    run: () => rotateTarget(90),
  },
  { id: "page.rotateLeft", title: "左に回転", icon: RotateCcw, keys: ["Mod+Shift+L"], words: ["ページを回転", "回す"], enabled: editable, run: () => rotateTarget(-90) },
  { id: "page.delete", title: "ページを削除", icon: Trash2, words: ["ページを消す", "いらないページ"], enabled: editable, run: () => deleteTargetPages() },
  { id: "page.insertBlank", title: "白紙を足す", icon: FilePlus2, words: ["空白のページ", "新しいページ", "ページを追加", "挿入"], enabled: editable, run: () => insertBlankPage() },
  {
    id: "page.insertFile",
    title: "ファイルからページを足す…",
    icon: FileInput,
    keys: ["Mod+Shift+I"],
    words: ["つなげる", "結合", "合体", "マージ", "挿入", "ほかの PDF", "まとめる"],
    enabled: editable,
    run: () => void insertFromFiles(),
  },
  {
    id: "page.extract",
    title: "ページを抜き出す…",
    icon: Download,
    words: ["書き出す", "取り出す", "分ける", "一部だけ", "抽出"],
    enabled: editable,
    run: () => void extractPages(),
  },
  { id: "page.split", title: "ページごとに分割…", words: ["分ける", "ばらす", "何ページずつ"], enabled: editable, run: (s) => s.openDialog("split") },

  ...TOOLS.map(
    ({ tool, title, icon, key, words }): Command => ({
      id: `tool.${tool}`,
      title,
      icon,
      keys: key ? [key] : undefined,
      words,
      enabled: (s) => hasDoc(s) && (tool === "select" || tool === "hand" || editable(s)),
      checked: (s) => s.tool === tool,
      run: (s) => s.setTool(tool),
    }),
  ),
  {
    id: "tool.image",
    title: "印鑑・画像…",
    icon: Stamp,
    keys: ["I"],
    words: ["スタンプ", "ハンコ", "判子", "はんこ", "社判", "署名", "サイン", "写真", "ロゴ", "ライブラリ"],
    enabled: editable,
    checked: (s) => s.tool === "image",
    run: (s) => s.openDialog("stamps"),
  },
  { id: "tool.imageFile", title: "画像ファイルを置く…", icon: ImagePlus, words: ["写真", "PNG", "JPEG", "画像を入れる"], enabled: editable, run: () => void chooseImage() },
  {
    id: "stamp.date",
    title: "日付印を作る…",
    icon: CalendarCheck,
    words: ["日付入りの印鑑", "データネーム", "ハンコ", "受付印", "丸い印"],
    enabled: editable,
    run: () => useSealDialog.getState().open("date"),
  },
  {
    id: "stamp.word",
    title: "文字の印を作る…",
    icon: BadgeCheck,
    words: ["承認済み", "社外秘", "受領", "コピー", "回覧", "至急", "スタンプ", "ゴム印"],
    enabled: editable,
    run: () => useSealDialog.getState().open("word"),
  },
  {
    id: "sign.draw",
    title: "手書きの署名を作る…",
    icon: Signature,
    words: ["サイン", "署名", "自筆", "手書き", "名前を書く"],
    enabled: editable,
    run: (s) => s.openDialog("signature"),
  },
  {
    id: "view.rotateRight",
    title: "右に回転して見る",
    icon: RotateCw,
    words: ["表示を回転", "向きを変える", "横向きで見る", "回して見る"],
    enabled: hasDoc,
    run: (s) => s.patchDoc((d) => ({ viewRotate: (d.viewRotate + 90) % 360 })),
  },
  {
    id: "view.rotateLeft",
    title: "左に回転して見る",
    icon: RotateCcw,
    words: ["表示を回転", "向きを変える", "回して見る"],
    enabled: hasDoc,
    run: (s) => s.patchDoc((d) => ({ viewRotate: (d.viewRotate + 270) % 360 })),
  },

  { id: "app.settings", title: "設定…", keys: ["Mod+,"], words: ["名前", "作成者", "文字の大きさ", "大きく", "アップデート"], run: (s) => s.openDialog("settings") },
  { id: "app.checkUpdate", title: "アップデートを確認…", words: ["更新", "新しいバージョン"], run: () => void checkForUpdate(true) },
  { id: "help.shortcuts", title: "キーボードショートカット", keys: ["?"], words: ["キー", "早わざ"], run: (s) => s.openDialog("shortcuts") },
  {
    id: "help.log",
    title: "ログを表示",
    run: (s) => void api.revealLog().catch((e) => s.toast(`ログを開けませんでした: ${e}`, true)),
  },
];

/** Points an arrow key moves an annotation (Shift: ten times). */
let nudgeStep = 1;

const byId = new Map(COMMANDS.map((c) => [c.id, c]));

export function command(id: string): Command {
  const c = byId.get(id);
  if (!c) throw new Error(`unknown command ${id}`);
  return c;
}

export const isEnabled = (c: Command, s: S) => c.enabled?.(s) ?? true;

export const labelOf = (c: Command, s: S) => c.label?.(s) ?? c.title;

/** The name without a trailing "…" (buttons, tooltips). */
export const plainTitle = (c: Command) => c.title.replace(/…$/, "");

let lastRun = { id: "", by: "", at: 0 };

function runFrom(c: Command, s: S, by: "key" | "menu") {
  const now = performance.now();
  if (lastRun.id === c.id && lastRun.by !== by && now - lastRun.at < 250) return;
  lastRun = { id: c.id, by, at: now };
  c.run(s);
}

/** Runs a command by id if it is enabled now (menu bar items, buttons). */
export function runCommand(id: string) {
  // ⌘Z from the menu while typing undoes the typing, not the document.
  const el = document.activeElement as HTMLElement | null;
  const typing = !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
  if (typing && (id === "edit.undo" || id === "edit.redo")) {
    document.execCommand(id === "edit.undo" ? "undo" : "redo");
    return;
  }
  const c = command(id);
  const s = useStore.getState();
  if (isEnabled(c, s)) runFrom(c, s, "menu");
}

/**
 * The page's key handler: runs the command bound to `e`. Keys stop while a
 * dialog is open (it handles its own) and stay in text fields. Several
 * commands can share a key (an arrow nudges the selected annotation, else
 * turns the page): the first one enabled now gets it.
 */
export function runKey(e: KeyboardEvent): boolean {
  if (e.defaultPrevented || e.isComposing || e.keyCode === 229 || fromField(e)) return false;
  const s = useStore.getState();
  if (s.dialog || document.querySelector("[data-modal]")) return false;
  for (const c of COMMANDS) {
    if (c.keyBy === "menu" || !c.keys?.some((k) => comboMatches(k, e))) continue;
    if (!isEnabled(c, s)) continue;
    e.preventDefault();
    nudgeStep = e.shiftKey ? 10 : 1;
    runFrom(c, s, "key");
    return true;
  }
  return false;
}

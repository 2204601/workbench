/**
 * Every operation of the app, defined once (Platform Architecture §3). The
 * menu bar, the toolbar, the right-click menus, the key handling and the
 * shortcut list are made from this table, so a name and its key read the
 * same everywhere. Add an operation here first, never straight into a menu
 * or a key handler.
 */
import {
  ArrowRight,
  Circle,
  Columns2,
  Download,
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
  PenLine,
  Plus,
  Redo2,
  RotateCcw,
  RotateCw,
  Save,
  Search,
  Square,
  Stamp,
  StickyNote,
  Strikethrough,
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
import { moved, updateAnnot } from "./edit";
import { comboMatches, fromField } from "./keys";
import { invert, viewportTransform } from "./geometry";
import { pageBox, stepZoom } from "./layout";
import { findNext } from "./search";
import { checkForUpdate } from "./update";
import { bringToFront, deleteSelectedAnnot } from "../components/Overlay";
import { activeDoc, useStore, type S, type Tool } from "../store";

export interface Command {
  id: string;
  /** Name in the shortcut list and the default label. */
  title: string;
  /** The label for the current state. */
  label?: (s: S) => string;
  icon?: LucideIcon;
  /** The first is the one menus show; ⌘ / Ctrl combos become the menu's accelerator. */
  keys?: string[];
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
  const { view, rotation } = pageBox(page);
  const inv = invert(viewportTransform(view, 1, rotation));
  const px = inv[0] * dx + inv[2] * dy;
  const py = inv[1] * dx + inv[3] * dy;
  s.commit((x) => updateAnnot(x, id, (a) => moved(a, px, py)));
};

export const TOOLS: { tool: Tool; title: string; icon: LucideIcon; key: string }[] = [
  { tool: "select", title: "選択", icon: MousePointer2, key: "V" },
  { tool: "hand", title: "手のひら（スクロール）", icon: Hand, key: "H" },
  { tool: "highlight", title: "マーカー", icon: Highlighter, key: "M" },
  { tool: "underline", title: "下線", icon: Underline, key: "U" },
  { tool: "strikeout", title: "取り消し線", icon: Strikethrough, key: "K" },
  { tool: "text", title: "テキスト", icon: Type, key: "T" },
  { tool: "note", title: "付箋（コメント）", icon: StickyNote, key: "N" },
  { tool: "ink", title: "ペン（手書き）", icon: PenLine, key: "P" },
  { tool: "rect", title: "四角形", icon: Square, key: "R" },
  { tool: "ellipse", title: "楕円", icon: Circle, key: "O" },
  { tool: "line", title: "直線", icon: Minus, key: "L" },
  { tool: "arrow", title: "矢印", icon: ArrowRight, key: "A" },
];

export const COMMANDS: Command[] = [
  { id: "file.open", title: "開く…", icon: FolderOpen, keys: ["Mod+O"], run: () => void chooseAndOpen() },
  { id: "file.save", title: "保存", icon: Save, keys: ["Mod+S"], enabled: editable, run: () => void save(false) },
  { id: "file.saveAs", title: "名前を付けて保存…", keys: ["Mod+Shift+S"], enabled: editable, run: () => void save(true) },
  { id: "file.close", title: "タブを閉じる", icon: X, keys: ["Mod+W"], enabled: hasDoc, run: () => void closeDoc() },
  {
    id: "file.backups",
    title: "バックアップのフォルダを開く",
    run: (s) => void api.revealBackups().catch((e) => s.toast(String(e), true)),
  },

  { id: "edit.undo", title: "取り消す", icon: Undo2, keys: ["Mod+Z"], enabled: (s) => !!activeDoc(s)?.past.length, run: (s) => s.undo() },
  {
    id: "edit.redo",
    title: "やり直す",
    icon: Redo2,
    keys: ["Mod+Shift+Z", "Mod+Y"],
    enabled: (s) => !!activeDoc(s)?.future.length,
    run: (s) => s.redo(),
  },
  { id: "annot.delete", title: "注釈を削除", icon: Trash2, keys: ["Delete", "Backspace"], enabled: annotSelected, run: () => deleteSelectedAnnot() },
  { id: "annot.front", title: "最前面へ", enabled: annotSelected, run: () => bringToFront() },
  {
    id: "edit.deselect",
    title: "選択を解除・選択ツールに戻す",
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
    enabled: hasDoc,
    run: (s) => s.setSearch({ open: true, focusSeq: s.search.focusSeq + 1 }),
  },
  { id: "edit.findNext", title: "次を検索", keys: ["Mod+G"], enabled: (s) => s.search.results.length > 0, run: () => findNext(1) },
  { id: "edit.findPrev", title: "前を検索", keys: ["Mod+Shift+G"], enabled: (s) => s.search.results.length > 0, run: () => findNext(-1) },

  { id: "view.zoomIn", title: "拡大", icon: Plus, keys: ["Mod+=", "Mod++", "Mod+;"], enabled: hasDoc, run: (s) => zoomBy(s, 1) },
  { id: "view.zoomOut", title: "縮小", icon: Minus, keys: ["Mod+-"], enabled: hasDoc, run: (s) => zoomBy(s, -1) },
  {
    id: "view.fitPage",
    title: "ページ全体",
    keys: ["Mod+0"],
    enabled: hasDoc,
    checked: (s) => activeDoc(s)?.zoom.mode === "fit-page",
    run: (s) => s.patchDoc({ zoom: { mode: "fit-page" } }),
  },
  {
    id: "view.actualSize",
    title: "実際のサイズ（100%）",
    keys: ["Mod+1"],
    enabled: hasDoc,
    run: (s) => s.patchDoc({ zoom: { mode: "scale", value: 1 } }),
  },
  {
    id: "view.fitWidth",
    title: "幅に合わせる",
    icon: Columns2,
    keys: ["Mod+2"],
    enabled: hasDoc,
    checked: (s) => activeDoc(s)?.zoom.mode === "fit-width",
    run: (s) => s.patchDoc({ zoom: { mode: "fit-width" } }),
  },
  {
    id: "view.panel",
    title: "サイドバー",
    icon: PanelLeft,
    keys: ["F4"],
    // The page organizer takes the sidebar's place: there the button shows
    // it off, and brings back the pages with the sidebar.
    checked: (s) => s.panel !== null && !s.organizer,
    run: (s) => {
      if (s.organizer) {
        s.setOrganizer(false);
        if (!s.panel) s.setPanel("pages");
      } else s.setPanel(s.panel ? null : "pages");
    },
  },
  {
    id: "view.organizer",
    title: "ページを整理",
    icon: LayoutGrid,
    keys: ["Mod+Shift+O"],
    enabled: hasDoc,
    checked: (s) => s.organizer,
    run: (s) => s.setOrganizer(!s.organizer),
  },

  { id: "go.next", title: "次のページ", keys: ["ArrowRight", "PageDown"], enabled: (s) => hasDoc(s) && !annotSelected(s), run: (s) => scrollToPage(Math.min(activeDoc(s)!.pages.length - 1, activeDoc(s)!.page + 1)) },
  { id: "go.prev", title: "前のページ", keys: ["ArrowLeft", "PageUp"], enabled: (s) => hasDoc(s) && !annotSelected(s), run: (s) => scrollToPage(Math.max(0, activeDoc(s)!.page - 1)) },
  { id: "go.first", title: "最初のページ", keys: ["Home"], enabled: hasDoc, run: () => scrollToPage(0) },
  { id: "go.last", title: "最後のページ", keys: ["End"], enabled: hasDoc, run: (s) => scrollToPage(activeDoc(s)!.pages.length - 1) },
  { id: "annot.nudgeLeft", title: "注釈を左へ（⇧で大きく）", keys: ["ArrowLeft", "Shift+ArrowLeft"], enabled: annotSelected, run: (s) => nudge(s, -nudgeStep, 0) },
  { id: "annot.nudgeRight", title: "注釈を右へ", keys: ["ArrowRight", "Shift+ArrowRight"], enabled: annotSelected, run: (s) => nudge(s, nudgeStep, 0) },
  { id: "annot.nudgeUp", title: "注釈を上へ", keys: ["ArrowUp", "Shift+ArrowUp"], enabled: annotSelected, run: (s) => nudge(s, 0, -nudgeStep) },
  { id: "annot.nudgeDown", title: "注釈を下へ", keys: ["ArrowDown", "Shift+ArrowDown"], enabled: annotSelected, run: (s) => nudge(s, 0, nudgeStep) },

  { id: "page.rotateRight", title: "ページを右に回転", icon: RotateCw, keys: ["Mod+Shift+R"], enabled: editable, run: () => rotateTarget(90) },
  { id: "page.rotateLeft", title: "ページを左に回転", icon: RotateCcw, keys: ["Mod+Shift+L"], enabled: editable, run: () => rotateTarget(-90) },
  { id: "page.delete", title: "ページを削除", icon: Trash2, enabled: editable, run: () => deleteTargetPages() },
  { id: "page.insertBlank", title: "白紙のページを挿入", icon: FilePlus2, enabled: editable, run: () => insertBlankPage() },
  { id: "page.insertFile", title: "ファイルからページを挿入…", icon: FileInput, keys: ["Mod+Shift+I"], enabled: editable, run: () => void insertFromFiles() },
  { id: "page.extract", title: "ページを書き出す…", icon: Download, enabled: editable, run: () => void extractPages() },
  { id: "page.split", title: "ページごとに分割…", enabled: editable, run: (s) => s.openDialog("split") },

  ...TOOLS.map(
    ({ tool, title, icon, key }): Command => ({
      id: `tool.${tool}`,
      title,
      icon,
      keys: [key],
      enabled: (s) => hasDoc(s) && (tool === "select" || tool === "hand" || editable(s)),
      checked: (s) => s.tool === tool,
      run: (s) => s.setTool(tool),
    }),
  ),
  { id: "tool.image", title: "画像・印鑑…", icon: ImagePlus, keys: ["I"], enabled: editable, checked: (s) => s.tool === "image", run: (s) => s.openDialog("stamps") },
  { id: "tool.imageFile", title: "画像ファイルを置く…", icon: Stamp, enabled: editable, run: () => void chooseImage() },

  { id: "app.settings", title: "設定…", keys: ["Mod+,"], run: (s) => s.openDialog("settings") },
  { id: "app.checkUpdate", title: "アップデートを確認…", run: () => void checkForUpdate(true) },
  { id: "help.shortcuts", title: "キーボードショートカット", keys: ["?"], run: (s) => s.openDialog("shortcuts") },
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

/**
 * Every operation of the app, defined once (Platform Architecture §3). The
 * menu bar, the key handling and the shortcut list are made from this table,
 * so a name and its key read the same everywhere. Add an operation here
 * first, never straight into a menu or a key handler.
 */
import {
  Copy,
  Download,
  FilePlus2,
  FolderOpen,
  Redo2,
  Save,
  Scissors,
  Trash2,
  Type,
  Undo2,
  type LucideIcon,
} from "lucide-react";
import {
  addText,
  canCopy,
  canPaste,
  copySelection,
  cutSelection,
  deleteSelection,
  duplicateSelection,
  importDialog,
  jumpEdit,
  newProject,
  openProject,
  paste,
  saveProject,
  splitAtPlayhead,
  stepFrames,
} from "./actions";
import { api } from "./api";
import { comboMatches, fromField } from "./keys";
import { currentLayout, seek, togglePlay } from "./player";
import { TEXT_PRESETS } from "./presets";
import { checkForUpdate } from "./update";
import { useStore, type S } from "../store";

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
  /**
   * Who handles the key: the page's handler (default), or only the menu
   * bar's accelerator. "native": the page's handler outside text fields; the
   * menu bar shows the OS's own item (text fields need it on macOS), whose
   * clicks reach the page as clipboard events (installClipboard).
   */
  keyBy?: "page" | "menu" | "native";
}

const idle = (s: S) => s.exporting === null;
const hasClips = (s: S) => s.project.clips.length > 0;
const ZOOM_STEP = 1.4;

export const COMMANDS: Command[] = [
  { id: "file.new", title: "新規プロジェクト", icon: FilePlus2, keys: ["Mod+N"], enabled: idle, run: () => void newProject() },
  { id: "file.open", title: "プロジェクトを開く…", icon: FolderOpen, keys: ["Mod+O"], enabled: idle, run: () => void openProject() },
  { id: "file.save", title: "保存", icon: Save, keys: ["Mod+S"], enabled: idle, run: () => void saveProject() },
  { id: "file.saveAs", title: "別名で保存…", keys: ["Mod+Shift+S"], enabled: idle, run: () => void saveProject(true) },
  { id: "file.import", title: "動画・写真を追加…", keys: ["Mod+I"], enabled: idle, run: () => void importDialog() },
  {
    id: "file.export",
    title: "動画を書き出す…",
    icon: Download,
    keys: ["Mod+E"],
    enabled: (s) => idle(s) && hasClips(s),
    run: (s) => s.openDialog("export"),
  },

  { id: "edit.undo", title: "取り消す", icon: Undo2, keys: ["Mod+Z"], enabled: (s) => s.past.length > 0, run: (s) => s.undo() },
  {
    id: "edit.redo",
    title: "やり直す",
    icon: Redo2,
    keys: ["Mod+Shift+Z", "Mod+Y"],
    enabled: (s) => s.future.length > 0,
    run: (s) => s.redo(),
  },
  { id: "edit.cut", title: "カット", keys: ["Mod+X"], keyBy: "native", enabled: canCopy, run: () => void cutSelection() },
  { id: "edit.copy", title: "コピー", icon: Copy, keys: ["Mod+C"], keyBy: "native", enabled: canCopy, run: () => void copySelection() },
  { id: "edit.paste", title: "ペースト", keys: ["Mod+V"], keyBy: "native", enabled: canPaste, run: () => void paste() },
  { id: "edit.duplicate", title: "複製", keys: ["Mod+D"], enabled: canCopy, run: () => duplicateSelection() },
  {
    id: "edit.delete",
    title: "削除",
    icon: Trash2,
    keys: ["Delete", "Backspace"],
    enabled: (s) => s.selection !== null,
    run: () => deleteSelection(),
  },
  { id: "edit.split", title: "再生位置で分割", icon: Scissors, keys: ["S", "Mod+B"], enabled: hasClips, run: () => splitAtPlayhead() },
  { id: "edit.text", title: "文字を入れる", icon: Type, keys: ["T"], enabled: hasClips, run: () => addText(TEXT_PRESETS[0]) },
  { id: "edit.deselect", title: "選択を解除", keys: ["Esc"], enabled: (s) => s.selection !== null, run: (s) => s.select(null) },

  { id: "play.toggle", title: "再生 / 一時停止", keys: ["Space"], enabled: hasClips, run: () => togglePlay() },
  { id: "play.start", title: "先頭へ", keys: ["Home"], run: () => seek(0) },
  { id: "play.end", title: "最後へ", keys: ["End"], run: () => seek(currentLayout().duration) },
  { id: "play.prevFrame", title: "1 コマ戻る", keys: ["ArrowLeft"], run: () => stepFrames(-1) },
  { id: "play.nextFrame", title: "1 コマ進む", keys: ["ArrowRight"], run: () => stepFrames(1) },
  { id: "play.back", title: "1 秒戻る", keys: ["Shift+ArrowLeft"], run: (s) => seek(s.time - 1) },
  { id: "play.forward", title: "1 秒進む", keys: ["Shift+ArrowRight"], run: (s) => seek(s.time + 1) },
  { id: "play.prevCut", title: "前のつなぎ目へ", keys: ["ArrowUp"], run: () => jumpEdit(-1) },
  { id: "play.nextCut", title: "次のつなぎ目へ", keys: ["ArrowDown"], run: () => jumpEdit(1) },

  { id: "view.zoomIn", title: "タイムラインを拡大", keys: ["Mod+=", "Mod+;"], run: (s) => s.setZoom(s.zoom * ZOOM_STEP) },
  { id: "view.zoomOut", title: "タイムラインを縮小", keys: ["Mod+-"], run: (s) => s.setZoom(s.zoom / ZOOM_STEP) },
  { id: "view.zoomFit", title: "タイムライン全体を表示", keys: ["Mod+0"], run: () => fitTimeline() },

  { id: "app.settings", title: "設定…", keys: ["Mod+,"], run: (s) => s.openDialog("settings") },
  { id: "app.checkUpdate", title: "アップデートを確認…", run: () => void checkForUpdate(true) },
  { id: "help.shortcuts", title: "キーボードショートカット", keys: ["?"], run: (s) => s.openDialog("shortcuts") },
  {
    id: "help.log",
    title: "ログを表示",
    run: (s) => void api.revealLog().catch((e) => s.toast(`ログを開けませんでした: ${e}`, true)),
  },
];

/** The whole timeline in its visible width (Timeline.tsx registers how wide that is). */
let timelineWidth = () => 800;
export const setTimelineWidth = (f: () => number) => (timelineWidth = f);
export function fitTimeline() {
  const d = currentLayout().duration;
  if (d > 0) useStore.getState().setZoom((timelineWidth() - 80) / d);
}

const byId = new Map(COMMANDS.map((c) => [c.id, c]));

export function command(id: string): Command {
  const c = byId.get(id);
  if (!c) throw new Error(`unknown command ${id}`);
  return c;
}

export const isEnabled = (c: Command, s: S) => c.enabled?.(s) ?? true;

export const labelOf = (c: Command, s: S) => c.label?.(s) ?? c.title;

/**
 * The last command run and from where. A key can reach both the menu bar's
 * accelerator and the page's handler (which one depends on the platform),
 * so the second of the two within a moment is dropped.
 */
let lastRun = { id: "", by: "", at: 0 };

function runFrom(c: Command, s: S, by: "key" | "menu") {
  const now = performance.now();
  if (lastRun.id === c.id && lastRun.by !== by && now - lastRun.at < 250) return;
  lastRun = { id: c.id, by, at: now };
  c.run(s);
}

/** A text field has the focus: undo / redo are its own. */
const inField = () => {
  const el = document.activeElement as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
};

/** Runs a command by id if it is enabled now (menu bar items). */
export function runCommand(id: string) {
  if ((id === "edit.undo" || id === "edit.redo") && inField()) {
    document.execCommand(id === "edit.undo" ? "undo" : "redo");
    return;
  }
  const c = command(id);
  const s = useStore.getState();
  if (isEnabled(c, s)) runFrom(c, s, "menu");
}

/**
 * The page's key handler: runs the command bound to `e`. Keys stop while a
 * dialog is open (it handles its own) and stay in text fields. A key whose
 * command is off now is left alone (Enter on a focused button still clicks it).
 */
export function runKey(e: KeyboardEvent): boolean {
  if (e.defaultPrevented || e.isComposing || e.keyCode === 229 || fromField(e)) return false;
  const s = useStore.getState();
  if (s.dialog || document.querySelector("[data-modal]")) return false;
  for (const c of COMMANDS) {
    if (c.keyBy === "menu" || !c.keys?.some((k) => comboMatches(k, e))) continue;
    if (!isEnabled(c, s)) return false;
    e.preventDefault();
    runFrom(c, s, "key");
    return true;
  }
  return false;
}

/**
 * Copy, cut and paste from the menu bar's OS items arrive as clipboard
 * events. In a text field they stay the field's. (The keys are runKey's: it
 * takes them first, so these don't run twice.)
 */
export function installClipboard(): () => void {
  const handle = (id: string) => (e: ClipboardEvent) => {
    if (inField() || useStore.getState().dialog) return;
    e.preventDefault();
    // As from the menu: dropped if the key just ran it (Windows sends both).
    runCommand(id);
  };
  const onCopy = handle("edit.copy");
  const onCut = handle("edit.cut");
  const onPaste = handle("edit.paste");
  document.addEventListener("copy", onCopy);
  document.addEventListener("cut", onCut);
  document.addEventListener("paste", onPaste);
  return () => {
    document.removeEventListener("copy", onCopy);
    document.removeEventListener("cut", onCut);
    document.removeEventListener("paste", onPaste);
  };
}

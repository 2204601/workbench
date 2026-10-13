/**
 * Every operation of the app, defined once (Platform Architecture §3). The
 * menu bar, the key handling and the shortcut list are made from this table,
 * so a name and its key read the same everywhere. Add an operation here
 * first, never straight into a menu or a key handler.
 */
import { ArrowUp, FolderOpen, House, RotateCw, type LucideIcon } from "lucide-react";
import {
  chooseFolder,
  closeScan,
  copyPath,
  goUp,
  moveSelection,
  openSelected,
  reveal,
  revealLabel,
  rescan,
} from "./actions";
import { api } from "./api";
import { CHART_KINDS, CHARTS } from "./charts";
import { comboMatches, fromField } from "./keys";
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
  /** Who handles the key: the page's handler (default), or only the menu bar's accelerator. */
  keyBy?: "page" | "menu";
}

const idle = (s: S) => s.scanning === null;
const shown = (s: S) => idle(s) && s.folder !== null;

export const COMMANDS: Command[] = [
  {
    id: "file.choose",
    title: "フォルダを選んでスキャン…",
    icon: FolderOpen,
    keys: ["Mod+O"],
    enabled: idle,
    run: () => void chooseFolder(),
  },
  {
    id: "file.rescan",
    title: "もう一度スキャン",
    icon: RotateCw,
    keys: ["Mod+R"],
    enabled: (s) => idle(s) && s.result !== null,
    run: () => void rescan(),
  },
  {
    id: "file.close",
    title: "スタート画面に戻る",
    icon: House,
    enabled: (s) => idle(s) && s.result !== null,
    run: () => void closeScan(),
  },
  {
    id: "go.up",
    title: "上のフォルダへ",
    icon: ArrowUp,
    keys: ["Mod+ArrowUp", "Backspace"],
    enabled: (s) => shown(s) && s.folder!.parent !== null,
    run: () => goUp(),
  },
  {
    id: "go.top",
    title: "スキャンしたフォルダへ",
    keys: ["Mod+Shift+ArrowUp"],
    enabled: (s) => shown(s) && s.folder!.parent !== null,
    run: (s) => void s.go(0),
  },
  {
    id: "list.down",
    title: "次の項目",
    keys: ["ArrowDown"],
    enabled: shown,
    run: () => moveSelection(1),
  },
  {
    id: "list.up",
    title: "前の項目",
    keys: ["ArrowUp"],
    enabled: shown,
    run: () => moveSelection(-1),
  },
  {
    id: "list.open",
    title: "選んだフォルダを開く",
    keys: ["Enter"],
    enabled: (s) => shown(s) && !!s.folder!.items.find((x) => x.id === s.selected)?.dir,
    run: () => openSelected(),
  },
  {
    id: "list.deselect",
    title: "選択を解除",
    keys: ["Esc"],
    enabled: (s) => s.selected !== null,
    run: (s) => s.select(null),
  },
  ...CHART_KINDS.map(
    (kind, i): Command => ({
      id: `chart.${kind}`,
      title: CHARTS[kind].label,
      icon: CHARTS[kind].icon,
      keys: [`Mod+${i + 1}`],
      checked: (s) => s.chart === kind,
      run: (s) => s.setChart(kind),
    }),
  ),
  {
    id: "item.reveal",
    title: revealLabel,
    keys: ["Mod+Shift+R"],
    enabled: shown,
    run: () => void reveal(),
  },
  {
    id: "item.copyPath",
    title: "パスをコピー",
    keys: ["Mod+Shift+C"],
    enabled: shown,
    run: () => void copyPath(),
  },
  { id: "app.settings", title: "設定…", keys: ["Mod+,"], run: (s) => s.openDialog("settings") },
  { id: "app.checkUpdate", title: "アップデートを確認…", run: () => void checkForUpdate(true) },
  { id: "help.shortcuts", title: "キーボードショートカット", keys: ["?"], run: (s) => s.openDialog("shortcuts") },
  {
    id: "help.log",
    title: "ログを表示",
    run: (s) => void api.revealLog().catch((e) => s.toast(`ログを開けませんでした: ${e}`, true)),
  },
];

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

/** Runs a command by id if it is enabled now (menu bar items). */
export function runCommand(id: string) {
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

/**
 * Every operation of the app, defined once (Platform Architecture §3). The
 * menu bar, the key handling and the shortcut list are made from this table,
 * so a name and its key read the same everywhere. Add an operation here
 * first, never straight into a menu or a key handler.
 */
import { FilePlus, FolderOpen, Play, Undo2, type LucideIcon } from "lucide-react";
import { addFiles, clearList, openFolder, runRename, undoLast } from "./actions";
import { api } from "./api";
import { RULE_KINDS } from "./ruleDraft";
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

const loaded = (s: S) => s.listing.summary.total > 0;
const idle = (s: S) => s.task === null;
/** The rows a list command applies to: the selection, else the row with the focus. */
const targets = (s: S) => (s.selected.size ? [...s.selected] : s.focus !== null ? [s.focus] : []);

export const COMMANDS: Command[] = [
  {
    id: "file.openFolder",
    title: "フォルダを開く…",
    icon: FolderOpen,
    keys: ["Mod+O"],
    enabled: idle,
    run: () => void openFolder(),
  },
  {
    id: "file.addFiles",
    title: "ファイルを追加…",
    icon: FilePlus,
    keys: ["Mod+Shift+O"],
    enabled: idle,
    run: () => void addFiles(),
  },
  {
    id: "file.clear",
    title: "一覧を空にする",
    enabled: (s) => idle(s) && loaded(s),
    run: () => void clearList(),
  },
  ...RULE_KINDS.map(
    (r, i): Command => ({
      id: `rule.${r.kind}`,
      title: `ルール：${r.label}`,
      keys: [`Mod+${i + 1}`],
      checked: (s) => s.ruleKind === r.kind,
      run: (s) => s.setRuleKind(r.kind),
    }),
  ),
  {
    id: "rule.mode",
    title: "詳細モード",
    keys: ["Mod+Shift+D"],
    checked: (s) => s.mode === "detail",
    run: (s) => s.setMode(s.mode === "detail" ? "simple" : "detail"),
  },
  {
    id: "run.execute",
    title: "名前を変更",
    label: (s) => (s.listing.summary.changed ? `${s.listing.summary.changed.toLocaleString("ja-JP")} 件の名前を変更…` : "名前を変更…"),
    icon: Play,
    keys: ["Mod+Enter"],
    enabled: (s) => idle(s) && !s.stopped && s.listing.summary.changed > 0 && s.listing.summary.errors === 0,
    run: () => void runRename(),
  },
  {
    id: "edit.undo",
    title: "元に戻す",
    label: (s) => (s.journal?.canUndo ? `名前の変更を元に戻す（${s.journal.renamed.toLocaleString("ja-JP")} 件）` : "元に戻す"),
    icon: Undo2,
    keys: ["Mod+Z"],
    enabled: (s) => idle(s) && !!s.journal?.canUndo,
    run: () => {
      // macOS sends ⌘Z to the menu first: typing in a field undoes the typing.
      const el = document.activeElement;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
        document.execCommand("undo");
        return;
      }
      void undoLast(true);
    },
  },
  {
    id: "edit.filter",
    title: "名前で絞り込む",
    keys: ["Mod+F"],
    enabled: loaded,
    run: () => document.getElementById("name-filter")?.focus(),
  },
  {
    id: "list.selectAll",
    title: "すべて選択",
    keys: ["Mod+A"],
    enabled: loaded,
    run: (s) => {
      // macOS sends ⌘A to the menu first: a focused field still selects its text.
      const el = document.activeElement;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return el.select();
      const rows = s.listing.rows;
      s.select(new Set(rows.map((r) => r.id)), s.focus ?? rows[0]?.id ?? null);
    },
  },
  {
    id: "list.uncheckProblems",
    title: "問題のある行をすべて外す",
    enabled: (s) => s.listing.summary.errors > 0,
    run: (s) =>
      s.setChecked(
        s.listing.rows.filter((r) => r.status === "error").map((r) => r.id),
        false,
      ),
  },
  {
    id: "list.toggleCheck",
    title: "選択した行を対象にする / 外す",
    keys: ["Space"],
    enabled: (s) => targets(s).length > 0,
    run: (s) => {
      const ids = targets(s);
      const byId = new Map(s.listing.rows.map((r) => [r.id, r]));
      // All ticked: untick them; otherwise tick them all.
      const allOn = ids.every((id) => byId.get(id)?.checked);
      s.setChecked(ids, !allOn);
    },
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
 * dialog is open (it handles its own) and stay in text fields.
 */
export function runKey(e: KeyboardEvent): boolean {
  if (e.defaultPrevented || e.isComposing || e.keyCode === 229 || fromField(e)) return false;
  const s = useStore.getState();
  if (s.dialog || document.querySelector("[data-modal]")) return false;
  for (const c of COMMANDS) {
    if (c.keyBy === "menu" || !c.keys?.some((k) => comboMatches(k, e))) continue;
    e.preventDefault();
    if (isEnabled(c, s)) runFrom(c, s, "key");
    return true;
  }
  return false;
}

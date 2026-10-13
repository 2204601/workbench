import { invoke } from "@tauri-apps/api/core";

export type Snippet = { id: number; label: string; text: string };
export type HistoryItem = { id: number; text: string; copiedAt: number };
export type Entries = { snippets: Snippet[]; history: HistoryItem[] };
export type Status = { autoPaste: boolean; shortcut: string; shortcutActive: boolean; version: string };
export type Settings = { recordHistory: boolean; historyLimit: number; historyDays: number; shortcut: string };

export const isMac = navigator.userAgent.includes("Mac");
/** The modifier for Clip's own keys: ⌘ on macOS, Ctrl on Windows. */
export const MOD = isMac ? "⌘" : "Ctrl+";

export const api = {
  entries: () => invoke<Entries>("entries"),
  status: () => invoke<Status>("status"),
  settings: () => invoke<Settings>("settings"),
  setSettings: (settings: Settings) => invoke<Settings>("set_settings", { settings }),
  addSnippet: (label: string, text: string) => invoke<Snippet>("add_snippet", { label, text }),
  updateSnippet: (id: number, label: string, text: string) => invoke<void>("update_snippet", { id, label, text }),
  deleteSnippet: (id: number) => invoke<void>("delete_snippet", { id }),
  moveSnippet: (id: number, by: number) => invoke<void>("move_snippet", { id, by }),
  snippetFromHistory: (id: number) => invoke<Snippet | null>("snippet_from_history", { id }),
  removeHistory: (id: number) => invoke<void>("remove_history", { id }),
  askClearHistory: () => invoke<void>("ask_clear_history"),
  choose: (text: string, historyId: number | null, paste: boolean) =>
    invoke<void>("choose", { text, historyId, paste }),
  closePopup: () => invoke<void>("close_popup"),
  openManager: () => invoke<void>("open_manager"),
  requestAccessibility: () => invoke<void>("request_accessibility"),
};

/** "Ctrl+Alt+C" as it is written on each system: ⌃⌥C on macOS. */
export function shortcutLabel(accelerator: string) {
  if (!isMac) return accelerator.split("+").join(" + ");
  const symbols: Record<string, string> = { Ctrl: "⌃", Alt: "⌥", Shift: "⇧" };
  return accelerator
    .split("+")
    .map((part) => symbols[part] ?? part)
    .join("");
}

// ---------------------------------------------------------------------------
// Search

/**
 * Folds the differences people don't mean when they type a search: full- and
 * half-width (ＡＢＣ / ABC, ０３ / 03), upper and lower case, and katakana
 * and hiragana.
 */
function fold(s: string) {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
}

/** Without spaces and dashes, so "0312" finds "03-1234-5678". */
function compact(s: string) {
  return s.replace(/[\s\-‐−ー().]/g, "");
}

/** Whether every word of `query` appears in `text`. */
export function matches(query: string, text: string) {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const hay = fold(text);
  const hayCompact = compact(hay);
  return words.every((w) => hay.includes(w) || (compact(w) !== "" && hayCompact.includes(compact(w))));
}

// ---------------------------------------------------------------------------
// Display

/** The text on one line, for a list row. */
export function oneLine(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

export function relativeTime(at: number, now = Date.now()) {
  const minutes = Math.floor((now - at) / 60_000);
  if (minutes < 1) return "たった今";
  if (minutes < 60) return `${minutes}分前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}時間前`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "昨日" : `${days}日前`;
}

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

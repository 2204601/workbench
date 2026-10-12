// The one zustand store (Platform Architecture §5): what the window shows and
// what is running. Rust holds the files; this holds what came back from it.
import { create } from "zustand";
import { api, type Failure, type JournalStatus, type Listing, type Outcome, type Query, type SortBy } from "./lib/api";
import { DEFAULT_DRAFTS, ruleOf, type Drafts, type Mode, type RuleKind } from "./lib/ruleDraft";

export type ToastKind = "success" | "info" | "error";

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastOptions {
  title: string;
  /** A second, quieter line (counts, reasons). */
  detail?: string;
  kind?: ToastKind;
  action?: ToastAction;
  /** ms before it goes away; paused while hovered or while the window is in the background. */
  duration?: number;
}

export interface Toast extends Required<Pick<ToastOptions, "title" | "kind" | "duration">> {
  id: number;
  detail?: string;
  action?: ToastAction;
  leaving?: boolean;
}

/** Downloading an update (src/lib/update.ts). */
export interface Updating {
  done: number;
  total: number | null;
  installing?: boolean;
}

/** Dialogs over the window; while one is open the list's keys stop (`data-modal`). */
export type Dialog = "settings" | "shortcuts" | null;

/** A long task with a progress bar and a cancel button (Platform UI §5). */
export interface Task {
  label: string;
  done: number;
  total: number | null;
}

/** A run stopped by a failure or the user, waiting for a choice (docs/SPEC.md §7). */
export type Stopped = Extract<Outcome, { kind: "stopped" }>;

/** Which rows the list shows (docs/SPEC.md §3). */
export type View = "all" | "changing" | "problems";

const EMPTY: Listing = {
  rows: [],
  summary: { total: 0, shown: 0, changed: 0, warnings: 0, errors: 0, exts: [], folders: [] },
  ruleError: null,
};

interface State {
  toasts: Toast[];
  updating: Updating | null;
  dialog: Dialog;

  /** The last answer of `list_files`. */
  listing: Listing;
  exts: string[];
  contains: string;
  sort: SortBy;
  desc: boolean;
  unchecked: Set<number>;
  view: View;
  /** Selected rows (ids), the row the keys move from, and where Shift ranges start. */
  selected: Set<number>;
  focus: number | null;
  anchor: number | null;
  task: Task | null;

  /** 簡単 / 詳細 (docs/SPEC.md §2). */
  mode: Mode;
  ruleKind: RuleKind;
  drafts: Drafts;
  includeExt: boolean;
  /** Why the rule can't be used, under its fields; the list keeps its last good names. */
  ruleError: string | null;
  /**
   * Just renamed: the rule rests until it is changed, so the list shows the
   * new names instead of the rule applied a second time.
   */
  paused: boolean;
  journal: JournalStatus | null;
  stopped: Stopped | null;
  /** Files that couldn't be renamed back, listed after an undo. */
  notUndone: Failure[] | null;

  refresh: () => Promise<void>;
  /** The query for the list (and for running it). */
  query: () => Query;
  loadJournal: () => Promise<void>;
  setPaused: (p: boolean) => void;
  setMode: (m: Mode) => void;
  setRuleKind: (k: RuleKind) => void;
  /** Changes one rule's fields; the list follows a moment later. */
  setDraft: <K extends RuleKind>(kind: K, patch: Partial<Drafts[K]>) => void;
  setIncludeExt: (v: boolean) => void;
  setFilter: (f: Partial<Pick<State, "exts" | "contains" | "sort" | "desc">>) => void;
  setView: (v: View) => void;
  /** Ticks or unticks rows; they keep their names while unticked. */
  setChecked: (ids: number[], checked: boolean) => void;
  select: (ids: Set<number>, focus: number | null, anchor?: number | null) => void;
  setTask: (t: Task | null) => void;
  clearList: () => void;

  setUpdating: (u: Updating | null) => void;
  openDialog: (d: Dialog) => void;
  toast: (message: string, error?: boolean, action?: ToastAction) => void;
  notify: (t: ToastOptions) => void;
  dismissToast: (id: number) => void;
}

let toastSeq = 0;
/** Answers to older requests are dropped: typing a filter fires several. */
let listSeq = 0;

// localStorage can throw (private mode etc.); the list's order is only a preference.
const load = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const persist = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
};

const SORTS: SortBy[] = ["name", "modified", "created", "size"];
let draftTimer: ReturnType<typeof setTimeout> | undefined;
const savedSort = load("sort") as SortBy | null;

export const useStore = create<State>()((set, get) => ({
  toasts: [],
  updating: null,
  dialog: null,

  listing: EMPTY,
  exts: [],
  contains: "",
  sort: savedSort && SORTS.includes(savedSort) ? savedSort : "name",
  desc: load("desc") === "1",
  unchecked: new Set(),
  view: "all",
  selected: new Set(),
  focus: null,
  anchor: null,
  task: null,

  mode: load("mode") === "detail" ? "detail" : "simple",
  ruleKind: "replace",
  drafts: DEFAULT_DRAFTS,
  includeExt: false,
  ruleError: null,
  paused: false,
  journal: null,
  stopped: null,
  notUndone: null,

  query: () => {
    const s = get();
    return {
      exts: s.exts,
      contains: s.contains,
      sort: s.sort,
      desc: s.desc,
      unchecked: [...s.unchecked],
      rule: s.paused ? null : ruleOf(s.ruleKind, s.mode, s.drafts),
      includeExt: s.includeExt,
    };
  },
  loadJournal: async () => {
    try {
      set({ journal: await api.journalStatus() });
    } catch (e) {
      get().toast(String(e), true);
    }
  },
  setPaused: (paused) => {
    set({ paused });
    void get().refresh();
  },

  refresh: async () => {
    const seq = ++listSeq;
    try {
      const listing = await api.listFiles(get().query());
      if (seq !== listSeq) return;
      // A rule that can't be used (half a regular expression while typing):
      // say why, and keep the last good names rather than flashing back.
      set({ ruleError: listing.ruleError });
      if (listing.ruleError && get().listing.rows.length === listing.rows.length) return;
      // Selection only of rows still shown.
      const ids = new Set(listing.rows.map((r) => r.id));
      const selected = new Set([...get().selected].filter((id) => ids.has(id)));
      const focus = get().focus !== null && ids.has(get().focus!) ? get().focus : null;
      set({ listing, selected, focus });
    } catch (e) {
      if (seq === listSeq) get().toast(String(e), true);
    }
  },
  setFilter: (f) => {
    set(f);
    if (f.sort !== undefined) persist("sort", f.sort);
    if (f.desc !== undefined) persist("desc", f.desc ? "1" : "0");
    void get().refresh();
  },
  setView: (view) => set({ view }),
  setMode: (mode) => {
    set({ mode, paused: false });
    persist("mode", mode);
    void get().refresh();
  },
  setRuleKind: (ruleKind) => {
    set({ ruleKind, paused: false });
    void get().refresh();
  },
  setDraft: (kind, patch) => {
    const drafts = get().drafts;
    set({ drafts: { ...drafts, [kind]: { ...drafts[kind], ...patch } }, paused: false });
    // Typing fires many changes; the list follows once it pauses (§5).
    clearTimeout(draftTimer);
    draftTimer = setTimeout(() => void get().refresh(), 150);
  },
  setIncludeExt: (includeExt) => {
    set({ includeExt, paused: false });
    void get().refresh();
  },
  setChecked: (ids, checked) => {
    const unchecked = new Set(get().unchecked);
    for (const id of ids) {
      if (checked) unchecked.delete(id);
      else unchecked.add(id);
    }
    set({ unchecked });
    void get().refresh();
  },
  select: (selected, focus, anchor) => set({ selected, focus, anchor: anchor === undefined ? get().anchor : anchor }),
  setTask: (task) => set({ task }),
  clearList: () =>
    set({ listing: EMPTY, unchecked: new Set(), selected: new Set(), focus: null, anchor: null, exts: [], contains: "" }),

  setUpdating: (updating) => set({ updating }),
  openDialog: (dialog) => set({ dialog }),
  toast: (message, error, action) => get().notify({ title: message, kind: error ? "error" : "info", action }),
  notify: ({ title, detail, kind = "info", action, duration }) => {
    const id = ++toastSeq;
    const t: Toast = { id, title, detail, kind, action, duration: duration ?? (kind === "error" || action ? 8000 : 5000) };
    // At most three on screen (Platform UI §5); the oldest give way.
    const live = get().toasts.filter((x) => !x.leaving);
    for (const old of live.slice(0, Math.max(0, live.length - 2))) get().dismissToast(old.id);
    set({ toasts: [...get().toasts, t] });
  },
  dismissToast: (id) => {
    if (!get().toasts.some((t) => t.id === id && !t.leaving)) return;
    // Marked first so the exit animation can play, then removed.
    set({ toasts: get().toasts.map((t) => (t.id === id ? { ...t, leaving: true } : t)) });
    setTimeout(() => set({ toasts: get().toasts.filter((t) => t.id !== id) }), 200);
  },
}));

export type S = State;

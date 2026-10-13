// The one zustand store (Platform Architecture §5): what the window shows and
// what is running. Rust holds the scanned tree; this holds the parts of it
// that came back for the folder on screen.
import { create } from "zustand";
import { api, type Counts, type Folder, type Place, type ScanSummary, type ViewNode } from "./lib/api";
import { CHARTS, type ChartKind } from "./lib/charts";

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

/** Dialogs over the window; while one is open the page's keys stop (`data-modal`). */
export type Dialog = "settings" | "shortcuts" | null;

/** A scan running (docs/SPEC.md §3). */
export interface Scanning {
  path: string;
  counts: Counts;
  /** Date.now() at the start. */
  started: number;
}

interface State {
  toasts: Toast[];
  updating: Updating | null;
  dialog: Dialog;

  /** The start screen's drives; null until loaded. */
  places: Place[] | null;
  scanning: Scanning | null;
  /** The last scan that finished; null on the start screen. */
  result: ScanSummary | null;
  /** The folder on screen, and what the chart draws of it. */
  folder: Folder | null;
  view: ViewNode | null;
  chart: ChartKind;
  /** The item under the pointer, in the chart or the list. */
  hover: number | null;
  /** The item picked (a click on a file, the arrow keys in the list). */
  selected: number | null;

  loadPlaces: () => Promise<void>;
  setScanning: (s: Scanning | null) => void;
  setResult: (r: ScanSummary | null) => void;
  /** Shows folder `id`: its list and its chart. */
  go: (id: number) => Promise<void>;
  setChart: (c: ChartKind) => void;
  setHover: (id: number | null) => void;
  select: (id: number | null) => void;

  setUpdating: (u: Updating | null) => void;
  openDialog: (d: Dialog) => void;
  toast: (message: string, error?: boolean, action?: ToastAction) => void;
  notify: (t: ToastOptions) => void;
  dismissToast: (id: number) => void;
}

let toastSeq = 0;
/** Answers to older requests are dropped: clicking through folders fires several. */
let goSeq = 0;

/** How many rows the list shows; the rest are summed up under it. */
export const LIST_LIMIT = 500;

// localStorage can throw (private mode etc.); the chart kind is only a preference.
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

const savedChart = load("chart") as ChartKind | null;

export const useStore = create<State>()((set, get) => ({
  toasts: [],
  updating: null,
  dialog: null,

  places: null,
  scanning: null,
  result: null,
  folder: null,
  view: null,
  chart: savedChart && savedChart in CHARTS ? savedChart : "sunburst",
  hover: null,
  selected: null,

  loadPlaces: async () => {
    try {
      set({ places: await api.listPlaces() });
    } catch (e) {
      set({ places: [] });
      get().toast(`ドライブの一覧を読めませんでした: ${e}`, true);
    }
  },
  setScanning: (scanning) => set({ scanning }),
  // A new scan numbers its items anew: nothing picked or pointed at carries over.
  setResult: (result) => set(result ? { result, hover: null, selected: null } : { result, folder: null, view: null, hover: null, selected: null }),
  go: async (id) => {
    const seq = ++goSeq;
    const { depth, minShare } = CHARTS[get().chart];
    try {
      const [folder, view] = await Promise.all([api.folderInfo(id, LIST_LIMIT), api.viewTree(id, depth, minShare)]);
      if (seq !== goSeq) return;
      const changed = get().folder?.id !== id;
      set({ folder, view, hover: null, ...(changed ? { selected: null } : {}) });
    } catch (e) {
      if (seq === goSeq) get().toast(String(e), true);
    }
  },
  setChart: (chart) => {
    set({ chart });
    persist("chart", chart);
    const f = get().folder;
    if (f) void get().go(f.id);
  },
  setHover: (hover) => {
    if (get().hover !== hover) set({ hover });
  },
  select: (selected) => set({ selected }),

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

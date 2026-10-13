// The one zustand store (Platform Architecture §5): the open documents (tabs)
// with their pages and annotations, the tool in hand, and what the window
// shows. pdf.js's documents live in src/lib/pdfjs.ts; pages refer to them by
// id.
import { create } from "zustand";
import type { Annot, ImageInfo } from "./lib/api";

export type ToastKind = "success" | "info" | "error";

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastOptions {
  title: string;
  detail?: string;
  kind?: ToastKind;
  action?: ToastAction;
  duration?: number;
}

export interface Toast extends Required<Pick<ToastOptions, "title" | "kind" | "duration">> {
  id: number;
  detail?: string;
  action?: ToastAction;
  leaving?: boolean;
}

export interface Updating {
  done: number;
  total: number | null;
  installing?: boolean;
}

export type Dialog = "settings" | "shortcuts" | "stamps" | "split" | null;

/** What a click or a drag on a page does. */
export type Tool =
  | "select"
  | "hand"
  | "highlight"
  | "underline"
  | "strikeout"
  | "text"
  | "note"
  | "ink"
  | "rect"
  | "ellipse"
  | "line"
  | "arrow"
  | "image";

/** The look new annotations of a tool get (and the selected one shows). */
export interface ToolStyle {
  color: string;
  width: number;
  opacity: number;
  fill: string | null;
  fontSize: number;
}

/** A page of a tab: page `index` of opened file `source`, or a blank page. */
export interface PageItem {
  uid: string;
  source: number | null;
  index: number;
  /** Turned this much (90s) on top of the page's own rotation. */
  rotate: number;
  /** A blank page's size in points. */
  size: [number, number] | null;
}

/** What undo brings back. */
interface Snapshot {
  pages: PageItem[];
  annots: Record<string, Annot[]>;
}

export type Zoom = { mode: "fit-width" } | { mode: "fit-page" } | { mode: "scale"; value: number };

export interface Doc {
  key: string;
  /** The tab's name: the file's name. */
  name: string;
  /** Where ⌘S writes: set by the first save (docs/SPEC.md「保存」). */
  savePath: string | null;
  /** The file it was opened from. */
  openedPath: string;
  /** Opened files its pages come from (released when the tab closes). */
  sources: number[];
  pages: PageItem[];
  /** By page uid. */
  annots: Record<string, Annot[]>;
  past: Snapshot[];
  future: Snapshot[];
  /** Changed since opened or saved. */
  dirty: boolean;
  /** Why it can only be viewed; null when it can be edited. */
  readOnly: string | null;
  signed: boolean;
  zoom: Zoom;
  /** The zoom as a number, worked out by the viewer for the window's size. */
  scale: number;
  /** The page most in view. */
  page: number;
  selectedAnnot: string | null;
  /** Picked pages in the sidebar and the page organizer. */
  selectedPages: string[];
  /** Asks the viewer to bring a page into view (`seq` makes each ask new). */
  scrollTo: { page: number; seq: number; y?: number } | null;
}

export interface SearchMatch {
  uid: string;
  /** The matched text, as pieces of pdf.js text items. */
  parts: { item: number; start: number; end: number }[];
}

export interface Search {
  open: boolean;
  query: string;
  results: SearchMatch[];
  current: number;
  /** Pages searched so far, while it runs. */
  progress: { done: number; total: number } | null;
  /** Bumped to focus the field again (⌘F while open). */
  focusSeq: number;
}

interface State {
  toasts: Toast[];
  updating: Updating | null;
  dialog: Dialog;
  /** Opening or saving: shown as a progress card. */
  busy: string | null;

  docs: Doc[];
  active: string | null;

  tool: Tool;
  styles: Record<Tool, ToolStyle>;
  /** The picture the image tool puts down next. */
  pendingImage: ImageInfo | null;
  /** What the left panel shows. */
  panel: "pages" | "comments" | "outline" | null;
  /** The page organizer (a grid of all pages) instead of the pages. */
  organizer: boolean;
  search: Search;
  /** The name put on new annotations. */
  author: string;

  addDoc: (d: Doc) => void;
  removeDoc: (key: string) => void;
  setActive: (key: string) => void;
  /** Changes the active tab without undo (view state). */
  patchDoc: (patch: Partial<Doc> | ((d: Doc) => Partial<Doc>), key?: string) => void;
  /** Changes pages or annotations, undoably. */
  commit: (change: (s: Snapshot) => Snapshot, key?: string) => void;
  /** Saves the state for undo before a change made in steps (a drag). */
  checkpoint: () => void;
  /** Changes pages or annotations without a new undo step (during a drag). */
  amend: (change: (s: Snapshot) => Snapshot) => void;
  undo: () => void;
  redo: () => void;

  setTool: (t: Tool) => void;
  setStyle: (t: Tool, patch: Partial<ToolStyle>) => void;
  setPendingImage: (i: ImageInfo | null) => void;
  setPanel: (p: State["panel"]) => void;
  setOrganizer: (on: boolean) => void;
  setSearch: (patch: Partial<Search>) => void;
  setAuthor: (name: string) => void;

  setBusy: (b: string | null) => void;
  setUpdating: (u: Updating | null) => void;
  openDialog: (d: Dialog) => void;
  toast: (message: string, error?: boolean, action?: ToastAction) => void;
  notify: (t: ToastOptions) => void;
  dismissToast: (id: number) => void;
}

let toastSeq = 0;
let uidSeq = 0;
export const newUid = () => `p${++uidSeq}`;
export const newAnnotId = () => `pdfe-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/** How many steps undo goes back. */
const HISTORY = 100;

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

const MARKER: ToolStyle = { color: "#ffd400", width: 1, opacity: 0.45, fill: null, fontSize: 12 };
const PEN: ToolStyle = { color: "#e5383b", width: 2, opacity: 1, fill: null, fontSize: 12 };
export const DEFAULT_STYLES: Record<Tool, ToolStyle> = {
  select: PEN,
  hand: PEN,
  highlight: MARKER,
  underline: { ...PEN, color: "#1d7ff2" },
  strikeout: { ...PEN },
  text: { color: "#111111", width: 0, opacity: 1, fill: null, fontSize: 12 },
  note: { ...MARKER, opacity: 1 },
  ink: PEN,
  rect: PEN,
  ellipse: PEN,
  line: PEN,
  arrow: PEN,
  image: { ...PEN },
};

function savedStyles(): Record<Tool, ToolStyle> {
  try {
    const s = JSON.parse(load("styles") ?? "{}") as Partial<Record<Tool, Partial<ToolStyle>>>;
    const out = { ...DEFAULT_STYLES };
    for (const k of Object.keys(out) as Tool[]) out[k] = { ...out[k], ...(s[k] ?? {}) };
    return out;
  } catch {
    return DEFAULT_STYLES;
  }
}

const savedPanel = load("panel");

export const useStore = create<State>()((set, get) => {
  /** Applies `f` to the tab `key` (default: the active one). */
  const withDoc = (key: string | undefined, f: (d: Doc) => Partial<Doc> | null) => {
    const k = key ?? get().active;
    set({
      docs: get().docs.map((d) => {
        if (d.key !== k) return d;
        const p = f(d);
        return p ? { ...d, ...p } : d;
      }),
    });
  };
  const snap = (d: Doc): Snapshot => ({ pages: d.pages, annots: d.annots });

  return {
    toasts: [],
    updating: null,
    dialog: null,
    busy: null,

    docs: [],
    active: null,

    tool: "select",
    styles: savedStyles(),
    pendingImage: null,
    panel: savedPanel === "none" ? null : ((savedPanel as State["panel"]) ?? "pages"),
    organizer: false,
    search: { open: false, query: "", results: [], current: 0, progress: null, focusSeq: 0 },
    author: "",

    addDoc: (d) => set({ docs: [...get().docs, d], active: d.key, organizer: false }),
    removeDoc: (key) => {
      const docs = get().docs;
      const i = docs.findIndex((d) => d.key === key);
      const rest = docs.filter((d) => d.key !== key);
      const active = get().active === key ? (rest[Math.min(i, rest.length - 1)]?.key ?? null) : get().active;
      set({ docs: rest, active });
    },
    setActive: (active) => set({ active, organizer: false }),
    patchDoc: (patch, key) => withDoc(key, (d) => (typeof patch === "function" ? patch(d) : patch)),
    commit: (change, key) =>
      withDoc(key, (d) => {
        if (d.readOnly) return null;
        const next = change(snap(d));
        if (next.pages === d.pages && next.annots === d.annots) return null;
        return { ...next, past: [...d.past.slice(-HISTORY + 1), snap(d)], future: [], dirty: true };
      }),
    checkpoint: () =>
      withDoc(undefined, (d) => ({ past: [...d.past.slice(-HISTORY + 1), snap(d)], future: [], dirty: true })),
    amend: (change) => withDoc(undefined, (d) => (d.readOnly ? null : { ...change(snap(d)), dirty: true })),
    undo: () =>
      withDoc(undefined, (d) => {
        const prev = d.past[d.past.length - 1];
        if (!prev) return null;
        return { ...prev, past: d.past.slice(0, -1), future: [snap(d), ...d.future], dirty: true, selectedAnnot: null };
      }),
    redo: () =>
      withDoc(undefined, (d) => {
        const next = d.future[0];
        if (!next) return null;
        return { ...next, past: [...d.past, snap(d)], future: d.future.slice(1), dirty: true, selectedAnnot: null };
      }),

    setTool: (tool) => {
      set({ tool, ...(tool !== "image" ? { pendingImage: null } : {}) });
      if (tool !== "select") withDoc(undefined, () => ({ selectedAnnot: null }));
    },
    setStyle: (tool, patch) => {
      const styles = { ...get().styles, [tool]: { ...get().styles[tool], ...patch } };
      set({ styles });
      persist("styles", JSON.stringify(styles));
    },
    setPendingImage: (pendingImage) => set({ pendingImage }),
    setPanel: (panel) => {
      set({ panel });
      persist("panel", panel ?? "none");
    },
    setOrganizer: (organizer) => set({ organizer }),
    setSearch: (patch) => set({ search: { ...get().search, ...patch } }),
    setAuthor: (author) => set({ author }),

    setBusy: (busy) => set({ busy }),
    setUpdating: (updating) => set({ updating }),
    openDialog: (dialog) => set({ dialog }),
    toast: (message, error, action) => get().notify({ title: message, kind: error ? "error" : "info", action }),
    notify: ({ title, detail, kind = "info", action, duration }) => {
      const id = ++toastSeq;
      const t: Toast = { id, title, detail, kind, action, duration: duration ?? (kind === "error" || action ? 8000 : 5000) };
      const live = get().toasts.filter((x) => !x.leaving);
      for (const old of live.slice(0, Math.max(0, live.length - 2))) get().dismissToast(old.id);
      set({ toasts: [...get().toasts, t] });
    },
    dismissToast: (id) => {
      if (!get().toasts.some((t) => t.id === id && !t.leaving)) return;
      set({ toasts: get().toasts.map((t) => (t.id === id ? { ...t, leaving: true } : t)) });
      setTimeout(() => set({ toasts: get().toasts.filter((t) => t.id !== id) }), 200);
    },
  };
});

export type S = State;

/** The active tab. */
export const activeDoc = (s: S): Doc | null => s.docs.find((d) => d.key === s.active) ?? null;

/** An annotation and the page it is on. */
export function findAnnot(d: Doc, id: string | null): { uid: string; annot: Annot } | null {
  if (!id) return null;
  for (const [uid, list] of Object.entries(d.annots)) {
    const annot = list.find((a) => a.id === id);
    if (annot) return { uid, annot };
  }
  return null;
}

// The one zustand store (Platform Architecture §5): the edit with its undo
// history, what is picked, the playhead, and what runs (previews being
// made, an export). Rust holds nothing of the edit; it only runs ffmpeg.
import { create } from "zustand";
import type { Prepared } from "./lib/api";
import { emptyProject, type Project } from "./lib/project";

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
export type Dialog = "settings" | "shortcuts" | "export" | null;

export type Selection =
  | { kind: "clip"; id: string }
  | { kind: "overlay"; id: string }
  /** The transition into clip `id` (or the place for one). */
  | { kind: "transition"; id: string }
  | null;

/** What the app made of a media file (src-tauri/src/media.rs). */
export interface MediaInfo {
  status: "preparing" | "ready" | "missing" | "error";
  /** 0..1 while a preview copy is made. */
  ratio?: number;
  prepared?: Prepared;
  error?: string;
}

/** An export running. */
export interface Exporting {
  output: string;
  done: number;
  total: number;
  /** Date.now() at the start. */
  started: number;
}

export type LeftTab = "media" | "text" | "stamp" | "transition";

/** A media file dragged from the media list toward the timeline. */
export interface MediaDrag {
  mediaId: string;
  x: number;
  y: number;
}

const HISTORY = 100;

interface State {
  toasts: Toast[];
  updating: Updating | null;
  dialog: Dialog;

  project: Project;
  /** The project as last saved or opened: unsaved changes when it differs. */
  saved: Project;
  /** The .vstudio file, once saved or opened. */
  path: string | null;
  past: Project[];
  future: Project[];
  /** The project before a drag began (`beginLive`). */
  liveBase: Project | null;

  selection: Selection;
  /** The playhead, timeline seconds. */
  time: number;
  playing: boolean;
  /** Timeline pixels per second. */
  zoom: number;
  leftTab: LeftTab;
  media: Record<string, MediaInfo>;
  mediaDrag: MediaDrag | null;
  exporting: Exporting | null;

  /** An edit: undoable. */
  commit: (next: Project) => void;
  /** A drag: changes show at once, and become one undo step at `endLive`. */
  beginLive: () => void;
  live: (next: Project) => void;
  endLive: () => void;
  undo: () => void;
  redo: () => void;
  /** A new or opened project: no history. */
  load: (p: Project, path: string | null) => void;
  markSaved: (path: string) => void;

  select: (s: Selection) => void;
  setTime: (t: number) => void;
  setPlaying: (p: boolean) => void;
  setZoom: (z: number) => void;
  setLeftTab: (t: LeftTab) => void;
  setMedia: (id: string, info: MediaInfo) => void;
  setMediaDrag: (d: MediaDrag | null) => void;
  setExporting: (e: Exporting | null) => void;

  setUpdating: (u: Updating | null) => void;
  openDialog: (d: Dialog) => void;
  toast: (message: string, error?: boolean, action?: ToastAction) => void;
  notify: (t: ToastOptions) => void;
  dismissToast: (id: number) => void;
}

let toastSeq = 0;

export const MIN_ZOOM = 4;
export const MAX_ZOOM = 600;

/** The selection, if what it names is still there. */
function keepSelection(sel: Selection, p: Project): Selection {
  if (!sel) return null;
  if (sel.kind === "overlay") return p.overlays.some((o) => o.id === sel.id) ? sel : null;
  return p.clips.some((c) => c.id === sel.id) ? sel : null;
}

export const useStore = create<State>()((set, get) => {
  const initial = emptyProject();
  return {
    toasts: [],
    updating: null,
    dialog: null,

    project: initial,
    saved: initial,
    path: null,
    past: [],
    future: [],
    liveBase: null,

    selection: null,
    time: 0,
    playing: false,
    zoom: 60,
    leftTab: "media",
    media: {},
    mediaDrag: null,
    exporting: null,

    commit: (next) => {
      const { project, past } = get();
      if (next === project) return;
      set({ project: next, past: [...past.slice(-HISTORY + 1), project], future: [], liveBase: null, selection: keepSelection(get().selection, next) });
    },
    beginLive: () => set({ liveBase: get().project }),
    live: (next) => set({ project: next }),
    endLive: () => {
      const { liveBase, project, past } = get();
      if (liveBase && liveBase !== project) set({ past: [...past.slice(-HISTORY + 1), liveBase], future: [] });
      set({ liveBase: null });
    },
    undo: () => {
      const { past, project, future } = get();
      const prev = past[past.length - 1];
      if (!prev) return;
      set({ project: prev, past: past.slice(0, -1), future: [project, ...future], selection: keepSelection(get().selection, prev) });
    },
    redo: () => {
      const { past, project, future } = get();
      const next = future[0];
      if (!next) return;
      set({ project: next, past: [...past, project], future: future.slice(1), selection: keepSelection(get().selection, next) });
    },
    load: (p, path) => set({ project: p, saved: p, path, past: [], future: [], selection: null, time: 0, playing: false }),
    markSaved: (path) => set({ saved: get().project, path }),

    select: (selection) => set({ selection }),
    setTime: (time) => set({ time: Math.max(0, time) }),
    setPlaying: (playing) => set({ playing }),
    setZoom: (zoom) => set({ zoom: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom)) }),
    setLeftTab: (leftTab) => set({ leftTab }),
    setMedia: (id, info) => set({ media: { ...get().media, [id]: info } }),
    setMediaDrag: (mediaDrag) => set({ mediaDrag }),
    setExporting: (exporting) => set({ exporting }),

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
      set({ toasts: get().toasts.map((t) => (t.id === id ? { ...t, leaving: true } : t)) });
      setTimeout(() => set({ toasts: get().toasts.filter((t) => t.id !== id) }), 200);
    },
  };
});

export type S = State;

export const dirty = (s: S) => s.project !== s.saved;

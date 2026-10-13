/**
 * Changes to a tab's pages and annotations, as pure functions from one
 * snapshot to the next (store.ts `commit` keeps the old one for undo).
 */
import type { Annot } from "./api";
import type { PageItem } from "../store";

export interface Snap {
  pages: PageItem[];
  annots: Record<string, Annot[]>;
}

export function addAnnot(s: Snap, uid: string, a: Annot): Snap {
  return { ...s, annots: { ...s.annots, [uid]: [...(s.annots[uid] ?? []), a] } };
}

export function updateAnnot(s: Snap, id: string, patch: Partial<Annot> | ((a: Annot) => Partial<Annot>)): Snap {
  for (const [uid, list] of Object.entries(s.annots)) {
    const i = list.findIndex((a) => a.id === id);
    if (i < 0) continue;
    const p = typeof patch === "function" ? patch(list[i]) : patch;
    const next = [...list];
    next[i] = { ...list[i], ...p, modified: "" };
    return { ...s, annots: { ...s.annots, [uid]: next } };
  }
  return s;
}

export function removeAnnot(s: Snap, id: string): Snap {
  for (const [uid, list] of Object.entries(s.annots)) {
    if (list.some((a) => a.id === id)) {
      return { ...s, annots: { ...s.annots, [uid]: list.filter((a) => a.id !== id) } };
    }
  }
  return s;
}

/** Brings an annotation to the front (drawn last). */
export function raiseAnnot(s: Snap, id: string): Snap {
  for (const [uid, list] of Object.entries(s.annots)) {
    const a = list.find((x) => x.id === id);
    if (a) return { ...s, annots: { ...s.annots, [uid]: [...list.filter((x) => x.id !== id), a] } };
  }
  return s;
}

/** Moves pages `uids` (in their current order) to before position `to`. */
export function movePages(s: Snap, uids: string[], to: number): Snap {
  const moving = new Set(uids);
  const before = s.pages.slice(0, to).filter((p) => !moving.has(p.uid));
  const after = s.pages.slice(to).filter((p) => !moving.has(p.uid));
  const moved = s.pages.filter((p) => moving.has(p.uid));
  const pages = [...before, ...moved, ...after];
  return pages.every((p, i) => p === s.pages[i]) ? s : { ...s, pages };
}

export function rotatePages(s: Snap, uids: string[], delta: number): Snap {
  const set = new Set(uids);
  return {
    ...s,
    pages: s.pages.map((p) => (set.has(p.uid) ? { ...p, rotate: (((p.rotate + delta) % 360) + 360) % 360 } : p)),
  };
}

export function removePages(s: Snap, uids: string[]): Snap {
  const set = new Set(uids);
  const annots = { ...s.annots };
  for (const u of uids) delete annots[u];
  return { pages: s.pages.filter((p) => !set.has(p.uid)), annots };
}

export function insertPages(s: Snap, at: number, pages: PageItem[], annots: Record<string, Annot[]> = {}): Snap {
  const i = Math.max(0, Math.min(at, s.pages.length));
  return { pages: [...s.pages.slice(0, i), ...pages, ...s.pages.slice(i)], annots: { ...s.annots, ...annots } };
}

/** Moves an annotation by (dx, dy) points. */
export function moved(a: Annot, dx: number, dy: number): Partial<Annot> {
  const shift = (v: number[]) => v.map((n, i) => n + (i % 2 ? dy : dx));
  return {
    rect: a.rect ? (shift(a.rect) as Annot["rect"]) : null,
    quads: a.quads.map(shift),
    paths: a.paths.map(shift),
    line: a.line ? (shift(a.line) as Annot["line"]) : null,
  };
}

/**
 * Fits an annotation from box `from` into box `to` (PDF rectangles): what
 * resizing by a handle does. Strokes and lines scale with the box.
 */
export function resized(a: Annot, from: [number, number, number, number], to: [number, number, number, number]): Partial<Annot> {
  const sx = (to[2] - to[0]) / (from[2] - from[0] || 1);
  const sy = (to[3] - to[1]) / (from[3] - from[1] || 1);
  const map = (v: number[]) => v.map((n, i) => (i % 2 ? to[1] + (n - from[1]) * sy : to[0] + (n - from[0]) * sx));
  return {
    rect: a.rect ? (to.slice() as Annot["rect"]) : null,
    paths: a.paths.map(map),
    line: a.line ? (map(a.line) as Annot["line"]) : null,
  };
}

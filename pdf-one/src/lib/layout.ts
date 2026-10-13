/**
 * Where each page of a tab sits in the scrolling view, and the zoom that
 * fits them. Pure functions of the pages and the window's size.
 */
import { CSS_PER_PT, shownRotation, viewSize, type Rect } from "./geometry";
import { getSource } from "./pdfjs";
import type { PageItem, Zoom } from "../store";

/** Space around and between pages, in CSS pixels. */
export const GAP = 16;

export interface PageGeom {
  uid: string;
  /** The page's visible box in PDF space. */
  view: Rect;
  /** Its rotation as shown (own + added). */
  rotation: number;
  left: number;
  top: number;
  width: number;
  height: number;
}

/** A page's box and rotation (a blank page is just its size). */
export function pageBox(p: PageItem): { view: Rect; rotation: number } {
  if (p.source === null) {
    const [w, h] = p.size ?? [595.276, 841.89];
    return { view: [0, 0, w, h], rotation: shownRotation(0, p.rotate) };
  }
  const info = getSource(p.source)?.pages[p.index];
  if (!info) return { view: [0, 0, 595.276, 841.89], rotation: 0 };
  return { view: info.view, rotation: shownRotation(info.rotate, p.rotate) };
}

/** Pages one under the other, centred, at `scale` (1 = 100%). */
export function layout(pages: PageItem[], scale: number, viewportWidth: number) {
  const px = scale * CSS_PER_PT;
  const sized = pages.map((p) => {
    const { view, rotation } = pageBox(p);
    const [width, height] = viewSize(view, px, rotation);
    return { p, view, rotation, width, height };
  });
  const widest = Math.max(0, ...sized.map((s) => s.width));
  const contentWidth = Math.max(viewportWidth, widest + 2 * GAP);
  let top = GAP;
  const geoms: PageGeom[] = sized.map((s) => {
    const g = { uid: s.p.uid, view: s.view, rotation: s.rotation, left: (contentWidth - s.width) / 2, top, width: s.width, height: s.height };
    top += s.height + GAP;
    return g;
  });
  return { geoms, width: contentWidth, height: top };
}

/** The zoom (1 = 100%) for a mode, given the view's size. */
export function fitScale(zoom: Zoom, pages: PageItem[], current: number, width: number, height: number): number {
  if (zoom.mode === "scale") return zoom.value;
  if (!pages.length || width <= 0) return 1;
  // Fitted to the page in view, so a tall page among wide ones still fits.
  const p = pages[Math.min(current, pages.length - 1)];
  const { view, rotation } = pageBox(p);
  const [w, h] = viewSize(view, CSS_PER_PT, rotation);
  const byWidth = (width - 2 * GAP - 12) / w;
  const s = zoom.mode === "fit-width" ? byWidth : Math.min(byWidth, (height - 2 * GAP) / h);
  return clampScale(s);
}

export const ZOOM_STEPS = [0.1, 0.25, 0.33, 0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5, 6.4];

export const clampScale = (s: number) => Math.min(6.4, Math.max(0.1, s));

/** The next zoom step up (`dir` 1) or down (-1) from `s`. */
export function stepZoom(s: number, dir: 1 | -1): number {
  if (dir > 0) return ZOOM_STEPS.find((z) => z > s + 0.001) ?? 6.4;
  return [...ZOOM_STEPS].reverse().find((z) => z < s - 0.001) ?? 0.1;
}

/** The page whose middle is nearest the middle of what is on screen. */
export function pageAt(geoms: PageGeom[], scrollTop: number, viewHeight: number): number {
  const mid = scrollTop + viewHeight / 3;
  let lo = 0;
  let hi = geoms.length - 1;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (geoms[m].top + geoms[m].height + GAP / 2 < mid) lo = m + 1;
    else hi = m;
  }
  return Math.max(0, lo);
}

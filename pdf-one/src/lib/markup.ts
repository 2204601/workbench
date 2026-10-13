/**
 * Text selected on a page (pdf.js's text layer) as the quadrilaterals of
 * a highlight, underline or strike-out.
 */
import { quadsFromRects, type Matrix, type Rect } from "./geometry";

/** The page element the current text selection is in, if one. */
export function selectionPage(): HTMLElement | null {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
  const node = sel.getRangeAt(0).commonAncestorContainer;
  const el = node instanceof HTMLElement ? node : node.parentElement;
  return el?.closest<HTMLElement>("[data-page-uid]") ?? null;
}

/** Which way text runs on screen there: the layer's and the span's turn. */
function textTurn(pageEl: HTMLElement, node: Node | null): number {
  const layer = pageEl.querySelector<HTMLElement>(".textLayer");
  const main = Number(layer?.dataset.mainRotation ?? 0);
  const span = node instanceof HTMLElement ? node : node?.parentElement;
  const own = parseFloat(span?.style.getPropertyValue("--rotate") ?? "0") || 0;
  return ((Math.round((main + own) / 90) * 90) % 360 + 360) % 360;
}

/** The selection on `pageEl` as quads in PDF space; null when there is none. */
export function selectionQuads(pageEl: HTMLElement, m: Matrix): { quads: number[][] } | null {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
  const range = sel.getRangeAt(0);
  const layer = pageEl.querySelector(".textLayer");
  if (!layer || !layer.contains(range.commonAncestorContainer)) return null;
  const box = pageEl.getBoundingClientRect();
  const rects: Rect[] = [];
  for (const r of Array.from(range.getClientRects())) {
    // Line ends and empty spans give zero-sized boxes; the end-of-content
    // helper gives one as big as the page.
    if (r.width < 1 || r.height < 1 || r.width > box.width * 0.98) continue;
    rects.push([r.left - box.left, r.top - box.top, r.right - box.left, r.bottom - box.top]);
  }
  if (!rects.length) return null;
  const quads = quadsFromRects(m, rects, textTurn(pageEl, range.startContainer));
  return { quads };
}

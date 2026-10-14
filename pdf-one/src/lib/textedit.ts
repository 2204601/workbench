/**
 * Fixing the page's own text, the screen's half (docs/SPEC.md「文字を直す」).
 * Rust lists the lines of text a page has (src-tauri/src/pdf/textedit.rs);
 * a fixed line is an annotation of kind "edit" that saving turns into a
 * rewrite of the page's content.
 */
import { api, type Annot, type TextLine } from "./api";
import type { Rect } from "./geometry";

/** Same as BOX_ASCENT and BOX_DESCENT in textedit.rs: a line's box, per point of size. */
export const TEXT_ASCENT = 0.88;
export const TEXT_DESCENT = 0.22;

const cache = new Map<string, Promise<TextLine[]>>();

/** The lines on page `index` of document `source`; asked once, as the file doesn't change. */
export function pageLines(source: number, index: number): Promise<TextLine[]> {
  const key = `${source}:${index}`;
  let p = cache.get(key);
  if (!p) {
    p = api.textLines(source, index).catch((e) => {
      cache.delete(key);
      throw e;
    });
    cache.set(key, p);
  }
  return p;
}

/** The baseline's start of a fixed line, in PDF space (where the old line sat). */
export function baselineOf(a: Pick<Annot, "rect">): [number, number] {
  const r = a.rect as Rect;
  // The box is (ascent + descent) × the old size tall.
  const size = (r[3] - r[1]) / (TEXT_ASCENT + TEXT_DESCENT);
  return [r[0], r[1] + TEXT_DESCENT * size];
}

export const inside = (r: Rect, x: number, y: number) => x >= r[0] && x <= r[2] && y >= r[1] && y <= r[3];

/**
 * The colour of the page around a box, to cover the old text on screen:
 * the most common colour of the pixels just outside it (a table's rules and
 * a neighbour's letters are rarer than the paper). `box` is in CSS pixels
 * of the page; white when the page can't be read.
 */
export function pageColorAround(canvas: HTMLCanvasElement | null, box: Rect, cssWidth: number): string {
  try {
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || !cssWidth) return "#ffffff";
    const k = canvas.width / cssWidth;
    const pad = 2;
    const x1 = Math.max(0, Math.floor((box[0] - pad) * k));
    const y1 = Math.max(0, Math.floor((box[1] - pad) * k));
    const x2 = Math.min(canvas.width, Math.ceil((box[2] + pad) * k));
    const y2 = Math.min(canvas.height, Math.ceil((box[3] + pad) * k));
    const w = x2 - x1;
    const h = y2 - y1;
    if (w < 2 || h < 2) return "#ffffff";
    const data = ctx.getImageData(x1, y1, w, h).data;
    const ring = Math.max(1, Math.round(pad * k));
    const bins = new Map<number, { n: number; r: number; g: number; b: number }>();
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const edge = x < ring || y < ring || x >= w - ring || y >= h - ring;
        if (!edge) continue;
        const i = (y * w + x) * 4;
        const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
        const key = (r >> 4) << 8 | (g >> 4) << 4 | (b >> 4);
        const e = bins.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
        e.n++;
        e.r += r;
        e.g += g;
        e.b += b;
        bins.set(key, e);
      }
    }
    let best: { n: number; r: number; g: number; b: number } | null = null;
    for (const e of bins.values()) if (!best || e.n > best.n) best = e;
    if (!best) return "#ffffff";
    const hex = (v: number) => Math.round(v / best!.n).toString(16).padStart(2, "0");
    return `#${hex(best.r)}${hex(best.g)}${hex(best.b)}`;
  } catch {
    return "#ffffff";
  }
}

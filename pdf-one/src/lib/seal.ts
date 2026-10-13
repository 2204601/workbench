/**
 * Seals the app draws (docs/SPEC.md「印鑑」): a round date seal with three
 * lines, or a word in a box. Where the words go is worked out here for the
 * screen exactly as src-tauri/src/pdf/annots.rs `seal_layout` does for the
 * file, so both look the same.
 */
import { LINE_HEIGHT, textWidth } from "./text";

export type SealShape = "round" | "box";

/** Room between the frame and the words, as a share of the seal's size. */
const PADDING = 0.08;

export interface SealLine {
  text: string;
  size: number;
  /** The left edge and the middle of the band, in points from the bottom left. */
  x: number;
  y: number;
}

export interface SealLayout {
  lines: SealLine[];
  /** Horizontal lines across the seal: y, from x1 to x2. */
  dividers: [number, number, number][];
}

export function sealLayout(shape: SealShape, w: number, h: number, size: number, border: number, lines: string[]): SealLayout {
  const pad = Math.min(w, h) * PADDING + border;
  const fit = (text: string, max: number) => {
    const at = textWidth(text, size);
    return at <= max || at <= 0 ? size : Math.max(4, (size * max) / at);
  };
  const out: SealLayout = { lines: [], dividers: [] };
  if (shape === "round") {
    const cx = w / 2;
    const cy = h / 2;
    const rx = w / 2 - border / 2;
    const ry = h / 2 - border / 2;
    const band = size * LINE_HEIGHT * 1.1;
    const chord = (y: number) => {
      const t = Math.max(-1, Math.min(1, (y - cy) / ry));
      return rx * Math.sqrt(1 - t * t);
    };
    for (const y of [cy + band / 2, cy - band / 2]) {
      const half = chord(y);
      out.dividers.push([y, cx - half, cx + half]);
    }
    const centres = [(cy + band / 2 + ry) / 2, cy, (cy - band / 2 - ry) / 2];
    lines.slice(0, 3).forEach((text, i) => {
      const y = centres[i];
      const max = Math.max(1, chord(y) * 2 - 2 * pad);
      const s = fit(text, max);
      out.lines.push({ text, size: s, x: cx - textWidth(text, s) / 2, y });
    });
  } else {
    const n = Math.max(1, lines.length);
    const lh = size * LINE_HEIGHT;
    const top = h / 2 + ((n - 1) * lh) / 2;
    const max = Math.max(1, w - 2 * pad);
    lines.forEach((text, i) => {
      const s = fit(text, max);
      out.lines.push({ text, size: s, x: w / 2 - textWidth(text, s) / 2, y: top - i * lh });
    });
  }
  return out;
}

/** Today for a date seal: 2026.10.13, or 令和8.10.13. */
export function sealDate(era: "western" | "reiwa", at = new Date()): string {
  const y = at.getFullYear();
  const m = at.getMonth() + 1;
  const d = at.getDate();
  if (era === "reiwa") {
    const r = y - 2018;
    return `令和${r === 1 ? "元" : r}.${m}.${d}`;
  }
  return `${y}.${String(m).padStart(2, "0")}.${String(d).padStart(2, "0")}`;
}

/** Words people stamp on documents, for the box seal. */
export const SEAL_WORDS = ["承認済み", "社外秘", "受領", "コピー", "回覧", "至急", "済", "控", "見本", "重要"];

/** The size of a box seal for `word` at `size` points: the word with some air. */
export function boxSealSize(word: string, size: number): [number, number] {
  const w = textWidth(word, size);
  return [Math.max(w + size * 1.2, size * 2.5), size * 1.7];
}

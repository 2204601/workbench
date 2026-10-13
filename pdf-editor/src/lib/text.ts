/**
 * Text boxes: the font they are drawn in and where their lines break.
 *
 * The file gets the lines exactly as they are broken here (Annot.lines), and
 * Rust embeds the same system font (src-tauri/src/pdf/font.rs), so the
 * screen and the file match.
 */

/** Same as src-tauri/src/pdf/annots.rs LINE_HEIGHT and TEXT_PADDING. */
export const LINE_HEIGHT = 1.25;
export const TEXT_PADDING = 2;

const FALLBACK = '"Yu Gothic", "Hiragino Sans", "Meiryo", "Noto Sans CJK JP", sans-serif';
let family = FALLBACK;

/** The CSS family of the font Rust embeds (null: it has none). */
export function setTextFont(name: string | null) {
  family = name ? `"${name}", ${FALLBACK}` : FALLBACK;
}

export const textFontFamily = () => family;

let ctx: CanvasRenderingContext2D | null = null;
function measure(): CanvasRenderingContext2D {
  if (!ctx) {
    ctx = document.createElement("canvas").getContext("2d")!;
    // Kerning would move letters where the PDF (which has none) doesn't.
    ctx.fontKerning = "none";
  }
  return ctx;
}

/** Width of `s` in points at `size` points. */
export function textWidth(s: string, size: number): number {
  const c = measure();
  // Measured at 100 px and scaled: canvas rounds small sizes.
  c.font = `100px ${family}`;
  return (c.measureText(s).width * size) / 100;
}

/**
 * Breaks `text` into lines no wider than `max` points: at spaces in Latin
 * text, anywhere in Japanese (which has none). Newlines are kept. The same
 * rule as src-tauri/src/pdf/forms.rs `wrap`.
 */
export function wrapText(text: string, size: number, max: number): string[] {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const ch of Array.from(para)) {
      const next = line + ch;
      if (line && textWidth(next, size) > max) {
        const space = line.lastIndexOf(" ");
        if (space > 0 && ch !== " ") {
          out.push(line.slice(0, space));
          line = line.slice(space + 1);
        } else {
          out.push(line);
          line = "";
        }
        if (ch === " ") continue;
      }
      line += ch;
    }
    out.push(line);
  }
  return out;
}

/** The height a text box needs for `lines` (points), padding and border included. */
export function textHeight(lines: number, size: number, border: number): number {
  return Math.max(1, lines) * size * LINE_HEIGHT + 2 * (TEXT_PADDING + border);
}

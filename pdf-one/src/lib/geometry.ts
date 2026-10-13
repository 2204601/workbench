/**
 * Between a page's PDF space (points, y up, before rotation) and the screen
 * (CSS pixels from the page's top left corner, y down, rotated as shown).
 * Pure functions: the overlay, the tools and the thumbnails share them.
 */

export type Rect = [number, number, number, number];
export type Matrix = [number, number, number, number, number, number];
export type Point = [number, number];

/** 100% zoom: a point is 96/72 CSS pixels, as in Acrobat and pdf.js. */
export const CSS_PER_PT = 96 / 72;

/**
 * The transform pdf.js's PageViewport uses (`viewBox`, `scale`, `rotation`),
 * from PDF space to the page's pixels.
 */
export function viewportTransform(view: Rect, scale: number, rotation: number): Matrix {
  const [x1, y1, x2, y2] = view;
  const cx = (x1 + x2) / 2;
  const cy = (y1 + y2) / 2;
  let a: number, b: number, c: number, d: number;
  switch (((rotation % 360) + 360) % 360) {
    case 90:
      [a, b, c, d] = [0, 1, 1, 0];
      break;
    case 180:
      [a, b, c, d] = [-1, 0, 0, 1];
      break;
    case 270:
      [a, b, c, d] = [0, -1, -1, 0];
      break;
    default:
      [a, b, c, d] = [1, 0, 0, -1];
  }
  let ox: number, oy: number;
  if (a === 0) {
    ox = Math.abs(cy - y1) * scale;
    oy = Math.abs(cx - x1) * scale;
  } else {
    ox = Math.abs(cx - x1) * scale;
    oy = Math.abs(cy - y1) * scale;
  }
  return [a * scale, b * scale, c * scale, d * scale, ox - a * scale * cx - c * scale * cy, oy - b * scale * cx - d * scale * cy];
}

/** The page's size on screen at `scale` with `rotation`. */
export function viewSize(view: Rect, scale: number, rotation: number): [number, number] {
  const w = (view[2] - view[0]) * scale;
  const h = (view[3] - view[1]) * scale;
  return rotation % 180 === 0 ? [w, h] : [h, w];
}

export const apply = (m: Matrix, [x, y]: Point): Point => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

export function invert(m: Matrix): Matrix {
  const det = m[0] * m[3] - m[1] * m[2];
  return [
    m[3] / det,
    -m[1] / det,
    -m[2] / det,
    m[0] / det,
    (m[2] * m[5] - m[3] * m[4]) / det,
    (m[1] * m[4] - m[0] * m[5]) / det,
  ];
}

/** A PDF rectangle on screen: still a rectangle, since rotations are by 90°. */
export function rectToScreen(m: Matrix, r: Rect): Rect {
  const [ax, ay] = apply(m, [r[0], r[1]]);
  const [bx, by] = apply(m, [r[2], r[3]]);
  return [Math.min(ax, bx), Math.min(ay, by), Math.max(ax, bx), Math.max(ay, by)];
}

export function rectToPdf(m: Matrix, r: Rect): Rect {
  return rectToScreen(invert(m), r);
}

export function normalize(r: Rect): Rect {
  return [Math.min(r[0], r[2]), Math.min(r[1], r[3]), Math.max(r[0], r[2]), Math.max(r[1], r[3])];
}

/** The total rotation a page is shown with. */
export const shownRotation = (own: number, extra: number) => (((own + extra) % 360) + 360) % 360;

/**
 * How much an annotation turned by `annotRotation` (to read upright on a
 * page shown at that rotation) is turned on screen now, clockwise.
 */
export const screenTurn = (pageRotation: number, annotRotation: number) =>
  (((pageRotation - annotRotation) % 360) + 360) % 360;

/**
 * Size of a text box or picture as it reads (its own width and height),
 * from its PDF rectangle.
 */
export function readingSize(r: Rect, rotation: number): [number, number] {
  const w = r[2] - r[0];
  const h = r[3] - r[1];
  return rotation % 180 === 0 ? [w, h] : [h, w];
}

/**
 * Text selection rectangles (screen, page-relative) as /QuadPoints in PDF
 * space: upper left, upper right, lower left, lower right of the text as
 * it reads. Rectangles on the same line are joined. `rotation` is the
 * direction the text runs on screen (0, 90, 180, 270 clockwise).
 */
export function quadsFromRects(m: Matrix, rects: Rect[], rotation: number): number[][] {
  // Join pieces of one line (pdf.js puts each run of text in its own span).
  const sorted = [...rects].sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  const vertical = rotation % 180 !== 0;
  const lines: Rect[] = [];
  for (const r of sorted) {
    const last = lines[lines.length - 1];
    const sameLine =
      last &&
      (vertical
        ? Math.abs(last[0] - r[0]) < (r[2] - r[0]) * 0.5 && Math.abs(last[2] - r[2]) < (r[2] - r[0]) * 0.5
        : Math.abs(last[1] - r[1]) < (r[3] - r[1]) * 0.5 && Math.abs(last[3] - r[3]) < (r[3] - r[1]) * 0.5);
    if (sameLine) {
      lines[lines.length - 1] = [Math.min(last[0], r[0]), Math.min(last[1], r[1]), Math.max(last[2], r[2]), Math.max(last[3], r[3])];
    } else {
      lines.push(r);
    }
  }
  const inv = invert(m);
  return lines.map(([x1, y1, x2, y2]) => {
    // Corners on screen as the text reads, for each rotation.
    // `rotation`: how the text runs on screen, clockwise (90: downwards,
    // its top to the right).
    const corners: Record<number, [Point, Point, Point, Point]> = {
      0: [[x1, y1], [x2, y1], [x1, y2], [x2, y2]],
      90: [[x2, y1], [x2, y2], [x1, y1], [x1, y2]],
      180: [[x2, y2], [x1, y2], [x2, y1], [x1, y1]],
      270: [[x1, y2], [x1, y1], [x2, y2], [x2, y1]],
    };
    return corners[rotation].flatMap((p) => apply(inv, p));
  });
}

/** Points of a stroke, simplified (Ramer–Douglas–Peucker) within `tolerance`. */
export function simplify(points: Point[], tolerance: number): Point[] {
  if (points.length <= 2) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop()!;
    const [ax, ay] = points[s];
    const [bx, by] = points[e];
    const len = Math.hypot(bx - ax, by - ay) || 1;
    let best = -1;
    let dist = tolerance;
    for (let i = s + 1; i < e; i++) {
      const [px, py] = points[i];
      const d = Math.abs((bx - ax) * (ay - py) - (ax - px) * (by - ay)) / len;
      if (d > dist) {
        dist = d;
        best = i;
      }
    }
    if (best > 0) {
      keep[best] = 1;
      stack.push([s, best], [best, e]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

/** The bounding box of an annotation in PDF space. */
export function bounds(a: { rect: Rect | null; quads: number[][]; paths: number[][]; line: Rect | null; width: number }): Rect | null {
  if (a.rect) return a.rect;
  const xs: number[] = [];
  const ys: number[] = [];
  const add = (v: number[]) => {
    for (let i = 0; i + 1 < v.length; i += 2) {
      xs.push(v[i]);
      ys.push(v[i + 1]);
    }
  };
  a.quads.forEach(add);
  a.paths.forEach(add);
  if (a.line) add(a.line);
  if (!xs.length) return null;
  const w = a.width / 2;
  return [Math.min(...xs) - w, Math.min(...ys) - w, Math.max(...xs) + w, Math.max(...ys) + w];
}

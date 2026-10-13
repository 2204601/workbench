/**
 * The three layouts (docs/SPEC.md §5), each from the same tree:
 *
 * - サンバースト: rings around the folder, as DaisyDisk draws it. The angle
 *   is the size; each ring is one level deeper.
 * - ツリーマップ: boxes inside boxes, as WizTree draws it. The area is the size.
 * - アイシクル: columns from left to right, one per level. The height is the size.
 * - 円グラフ / 棒グラフ: only what is directly in the folder, each with its
 *   name, size and share written beside it. For whoever finds the three
 *   above hard to read.
 */
import { partition, treemap, treemapSquarify } from "d3-hierarchy";
import { arc, pie, type PieArcDatum } from "d3-shape";
import type { ViewNode } from "../../lib/api";
import { bytes, percent } from "../../lib/format";
import { nameOf, SLOTS } from "../../lib/charts";
import { colorOf, fit, toHierarchy, type Label, type Layout, type Node, type Shape } from "./shapes";

/** The sunburst's middle, where the folder (or the item pointed at) is named. */
export function sunburstCenter(w: number, h: number) {
  const radius = Math.max(40, Math.min(w, h) / 2 - 10);
  return { cx: w / 2, cy: h / 2, radius, hole: radius * 0.3 };
}

export function sunburst(root: Node, slots: Map<number, string>, w: number, h: number): Layout {
  const { cx, cy, radius, hole } = sunburstCenter(w, h);
  const rings = Math.max(root.height, 1);
  partition<typeof root.data>().size([2 * Math.PI, root.height + 1])(root);
  const r = (y: number) => (y <= 1 ? hole * y : hole + ((y - 1) * (radius - hole)) / rings);
  type P = Node & { x0: number; x1: number; y0: number; y1: number };
  const path = arc<P>()
    .startAngle((n) => n.x0)
    .endAngle((n) => n.x1)
    .padAngle((n) => Math.min((n.x1 - n.x0) / 2, 0.004))
    .padRadius(radius)
    .innerRadius((n) => r(n.y0) + 1)
    .outerRadius((n) => r(n.y1));
  const shapes: Shape[] = [];
  for (const n of root.descendants() as P[]) {
    if (n.depth === 0 || n.x1 - n.x0 < 0.003 || !n.value) continue;
    const d = path(n);
    if (!d) continue;
    shapes.push({ n, d, ...colorOf(n, slots) });
  }
  // d3's arcs are around (0, 0); ChartArea moves them to the middle.
  return { shapes, labels: [], origin: [cx, cy] };
}

export function treemapLayout(root: Node, slots: Map<number, string>, w: number, h: number): Layout {
  treemap<typeof root.data>()
    .tile(treemapSquarify.ratio(1.2))
    .size([w, h])
    .round(true)
    .paddingOuter((n) => (n.depth === 0 ? 4 : 2))
    .paddingInner(2)
    .paddingTop((n) => (n.depth === 0 ? 4 : n.depth === 1 ? 20 : 2))(root);
  type R = Node & { x0: number; x1: number; y0: number; y1: number };
  const shapes: Shape[] = [];
  const labels: Label[] = [];
  for (const n of root.descendants() as R[]) {
    if (n.depth === 0) continue;
    const bw = n.x1 - n.x0;
    const bh = n.y1 - n.y0;
    if (bw < 1 || bh < 1) continue;
    const { fill, opacity } = colorOf(n, slots);
    // A folder with its contents drawn is a faint frame around them.
    const frame = !!n.children;
    shapes.push({ n, rect: [n.x0, n.y0, bw, bh], fill, opacity: frame ? 0.2 : opacity });
    if (frame && n.depth === 1 && bw > 50) {
      labels.push({ x: n.x0 + 6, y: n.y0 + 14, text: fit(`${nameOf(n.data)}  ${bytes(n.data.size)}`, bw - 12), bold: true });
    } else if (!frame && bw > 64 && bh > 34) {
      labels.push({ x: n.x0 + 6, y: n.y0 + 16, text: fit(nameOf(n.data), bw - 12), sub: bytes(n.data.size) });
    }
  }
  return { shapes, labels };
}

export function icicle(root: Node, slots: Map<number, string>, w: number, h: number): Layout {
  partition<typeof root.data>().size([h, root.height + 1])(root);
  const first = Math.min(150, w * 0.18);
  const col = (w - first) / Math.max(root.height, 1);
  const x = (y: number) => (y <= 1 ? first * y : first + (y - 1) * col);
  type P = Node & { x0: number; x1: number; y0: number; y1: number };
  const shapes: Shape[] = [];
  const labels: Label[] = [];
  for (const n of root.descendants() as P[]) {
    const top = n.x0;
    const bh = n.x1 - n.x0;
    if (bh < 0.6 || !n.value) continue;
    const left = x(n.y0);
    const bw = x(n.y1) - left;
    shapes.push({ n, rect: [left + 1, top + 1, bw - 2, Math.max(0.5, bh - 2)], ...colorOf(n, slots) });
    if (bh > 18) {
      labels.push({
        x: left + 7,
        y: top + (bh > 34 ? 16 : bh / 2 + 4),
        text: fit(nameOf(n.data), bw - 14),
        sub: bh > 34 ? bytes(n.data.size) : undefined,
        bold: n.depth <= 1,
      });
    }
  }
  return { shapes, labels };
}

/**
 * The folder with at most `max` items directly in it: past that, the rest
 * (with Rust's folded item, which comes last) become one gray "その他".
 */
function topItems(root: Node, max: number): Node {
  const kids = root.data.children ?? [];
  if (kids.length <= max) return root;
  const rest = kids.slice(max - 1);
  const folded = rest.reduce((a, c) => a + (c.id === null ? c.folded : 1), 0);
  const other: ViewNode = {
    id: null,
    name: `その他 ${folded.toLocaleString("ja-JP")} 個`,
    size: rest.reduce((a, c) => a + c.size, 0),
    dir: false,
    files: rest.reduce((a, c) => a + c.files, 0),
    folded,
  };
  return toHierarchy({ ...root.data, children: [...kids.slice(0, max - 1), other] });
}

export function pieLayout(full: Node, slots: Map<number, string>, w: number, h: number): Layout {
  // The eight colors and one gray: a ninth hue would be too close to one of them.
  const root = topItems(full, SLOTS + 1);
  const items = root.children ?? [];
  const total = root.value ?? 0;
  const shapes: Shape[] = [];
  const labels: Label[] = [];
  if (!total) return { shapes, labels };

  // The legend beside the pie names every slice; without room for it the
  // slices carry the names themselves.
  const gap = 40;
  const margin = 24;
  const legendW = Math.min(300, Math.max(240, w * 0.45));
  const room = (w - margin * 2 - legendW - gap) / 2;
  const legend = room >= 90;
  const radius = Math.max(40, Math.min(h / 2 - margin, legend ? room : w / 2 - margin));
  const groupW = legend ? radius * 2 + gap + legendW : radius * 2;
  const cx = (w - groupW) / 2 + radius;
  const cy = h / 2;

  // Largest first from 12 o'clock, clockwise; the gray "その他" last.
  const arcs = pie<Node>()
    .value((n) => n.value ?? 0)
    .sort(null)(items);
  const path = arc<PieArcDatum<Node>>().innerRadius(0).outerRadius(radius);
  for (const a of arcs) {
    const d = path(a);
    if (!d || a.endAngle - a.startAngle < 0.002) continue;
    shapes.push({ n: a.data, d, ...colorOf(a.data, slots) });
    // The share inside the slice when it fits there (about 40px of arc).
    const angle = a.endAngle - a.startAngle;
    if (angle * radius * 0.62 < 40) continue;
    // d3 measures from 12 o'clock, clockwise.
    const mid = (a.startAngle + a.endAngle) / 2;
    const x = Math.sin(mid) * radius * 0.62;
    const y = -Math.cos(mid) * radius * 0.62;
    const share = percent(a.data.value ?? 0, total);
    if (legend || angle * radius * 0.62 < 90) labels.push({ x, y: y + 5, text: share, bold: true, anchor: "middle" });
    else labels.push({ x, y: y - 3, text: fit(nameOf(a.data.data), radius * 0.7), sub: share, bold: true, anchor: "middle" });
  }

  if (legend) {
    const rowH = 28;
    const head = 46;
    const lx = radius + gap;
    const top = -(head + items.length * rowH) / 2;
    labels.push({ x: lx, y: top + 14, text: fit(nameOf(root.data), legendW), bold: true, sub: `合計 ${bytes(total)}` });
    items.forEach((n, i) => {
      const y = top + head + i * rowH;
      const { fill } = colorOf(n, slots);
      shapes.push({ n, rect: [lx, y + 8, 12, 12], fill, opacity: 1 });
      shapes.push({ n, rect: [lx - 6, y, legendW + 12, rowH], fill, opacity: 0, hit: true });
      const value = `${bytes(n.value ?? 0)}・${percent(n.value ?? 0, total)}`;
      labels.push({ x: lx + 20, y: y + 18, text: fit(nameOf(n.data), legendW - 20 - 112) });
      labels.push({ x: lx + legendW, y: y + 18, text: value, dim: true, anchor: "end" });
    });
  }
  // d3's arcs are around (0, 0); ChartArea moves them to the middle.
  return { shapes, labels, origin: [cx, cy] };
}

export function barLayout(full: Node, slots: Map<number, string>, w: number, h: number): Layout {
  const pad = 14;
  const head = 44;
  const minRow = 22;
  const root = topItems(full, Math.max(1, Math.floor((h - pad * 2 - head) / minRow)));
  const items = root.children ?? [];
  const total = root.value ?? 0;
  const shapes: Shape[] = [];
  const labels: Label[] = [];
  if (!total || !items.length) return { shapes, labels };

  labels.push({ x: pad, y: pad + 14, text: fit(nameOf(root.data), w - pad * 2), bold: true, sub: `合計 ${bytes(total)}` });
  // One row per item, largest first: the name, the bar, then size and share.
  const rowH = Math.min(36, (h - pad * 2 - head) / items.length);
  const barH = Math.min(20, rowH * 0.64);
  const nameW = Math.min(240, Math.max(120, w * 0.28));
  const valueW = 140;
  const x0 = pad + nameW + 10;
  const longest = Math.max(20, w - x0 - valueW - pad);
  const largest = Math.max(...items.map((n) => n.value ?? 0)) || 1;
  items.forEach((n, i) => {
    const y = pad + head + i * rowH;
    const size = n.value ?? 0;
    const len = Math.max(2, (size / largest) * longest);
    const { fill, opacity } = colorOf(n, slots);
    shapes.push({ n, rect: [x0, y + (rowH - barH) / 2, len, barH], fill, opacity });
    shapes.push({ n, rect: [pad, y, w - pad * 2, rowH], fill, opacity: 0, hit: true });
    const base = y + rowH / 2 + 4;
    labels.push({ x: pad, y: base, text: fit(nameOf(n.data), nameW) });
    labels.push({ x: x0 + len + 8, y: base, text: `${bytes(size)}・${percent(size, total)}`, dim: true });
  });
  return { shapes, labels };
}

/**
 * The three layouts (docs/SPEC.md §5), each from the same tree:
 *
 * - サンバースト: rings around the folder, as DaisyDisk draws it. The angle
 *   is the size; each ring is one level deeper.
 * - ツリーマップ: boxes inside boxes, as WizTree draws it. The area is the size.
 * - アイシクル: columns from left to right, one per level. The height is the size.
 */
import { partition, treemap, treemapSquarify } from "d3-hierarchy";
import { arc } from "d3-shape";
import { bytes } from "../../lib/format";
import { nameOf } from "../../lib/charts";
import { colorOf, fit, type Label, type Layout, type Node, type Shape } from "./shapes";

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

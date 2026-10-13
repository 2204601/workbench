/**
 * What every chart turns the tree into: shapes to fill and labels to write.
 * ChartArea draws them and handles the pointer for all three, so the charts
 * themselves are only layouts (docs/SPEC.md §5).
 */
import { hierarchy, type HierarchyNode } from "d3-hierarchy";
import type { ViewNode } from "../../lib/api";
import { depthOpacity, OTHER } from "../../lib/charts";

export type Node = HierarchyNode<ViewNode>;

export interface Shape {
  n: Node;
  /** An SVG path, or a rectangle [x, y, width, height]. */
  d?: string;
  rect?: [number, number, number, number];
  fill: string;
  opacity: number;
  /** Not drawn: a larger target for the pointer (a legend row, a bar's row). */
  hit?: boolean;
}

export interface Label {
  x: number;
  y: number;
  text: string;
  /** Size, under the name. */
  sub?: string;
  bold?: boolean;
  /** In the dimmer ink. */
  dim?: boolean;
  anchor?: "middle" | "end";
}

export interface Layout {
  shapes: Shape[];
  labels: Label[];
  /** Where (0, 0) of the shapes goes; the top left when absent. */
  origin?: [number, number];
}

/** The tree as d3 lays it out: a folder's value is the sum of what it holds. */
export function toHierarchy(view: ViewNode): Node {
  return hierarchy(view, (d) => d.children).sum((d) => (d.children?.length ? 0 : d.size));
}

/** The color of `n`: its ancestor directly in the folder decides (charts.ts). */
export function colorOf(n: Node, slots: Map<number, string>): { fill: string; opacity: number } {
  if (n.depth === 0) return { fill: "var(--color-raised)", opacity: 1 };
  const top = n.depth === 1 ? n : n.ancestors()[n.depth - 1];
  const fill = top.data.id === null || n.data.id === null ? OTHER : (slots.get(top.data.id) ?? OTHER);
  return { fill, opacity: depthOpacity(n.depth) };
}

/** Text cut to about `px` wide: CJK characters are about as wide as the font size, others a little over half. */
export function fit(text: string, px: number, size = 12): string {
  const width = (i: number) => (text.charCodeAt(i) > 0xff ? size : size * 0.6);
  let total = 0;
  for (let i = 0; i < text.length; i++) total += width(i);
  if (total <= px) return text;
  // As many characters as fit with the ellipsis after them.
  const room = px - size;
  let w = 0;
  let j = 0;
  while (j < text.length && w + width(j) <= room) w += width(j++);
  return j > 0 ? `${text.slice(0, j)}…` : "";
}

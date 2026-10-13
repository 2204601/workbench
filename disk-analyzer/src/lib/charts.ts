/**
 * The three charts (docs/SPEC.md §5) and how they color what they draw.
 * Each asks Rust for as much of the tree as it can show: how deep, and the
 * share under which items fold into one gray "小さな項目".
 */
import { ChartPie, ChartNoAxesGantt, LayoutDashboard, type LucideIcon } from "lucide-react";
import type { ViewNode } from "./api";

export type ChartKind = "sunburst" | "treemap" | "icicle";

export interface ChartInfo {
  label: string;
  icon: LucideIcon;
  /** Levels below the folder on screen. */
  depth: number;
  minShare: number;
}

export const CHARTS: Record<ChartKind, ChartInfo> = {
  sunburst: { label: "サンバースト", icon: ChartPie, depth: 5, minShare: 0.004 },
  // Area is the size, so smaller items still show; three levels keep the boxes readable.
  treemap: { label: "ツリーマップ", icon: LayoutDashboard, depth: 3, minShare: 0.0005 },
  icicle: { label: "アイシクル", icon: ChartNoAxesGantt, depth: 4, minShare: 0.002 },
};

export const CHART_KINDS = Object.keys(CHARTS) as ChartKind[];

/**
 * The items directly in the folder take the categorical colors in order,
 * largest first (index.css: --color-s1 … s8); deeper items take their
 * ancestor's color, fainter with depth. Past eight, and the folded item,
 * are gray: a ninth hue would be too close to one of the eight.
 */
export const SLOTS = 8;

/** The color of each item directly in the folder, by id. */
export function slotsOf(view: ViewNode | null): Map<number, string> {
  const out = new Map<number, string>();
  let i = 0;
  for (const c of view?.children ?? []) {
    if (c.id === null) continue;
    out.set(c.id, i < SLOTS ? `var(--color-s${i + 1})` : "var(--color-other)");
    i++;
  }
  return out;
}

export const OTHER = "var(--color-other)";

/** Opacity of an item `depth` levels below the folder (1 = directly in it). */
export const depthOpacity = (depth: number) => [1, 1, 0.74, 0.56, 0.44, 0.36, 0.3][Math.min(depth, 6)];

/** "小さな項目 120 個" for the folded item. */
export const nameOf = (n: ViewNode) => (n.id === null ? `小さな項目 ${n.folded.toLocaleString("ja-JP")} 個` : n.name);

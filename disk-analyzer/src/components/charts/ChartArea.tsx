import { memo, useEffect, useMemo, useRef, useState } from "react";
import { activate, goUp } from "../../lib/actions";
import type { ViewNode } from "../../lib/api";
import { nameOf, slotsOf, type ChartKind } from "../../lib/charts";
import { itemMenu } from "../../lib/contextMenu";
import { bytes, count, percent } from "../../lib/format";
import { useStore } from "../../store";
import { barLayout, icicle, pieLayout, sunburst, sunburstCenter, treemapLayout } from "./layouts";
import { fit, toHierarchy, type Layout, type Node, type Shape } from "./shapes";

const LAYOUTS: Record<ChartKind, typeof sunburst> = { sunburst, treemap: treemapLayout, icicle, pie: pieLayout, bar: barLayout };

function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      const { width, height } = e.contentRect;
      setSize((s) => (s.w === Math.round(width) && s.h === Math.round(height) ? s : { w: Math.round(width), h: Math.round(height) }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size] as const;
}

function ShapeEl({ s, i }: { s: Shape; i: number }) {
  const cls = `${s.hit ? "hit" : "mark"}${s.n.data.dir || s.n.depth === 0 ? " dir" : ""}`;
  const style = { fill: s.fill, fillOpacity: s.opacity };
  if (s.rect) {
    const [x, y, w, h] = s.rect;
    return <rect data-i={i} className={cls} x={x} y={y} width={w} height={h} rx={Math.min(3, w / 4, h / 4)} style={style} />;
  }
  return <path data-i={i} className={cls} d={s.d} style={style} />;
}

/** Thousands of shapes: drawn once per layout, not again on every hover. */
const Shapes = memo(function Shapes({ layout }: { layout: Layout }) {
  return (
    <>
      {layout.shapes.map((s, i) => (
        <ShapeEl key={i} s={s} i={i} />
      ))}
      {layout.labels.map((l, i) => (
        <g key={i} className="label" textAnchor={l.anchor}>
          <text x={l.x} y={l.y} className={l.dim ? "sub" : undefined} style={{ fontWeight: l.bold ? 600 : 400 }}>
            {l.text}
          </text>
          {l.sub && (
            <text x={l.x} y={l.y + 15} className="sub">
              {l.sub}
            </text>
          )}
        </g>
      ))}
    </>
  );
});

/** An outline over the shape of `id` (the item pointed at, or the one picked). */
function Outline({ layout, id, kind }: { layout: Layout; id: number | null; kind: "hover" | "selected" }) {
  if (id === null) return null;
  const s = layout.shapes.find((x) => x.n.data.id === id && x.n.depth > 0 && !x.hit);
  if (!s) return null;
  const cls = `edge ${kind}`;
  if (s.rect) {
    const [x, y, w, h] = s.rect;
    return <rect className={cls} x={x} y={y} width={w} height={h} rx={Math.min(3, w / 4, h / 4)} />;
  }
  return <path className={cls} d={s.d} />;
}

/** The sunburst's middle: the folder, or the item pointed at. */
function Center({ w, h, hovered, folder }: { w: number; h: number; hovered: Node | null; folder: ViewNode }) {
  const { hole } = sunburstCenter(w, h);
  const parent = useStore((s) => s.folder?.parent ?? null);
  const n = hovered?.data ?? folder;
  return (
    <g className="center">
      <circle r={hole - 3} className={parent !== null ? "up" : undefined} onClick={() => goUp()} />
      <text y={-8} textAnchor="middle" style={{ fontWeight: 600, fontSize: 14 }}>
        {fit(nameOf(n), hole * 1.6, 14)}
      </text>
      <text y={13} textAnchor="middle" className="sub" style={{ fontSize: 13 }}>
        {bytes(n.size)}
      </text>
      <text y={31} textAnchor="middle" className="sub">
        {hovered ? percent(n.size, folder.size) : parent !== null ? "クリックで上へ" : ""}
      </text>
    </g>
  );
}

interface Tip {
  x: number;
  y: number;
  n: Node;
}

function Tooltip({ tip, total, box }: { tip: Tip; total: number; box: { w: number; h: number } }) {
  const n = tip.n.data;
  const where = tip.n
    .ancestors()
    .slice(1, -1)
    .reverse()
    .map((a) => a.data.name)
    .join(" › ");
  const right = tip.x + 300 > box.w;
  const below = tip.y + 90 < box.h;
  return (
    <div
      className="pointer-events-none absolute z-10 max-w-72 rounded-lg border border-line bg-raised px-3 py-2 text-xs shadow-xl shadow-black/40"
      style={{
        left: right ? undefined : tip.x + 14,
        right: right ? box.w - tip.x + 14 : undefined,
        top: below ? tip.y + 14 : undefined,
        bottom: below ? undefined : box.h - tip.y + 14,
      }}
    >
      {where && <div className="truncate text-[11px] text-dim">{where}</div>}
      <div className="font-semibold break-all">{nameOf(n)}</div>
      <div className="mt-0.5 text-dim tabular-nums">
        {bytes(n.size)}・{percent(n.size, total)}
        {(n.dir || n.id === null) && `・${count(n.files)} ファイル`}
      </div>
      {n.id === null && <div className="mt-1 text-dim">まとめた項目は右の一覧で見られます</div>}
    </div>
  );
}

/** The chart of the folder on screen (docs/SPEC.md §5). */
export function ChartArea() {
  const view = useStore((s) => s.view);
  const kind = useStore((s) => s.chart);
  const hover = useStore((s) => s.hover);
  const selected = useStore((s) => s.selected);
  const setHover = useStore((s) => s.setHover);
  const [ref, size] = useSize<HTMLDivElement>();
  const [tip, setTip] = useState<Tip | null>(null);

  const slots = useMemo(() => slotsOf(view), [view]);
  const layout = useMemo(() => {
    if (!view || size.w < 20 || size.h < 20) return null;
    return LAYOUTS[kind](toHierarchy(view), slots, size.w, size.h);
  }, [view, kind, slots, size]);

  const shapeAt = (e: React.MouseEvent): Node | null => {
    const i = (e.target as Element).getAttribute("data-i");
    return i !== null && layout ? (layout.shapes[Number(i)]?.n ?? null) : null;
  };

  const onMove = (e: React.MouseEvent) => {
    const n = shapeAt(e);
    if (!n) {
      setTip(null);
      setHover(null);
      return;
    }
    const r = ref.current!.getBoundingClientRect();
    setTip({ x: e.clientX - r.left, y: e.clientY - r.top, n });
    setHover(n.depth === 0 ? null : n.data.id);
  };
  const onLeave = () => {
    setTip(null);
    setHover(null);
  };
  const onClick = (e: React.MouseEvent) => {
    const n = shapeAt(e);
    if (!n) return;
    setTip(null);
    if (n.depth === 0) goUp();
    else activate(n.data.id, n.data.dir);
  };
  const onContext = (e: React.MouseEvent) => {
    const n = shapeAt(e);
    if (!n || n.data.id === null) return;
    e.preventDefault();
    void itemMenu(n.data.id, n.data.dir);
  };

  // The item pointed at, also when it is pointed at in the list.
  const hovered = useMemo(() => {
    if (hover === null || !layout) return null;
    return layout.shapes.find((s) => s.n.data.id === hover)?.n ?? null;
  }, [hover, layout]);

  const [ox, oy] = layout?.origin ?? [0, 0];
  return (
    <div ref={ref} className="relative min-h-0 min-w-0 flex-1 overflow-hidden">
      {layout && view && (
        <svg
          className="chart absolute inset-0 h-full w-full animate-fade-in"
          key={`${kind}-${view.id}`}
          viewBox={`0 0 ${size.w} ${size.h}`}
          onMouseMove={onMove}
          onMouseLeave={onLeave}
          onClick={onClick}
          onContextMenu={onContext}
          role="img"
          aria-label={`${view.name} の容量のグラフ`}
        >
          <g transform={`translate(${ox},${oy})`}>
            <Shapes layout={layout} />
            <Outline layout={layout} id={selected} kind="selected" />
            <Outline layout={layout} id={hover} kind="hover" />
            {kind === "sunburst" && <Center w={size.w} h={size.h} hovered={hovered} folder={view} />}
          </g>
        </svg>
      )}
      {tip && view && <Tooltip tip={tip} total={view.size} box={size} />}
      {view && view.size === 0 && (
        <div className="absolute inset-0 flex items-center justify-center text-dim">このフォルダは空です（0 バイト）</div>
      )}
    </div>
  );
}

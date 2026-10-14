import { useRef } from "react";

/**
 * A thin handle on a side panel's edge (docs/UX.md §4): drag to change the
 * width, double-click to put it back, arrow keys for the keyboard. `edge` is
 * the side of the panel the handle sits on; the panel's parent must be
 * `relative`.
 */
export function Resizer({
  edge,
  label,
  width,
  range,
  onChange,
}: {
  edge: "left" | "right";
  label: string;
  width: number;
  range: { min: number; max: number; init: number };
  onChange: (px: number) => void;
}) {
  const start = useRef<{ x: number; w: number } | null>(null);
  // Dragging toward the page widens a panel on its right edge; away from it, one on its left.
  const sign = edge === "right" ? 1 : -1;
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={width}
      aria-valuemin={range.min}
      aria-valuemax={range.max}
      tabIndex={0}
      title="ドラッグで幅を変えられます（ダブルクリックで元の幅）"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        start.current = { x: e.clientX, w: width };
      }}
      onPointerMove={(e) => {
        if (start.current) onChange(start.current.w + sign * (e.clientX - start.current.x));
      }}
      onPointerUp={() => (start.current = null)}
      onPointerCancel={() => (start.current = null)}
      onDoubleClick={() => onChange(range.init)}
      onKeyDown={(e) => {
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
        e.preventDefault();
        onChange(width + (e.key === "ArrowRight" ? 1 : -1) * sign * 16);
      }}
      style={edge === "right" ? { right: -3 } : { left: -3 }}
      className="absolute inset-y-0 z-20 w-1.5 cursor-col-resize outline-none hover:bg-accent/40 focus-visible:bg-accent/60 active:bg-accent/60"
    />
  );
}

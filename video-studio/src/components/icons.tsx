import { useEffect, useRef } from "react";
import type { TransitionKind } from "../lib/project";
import type { Shape } from "../lib/stamps";

/** A shape stamp, drawn as it will be (src/lib/stamps.ts). */
export function ShapeIcon({ shape, color, size = 34 }: { shape: Shape; color: string; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = size * dpr;
    c.height = size * dpr;
    const ctx = c.getContext("2d")!;
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.translate(c.width / 2, c.height / 2);
    const s = (c.height * 0.8) / Math.max(1, shape.aspect);
    shape.draw(ctx, s, color);
  }, [shape, color, size]);
  return <canvas ref={ref} style={{ width: size, height: size }} />;
}

const A = "#4c8dff";
const B = "#f07a45";

/** A small picture of a transition: blue is the clip before, orange the one after. */
export function TransitionIcon({ kind }: { kind: TransitionKind }) {
  const w = 56;
  const h = 32;
  const id = `g-${kind}`;
  const arrow = (d: "l" | "r" | "u" | "d") => {
    const p = { l: "M38 16 L22 16 M27 11 L22 16 L27 21", r: "M18 16 L34 16 M29 11 L34 16 L29 21", u: "M28 24 L28 8 M23 13 L28 8 L33 13", d: "M28 8 L28 24 M23 19 L28 24 L33 19" }[d];
    return <path d={p} stroke="#fff" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />;
  };
  let body: React.ReactNode;
  switch (kind) {
    case "fade":
      body = (
        <>
          <defs>
            <linearGradient id={id}>
              <stop offset="0.15" stopColor={A} />
              <stop offset="0.85" stopColor={B} />
            </linearGradient>
          </defs>
          <rect width={w} height={h} fill={`url(#${id})`} />
        </>
      );
      break;
    case "fadeblack":
    case "fadewhite": {
      const mid = kind === "fadeblack" ? "#000" : "#fff";
      body = (
        <>
          <defs>
            <linearGradient id={id}>
              <stop offset="0.1" stopColor={A} />
              <stop offset="0.45" stopColor={mid} />
              <stop offset="0.55" stopColor={mid} />
              <stop offset="0.9" stopColor={B} />
            </linearGradient>
          </defs>
          <rect width={w} height={h} fill={`url(#${id})`} />
        </>
      );
      break;
    }
    case "wipeleft":
    case "wiperight":
    case "wipeup":
    case "wipedown": {
      const d = kind.slice(4) as "left" | "right" | "up" | "down";
      const rect = { left: [34, 0, 22, h], right: [0, 0, 22, h], up: [0, 19, w, 13], down: [0, 0, w, 13] }[d];
      body = (
        <>
          <rect width={w} height={h} fill={A} />
          <rect x={rect[0]} y={rect[1]} width={rect[2]} height={rect[3]} fill={B} />
          {arrow(({ left: "l", right: "r", up: "u", down: "d" } as const)[d])}
        </>
      );
      break;
    }
    case "slideleft":
    case "slideright":
    case "slideup":
    case "slidedown": {
      const d = kind.slice(5) as "left" | "right" | "up" | "down";
      const [ax, ay, bx, by] = { left: [-22, 0, 34, 0], right: [22, 0, -34, 0], up: [0, -13, 0, 19], down: [0, 13, 0, -19] }[d];
      body = (
        <>
          <rect x={ax} y={ay} width={w} height={h} fill={A} />
          <rect x={bx} y={by} width={w} height={h} fill={B} />
          {arrow(({ left: "l", right: "r", up: "u", down: "d" } as const)[d])}
        </>
      );
      break;
    }
    case "circleopen":
    case "circleclose": {
      const open = kind === "circleopen";
      body = (
        <>
          <rect width={w} height={h} fill={open ? A : B} />
          <circle cx={w / 2} cy={h / 2} r={10} fill={open ? B : A} />
        </>
      );
      break;
    }
  }
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} className="overflow-hidden rounded">
      <clipPath id={`c-${kind}`}>
        <rect width={w} height={h} rx="3" />
      </clipPath>
      <g clipPath={`url(#c-${kind})`}>{body}</g>
    </svg>
  );
}

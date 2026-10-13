/**
 * The transitions between two clips, drawn on the preview's canvas the way
 * ffmpeg's `xfade` draws them in the export (checked against ffmpeg 6.1:
 * which side comes in from where, and the soft edge of the circles).
 */
import type { TransitionKind } from "./project";

export const TRANSITIONS: { kind: TransitionKind; label: string }[] = [
  { kind: "fade", label: "クロスフェード" },
  { kind: "fadeblack", label: "黒を挟む" },
  { kind: "fadewhite", label: "白を挟む" },
  { kind: "wipeleft", label: "ワイプ（左へ）" },
  { kind: "wiperight", label: "ワイプ（右へ）" },
  { kind: "wipeup", label: "ワイプ（上へ）" },
  { kind: "wipedown", label: "ワイプ（下へ）" },
  { kind: "slideleft", label: "スライド（左へ）" },
  { kind: "slideright", label: "スライド（右へ）" },
  { kind: "slideup", label: "スライド（上へ）" },
  { kind: "slidedown", label: "スライド（下へ）" },
  { kind: "circleopen", label: "円で開く" },
  { kind: "circleclose", label: "円で閉じる" },
];

export const transitionLabel = (k: TransitionKind) => TRANSITIONS.find((t) => t.kind === k)?.label ?? k;

const smoothstep = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** Draws one clip's frame into a context of the canvas's size. */
export type DrawLayer = (ctx: CanvasRenderingContext2D) => void;

let layers: [HTMLCanvasElement, HTMLCanvasElement] | null = null;

/** Two scratch canvases of the main one's size, for the masked transitions. */
function scratch(w: number, h: number): [CanvasRenderingContext2D, CanvasRenderingContext2D] {
  if (!layers) layers = [document.createElement("canvas"), document.createElement("canvas")];
  for (const c of layers) {
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
    }
  }
  const ctx = layers.map((c) => {
    const x = c.getContext("2d")!;
    x.setTransform(1, 0, 0, 1, 0, 0);
    x.globalAlpha = 1;
    x.globalCompositeOperation = "source-over";
    x.clearRect(0, 0, w, h);
    return x;
  });
  return [ctx[0], ctx[1]];
}

/**
 * Draws the moment `q` (0..1) of transition `kind` from `a` to `b` onto
 * `ctx` (whose pixel size is `w`×`h`; the layers draw in the same transform
 * as `ctx`).
 */
export function drawTransition(ctx: CanvasRenderingContext2D, kind: TransitionKind, q: number, a: DrawLayer, b: DrawLayer) {
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  const m = ctx.getTransform();
  const clipRect = (x: number, y: number, cw: number, ch: number, draw: DrawLayer) => {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.beginPath();
    ctx.rect(x, y, cw, ch);
    ctx.clip();
    ctx.setTransform(m);
    draw(ctx);
    ctx.restore();
  };
  const shifted = (dx: number, dy: number, draw: DrawLayer) => {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, dx, dy);
    ctx.transform(m.a, m.b, m.c, m.d, m.e, m.f);
    draw(ctx);
    ctx.restore();
  };
  const withAlpha = (alpha: number, draw: DrawLayer) => {
    if (alpha <= 0) return;
    ctx.save();
    ctx.globalAlpha = alpha;
    draw(ctx);
    ctx.restore();
  };

  switch (kind) {
    case "fade":
      a(ctx);
      withAlpha(q, b);
      return;
    case "fadeblack":
    case "fadewhite": {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = kind === "fadeblack" ? "#000" : "#fff";
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
      // Fitted to ffmpeg's curve: the first clip is gone by 20%, the second
      // comes up over the rest.
      withAlpha(q < 0.2 ? (1 - q / 0.2) ** 1.3 : 0, a);
      withAlpha(q > 0.2 ? ((q - 0.2) / 0.8) ** 1.2 : 0, b);
      return;
    }
    case "wipeleft":
      a(ctx);
      clipRect(w * (1 - q), 0, w * q + 1, h, b);
      return;
    case "wiperight":
      a(ctx);
      clipRect(0, 0, w * q, h, b);
      return;
    case "wipeup":
      a(ctx);
      clipRect(0, h * (1 - q), w, h * q + 1, b);
      return;
    case "wipedown":
      a(ctx);
      clipRect(0, 0, w, h * q, b);
      return;
    case "slideleft":
      shifted(-q * w, 0, a);
      shifted((1 - q) * w, 0, b);
      return;
    case "slideright":
      shifted(q * w, 0, a);
      shifted(-(1 - q) * w, 0, b);
      return;
    case "slideup":
      shifted(0, -q * h, a);
      shifted(0, (1 - q) * h, b);
      return;
    case "slidedown":
      shifted(0, q * h, a);
      shifted(0, -(1 - q) * h, b);
      return;
    case "circleopen":
    case "circleclose": {
      // xfade: a soft circle from the centre; the edge is as wide as the
      // half diagonal `z`. `p` runs 1 → 0 over the transition.
      const open = kind === "circleopen";
      const [under, over] = open ? [a, b] : [b, a];
      const [, top] = scratch(w, h);
      top.setTransform(m);
      over(top);
      const z = Math.hypot(w / 2, h / 2);
      const p = (1 - q - 0.5) * 3;
      const g = top.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, z);
      for (let i = 0; i <= 24; i++) {
        const r = i / 24;
        // Share of the layer on top at distance r·z from the centre.
        const alpha = open ? 1 - smoothstep(0, 1, r + p) : smoothstep(0, 1, 1 - r + p);
        g.addColorStop(r, `rgba(0,0,0,${alpha.toFixed(4)})`);
      }
      top.setTransform(1, 0, 0, 1, 0, 0);
      top.globalCompositeOperation = "destination-in";
      top.fillStyle = g;
      top.fillRect(0, 0, w, h);
      under(ctx);
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(top.canvas, 0, 0);
      ctx.restore();
      return;
    }
  }
}

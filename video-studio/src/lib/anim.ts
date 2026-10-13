/**
 * How a text or stamp comes in and goes. The export does the same with
 * ffmpeg expressions (src-tauri/src/render.rs `overlay_exprs`): change both
 * together.
 */
import type { AnimKind, Overlay } from "./project";

export const ANIM_SECONDS = 0.4;

export const ANIMS: { kind: AnimKind; label: string }[] = [
  { kind: "none", label: "なし" },
  { kind: "fade", label: "フェード" },
  { kind: "pop", label: "ポップ" },
  { kind: "rise", label: "下から / 上へ" },
  { kind: "slide", label: "左から / 右へ" },
];

export const animSeconds = (len: number) => Math.min(ANIM_SECONDS, len / 2);

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const easeOut = (k: number) => 1 - (1 - k) ** 3;
const backOut = (k: number) => 1 + 2.70158 * (k - 1) ** 3 + 1.70158 * (k - 1) ** 2;

export interface AnimState {
  alpha: number;
  scale: number;
  /** Offsets in frame pixels. */
  dx: number;
  dy: number;
}

/** The overlay at timeline time `t`, in a frame `width`×`height`. */
export function animState(o: Pick<Overlay, "start" | "end" | "animIn" | "animOut">, t: number, width: number, height: number): AnimState {
  const a = animSeconds(o.end - o.start);
  const kIn = clamp01((t - o.start) / a);
  const kOut = clamp01((o.end - t) / a);
  const s: AnimState = { alpha: 1, scale: 1, dx: 0, dy: 0 };
  // Alpha: a straight line, as ffmpeg's fade filter. Pop fades in a third of the time.
  const fade = (kind: AnimKind, k: number) => (kind === "none" ? 1 : kind === "pop" ? clamp01(k * 3) : k);
  s.alpha = fade(o.animIn, kIn) * fade(o.animOut, kOut);
  if (o.animIn === "pop") s.scale *= Math.max(0, backOut(kIn));
  if (o.animOut === "pop") s.scale *= Math.max(0, backOut(kOut));
  if (o.animIn === "slide") s.dx -= (1 - easeOut(kIn)) * width * 0.15;
  if (o.animOut === "slide") s.dx += (1 - easeOut(kOut)) * width * 0.15;
  if (o.animIn === "rise") s.dy += (1 - easeOut(kIn)) * height * 0.08;
  if (o.animOut === "rise") s.dy -= (1 - easeOut(kOut)) * height * 0.08;
  return s;
}

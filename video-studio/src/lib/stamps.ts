/**
 * Stamps: emoji (drawn by the OS's emoji font, the same in the preview and
 * the export, which both come from this window) and a few shapes for
 * pointing at things, in a colour of one's choice.
 */

export const EMOJI = [
  "😀", "😂", "🥹", "😍", "😎", "🤔", "😱", "😭", "🥳", "😴",
  "👍", "👏", "🙌", "🙏", "💪", "👀", "✨", "🔥", "💯", "❤️",
  "💕", "⭐", "🎉", "🎊", "🎂", "🎁", "🍣", "🍜", "🍺", "☕",
  "📸", "🎵", "📍", "✅", "❌", "⚠️", "❓", "❗", "💡", "💤",
  "🐶", "🐱", "🌸", "☀️", "🌈", "⚡", "🚗", "✈️", "🏠", "🎯",
];

export interface Shape {
  id: string;
  label: string;
  /** Width / height of the shape. */
  aspect: number;
  /** Draws into a box centred on 0,0 of height `s`. */
  draw: (ctx: CanvasRenderingContext2D, s: number, color: string) => void;
}

const stroke = (ctx: CanvasRenderingContext2D, s: number, color: string) => {
  ctx.strokeStyle = color;
  ctx.lineWidth = s * 0.09;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  // A dark edge, so it reads on any picture.
  ctx.shadowColor = "rgba(0,0,0,0.45)";
  ctx.shadowBlur = s * 0.04;
  ctx.stroke();
};

const fill = (ctx: CanvasRenderingContext2D, s: number, color: string) => {
  ctx.fillStyle = color;
  ctx.shadowColor = "rgba(0,0,0,0.45)";
  ctx.shadowBlur = s * 0.04;
  ctx.fill();
};

export const SHAPES: Shape[] = [
  {
    id: "arrow",
    label: "矢印",
    aspect: 1.6,
    draw(ctx, s, color) {
      const w = s * 1.6;
      ctx.beginPath();
      ctx.moveTo(-w / 2, -s * 0.16);
      ctx.lineTo(w * 0.12, -s * 0.16);
      ctx.lineTo(w * 0.12, -s * 0.42);
      ctx.lineTo(w / 2, 0);
      ctx.lineTo(w * 0.12, s * 0.42);
      ctx.lineTo(w * 0.12, s * 0.16);
      ctx.lineTo(-w / 2, s * 0.16);
      ctx.closePath();
      fill(ctx, s, color);
    },
  },
  {
    id: "ring",
    label: "丸で囲む",
    aspect: 1,
    draw(ctx, s, color) {
      ctx.beginPath();
      ctx.arc(0, 0, s * 0.44, 0, Math.PI * 2);
      stroke(ctx, s, color);
    },
  },
  {
    id: "frame",
    label: "四角で囲む",
    aspect: 1.6,
    draw(ctx, s, color) {
      const w = s * 1.6 * 0.9;
      const h = s * 0.9;
      ctx.beginPath();
      ctx.roundRect(-w / 2, -h / 2, w, h, s * 0.08);
      stroke(ctx, s, color);
    },
  },
  {
    id: "bubble",
    label: "吹き出し",
    aspect: 1.4,
    draw(ctx, s, color) {
      const w = s * 1.4 * 0.94;
      const h = s * 0.72;
      ctx.beginPath();
      ctx.ellipse(0, -s * 0.1, w / 2, h / 2, 0, 0, Math.PI * 2);
      ctx.moveTo(-w * 0.18, s * 0.18);
      ctx.lineTo(-w * 0.32, s * 0.47);
      ctx.lineTo(w * 0.02, s * 0.22);
      fill(ctx, s, color);
    },
  },
  {
    id: "star",
    label: "星",
    aspect: 1,
    draw(ctx, s, color) {
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const r = i % 2 ? s * 0.2 : s * 0.47;
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r + s * 0.03);
      }
      ctx.closePath();
      fill(ctx, s, color);
    },
  },
  {
    id: "heart",
    label: "ハート",
    aspect: 1,
    draw(ctx, s, color) {
      const k = s / 2.2;
      ctx.beginPath();
      ctx.moveTo(0, k * 0.85);
      ctx.bezierCurveTo(-k * 1.9, -k * 0.2, -k * 0.9, -k * 1.35, 0, -k * 0.55);
      ctx.bezierCurveTo(k * 0.9, -k * 1.35, k * 1.9, -k * 0.2, 0, k * 0.85);
      fill(ctx, s, color);
    },
  },
  {
    id: "check",
    label: "チェック",
    aspect: 1,
    draw(ctx, s, color) {
      ctx.beginPath();
      ctx.moveTo(-s * 0.34, 0);
      ctx.lineTo(-s * 0.1, s * 0.26);
      ctx.lineTo(s * 0.36, -s * 0.28);
      stroke(ctx, s * 1.4, color);
    },
  },
  {
    id: "cross",
    label: "バツ",
    aspect: 1,
    draw(ctx, s, color) {
      ctx.beginPath();
      ctx.moveTo(-s * 0.3, -s * 0.3);
      ctx.lineTo(s * 0.3, s * 0.3);
      ctx.moveTo(s * 0.3, -s * 0.3);
      ctx.lineTo(-s * 0.3, s * 0.3);
      stroke(ctx, s * 1.4, color);
    },
  },
];

export const shapeOf = (stamp: string) => (stamp.startsWith("shape:") ? SHAPES.find((s) => `shape:${s.id}` === stamp) : undefined);

/** Stamp colours offered for shapes. */
export const STAMP_COLORS = ["#ff4d4d", "#ffd23f", "#3ec27f", "#4c8dff", "#ffffff", "#111111"];

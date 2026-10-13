/**
 * A text or stamp drawn to its own canvas, at its size and rotation but
 * without its animation. The preview draws these bitmaps animated
 * (src/lib/player.ts); the export sends the same bitmaps as PNGs and ffmpeg
 * animates them (src/lib/exportJob.ts), so both look alike.
 */
import type { FontId, Overlay } from "./project";
import { shapeOf } from "./stamps";

export const FONTS: { id: FontId; label: string; family: string }[] = [
  {
    id: "gothic",
    label: "ゴシック",
    family: '"Hiragino Sans", "Hiragino Kaku Gothic ProN", "Yu Gothic", YuGothic, Meiryo, sans-serif',
  },
  { id: "mincho", label: "明朝", family: '"Hiragino Mincho ProN", "Yu Mincho", YuMincho, serif' },
  {
    id: "rounded",
    label: "やわらか",
    family: '"Hiragino Maru Gothic ProN", "UD デジタル 教科書体 NK-R", "UD Digi Kyokasho NK-R", "BIZ UDPGothic", sans-serif',
  },
];

const EMOJI_FONT = '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';

/** Base sizes at a frame 1080 tall (short side). */
const EMOJI_SIZE = 180;
const SHAPE_SIZE = 260;

export interface OverlayBitmap {
  /** Rotated, with room for the rotation. Centre = the overlay's centre. */
  canvas: HTMLCanvasElement;
  /** Unrotated size in frame pixels (for the selection box). */
  w: number;
  h: number;
}

/** Frame pixels per "pixel at 1080". */
export const unit = (width: number, height: number) => Math.min(width, height) / 1080;

type Draw = { w: number; h: number; paint: (ctx: CanvasRenderingContext2D) => void };

function textDraw(o: Overlay, px: number, measure: CanvasRenderingContext2D): Draw {
  const st = o.style;
  const family = FONTS.find((f) => f.id === st.font)?.family ?? FONTS[0].family;
  const font = `${st.bold ? 700 : 400} ${px}px ${family}`;
  measure.font = font;
  const lines = (o.text || " ").split("\n");
  const widths = lines.map((l) => measure.measureText(l).width);
  const lineH = px * 1.3;
  const edge = st.outline ? px * 0.18 : 0;
  const padX = st.box ? px * 0.45 : 0;
  const padY = st.box ? px * 0.22 : 0;
  const w = Math.max(...widths, px * 0.3) + edge + padX * 2;
  const h = lines.length * lineH + edge + padY * 2;
  return {
    w,
    h,
    paint(ctx) {
      if (st.box) {
        ctx.fillStyle = st.box;
        ctx.beginPath();
        ctx.roundRect(-w / 2, -h / 2, w, h, px * 0.22);
        ctx.fill();
      }
      ctx.font = font;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.lineJoin = "round";
      lines.forEach((line, i) => {
        const y = (i - (lines.length - 1) / 2) * lineH;
        if (st.outline) {
          ctx.strokeStyle = st.outline;
          ctx.lineWidth = edge;
          ctx.strokeText(line, 0, y);
        }
        ctx.fillStyle = st.color;
        ctx.fillText(line, 0, y);
      });
    },
  };
}

function stampDraw(o: Overlay, u: number): Draw {
  const shape = shapeOf(o.stamp);
  if (shape) {
    const s = SHAPE_SIZE * u * o.scale;
    // Room for the stroke's shadow.
    return { w: s * shape.aspect * 1.08, h: s * 1.08, paint: (ctx) => shape.draw(ctx, s, o.color) };
  }
  const px = EMOJI_SIZE * u * o.scale;
  return {
    w: px * 1.25,
    h: px * 1.25,
    paint(ctx) {
      ctx.font = `${px}px ${EMOJI_FONT}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(o.stamp, 0, px * 0.04);
    },
  };
}

let measureCtx: CanvasRenderingContext2D | null = null;

/** `ratio`: canvas pixels per frame pixel (the preview draws smaller). */
export function renderOverlay(o: Overlay, width: number, height: number, ratio: number): OverlayBitmap {
  measureCtx ??= document.createElement("canvas").getContext("2d")!;
  const u = unit(width, height) * ratio;
  const d = o.kind === "text" ? textDraw(o, o.style.size * u * o.scale, measureCtx) : stampDraw(o, u);
  const rad = (o.rotation * Math.PI) / 180;
  const bw = Math.abs(d.w * Math.cos(rad)) + Math.abs(d.h * Math.sin(rad));
  const bh = Math.abs(d.w * Math.sin(rad)) + Math.abs(d.h * Math.cos(rad));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.ceil(bw) + 2);
  canvas.height = Math.max(1, Math.ceil(bh) + 2);
  const ctx = canvas.getContext("2d")!;
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate(rad);
  d.paint(ctx);
  return { canvas, w: d.w / ratio, h: d.h / ratio };
}

/** What changes the bitmap; time and place don't. */
const keyOf = (o: Overlay, w: number, h: number, ratio: number) =>
  JSON.stringify([o.kind, o.text, o.style, o.stamp, o.color, o.scale, o.rotation, w, h, Math.round(ratio * 1000)]);

const cache = new Map<string, OverlayBitmap>();

/** renderOverlay, kept for the next frames. */
export function overlayBitmap(o: Overlay, width: number, height: number, ratio: number): OverlayBitmap {
  const key = keyOf(o, width, height, ratio);
  let b = cache.get(key);
  if (b) {
    cache.delete(key);
  } else {
    b = renderOverlay(o, width, height, ratio);
    if (cache.size > 80) cache.delete(cache.keys().next().value!);
  }
  cache.set(key, b);
  return b;
}

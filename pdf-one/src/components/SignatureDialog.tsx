import { Eraser } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { placePicture } from "../lib/actions";
import { api } from "../lib/api";
import type { Point } from "../lib/geometry";
import { useStore } from "../store";
import { Modal } from "./Modal";

const st = () => useStore.getState();

/** The drawing area in CSS pixels. */
const W = 520;
const H = 180;
const LINE = 2.5;

function drawStrokes(ctx: CanvasRenderingContext2D, strokes: Point[][], scale: number, offset: Point, width: number) {
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = "#111111";
  ctx.lineWidth = width * scale;
  for (const s of strokes) {
    if (!s.length) continue;
    ctx.beginPath();
    ctx.moveTo((s[0][0] - offset[0]) * scale, (s[0][1] - offset[1]) * scale);
    if (s.length === 1) ctx.lineTo((s[0][0] - offset[0]) * scale + 0.1, (s[0][1] - offset[1]) * scale);
    for (const [x, y] of s.slice(1)) ctx.lineTo((x - offset[0]) * scale, (y - offset[1]) * scale);
    ctx.stroke();
  }
}

/**
 * 手書きの署名を作る (docs/UX.md §5): draw with the mouse or a pen, keep
 * it in the stamp library as a transparent PNG, and put it on the page.
 */
export function SignatureDialog() {
  const close = () => st().openDialog(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [strokes, setStrokes] = useState<Point[][]>([]);
  const drawing = useRef(false);
  const [busy, setBusy] = useState(false);

  // Drawn again whenever the strokes change (sharp on high-DPI screens).
  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const ratio = window.devicePixelRatio || 1;
    c.width = W * ratio;
    c.height = H * ratio;
    const ctx = c.getContext("2d")!;
    ctx.clearRect(0, 0, c.width, c.height);
    // A line to write on, like a form's.
    ctx.strokeStyle = "rgba(128,128,128,.5)";
    ctx.lineWidth = ratio;
    ctx.setLineDash([4 * ratio, 4 * ratio]);
    ctx.beginPath();
    ctx.moveTo(24 * ratio, H * 0.72 * ratio);
    ctx.lineTo((W - 24) * ratio, H * 0.72 * ratio);
    ctx.stroke();
    ctx.setLineDash([]);
    drawStrokes(ctx, strokes, ratio, [0, 0], LINE);
  }, [strokes]);

  const local = (e: React.PointerEvent): Point => {
    const r = canvas.current!.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * W, ((e.clientY - r.top) / r.height) * H];
  };

  const save = async () => {
    const pts = strokes.flat();
    if (!pts.length) return;
    setBusy(true);
    try {
      const pad = 8;
      const x1 = Math.min(...pts.map((p) => p[0])) - pad;
      const y1 = Math.min(...pts.map((p) => p[1])) - pad;
      const x2 = Math.max(...pts.map((p) => p[0])) + pad;
      const y2 = Math.max(...pts.map((p) => p[1])) + pad;
      // Twice the screen size, so it stays crisp when placed large.
      const scale = 2;
      const out = document.createElement("canvas");
      out.width = Math.ceil((x2 - x1) * scale);
      out.height = Math.ceil((y2 - y1) * scale);
      drawStrokes(out.getContext("2d")!, strokes, scale, [x1, y1], LINE);
      const blob = await new Promise<Blob | null>((r) => out.toBlob(r, "image/png"));
      if (!blob) throw new Error("画像を作れませんでした");
      const stamp = await api.addStampBytes(new Uint8Array(await blob.arrayBuffer()));
      const img = await api.useStamp(stamp.id);
      placePicture(img);
      st().notify({ title: "署名をライブラリに入れました", detail: "次からは「印鑑・画像」から置けます。", kind: "success" });
    } catch (e) {
      st().toast(String((e as Error)?.message ?? e), true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="手書きの署名を作る" onClose={close} width={W + 48}>
      <p className="mb-3 text-xs leading-relaxed text-dim">
        下の枠に、マウスかペンで名前を書いてください。書いたものはライブラリに入り、どの PDF にも置けます。
      </p>
      <canvas
        ref={canvas}
        style={{ width: W, height: H, touchAction: "none" }}
        className="block cursor-crosshair rounded-lg border border-line bg-white"
        aria-label="署名を書くところ"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          drawing.current = true;
          setStrokes((s) => [...s, [local(e)]]);
        }}
        onPointerMove={(e) => {
          if (!drawing.current) return;
          const p = local(e);
          setStrokes((s) => [...s.slice(0, -1), [...s[s.length - 1], p]]);
        }}
        onPointerUp={() => (drawing.current = false)}
        onPointerCancel={() => (drawing.current = false)}
      />
      <div className="mt-4 flex items-center gap-2">
        <button
          onClick={() => setStrokes([])}
          disabled={!strokes.length}
          className="flex items-center gap-1.5 rounded-md bg-raised px-3 py-1.5 hover:bg-hover disabled:opacity-40"
        >
          <Eraser size={14} />
          書き直す
        </button>
        <div className="flex-1" />
        <button onClick={close} className="rounded-md px-3 py-1.5 hover:bg-hover">
          キャンセル
        </button>
        <button
          onClick={() => void save()}
          disabled={!strokes.length || busy}
          className="rounded-md bg-accent px-4 py-1.5 text-white hover:brightness-110 disabled:opacity-50"
        >
          ライブラリに入れて置く
        </button>
      </div>
    </Modal>
  );
}

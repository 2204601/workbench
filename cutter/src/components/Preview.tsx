import { Pause, Play, RotateCw, SkipBack, SkipForward, StepBack, StepForward } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { stepFrames } from "../lib/actions";
import { timecode } from "../lib/format";
import { overlayBitmap } from "../lib/overlayRender";
import { attachCanvas, currentLayout, seek, togglePlay } from "../lib/player";
import type { Overlay } from "../lib/project";
import { layout, updateOverlay } from "../lib/timeline";
import { useStore } from "../store";

const st = () => useStore.getState();

/** The fitted size of the frame in the area. */
function useFit(area: React.RefObject<HTMLDivElement | null>, aspect: number) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    const update = () => {
      const r = el.getBoundingClientRect();
      const pad = 24;
      const aw = Math.max(0, r.width - pad * 2);
      const ah = Math.max(0, r.height - pad * 2);
      const w = Math.min(aw, ah * aspect);
      setSize({ w: Math.floor(w), h: Math.floor(w / aspect) });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [area, aspect]);
  return size;
}

/** The topmost overlay showing at `t` under frame point (fx, fy). */
function hitOverlay(p: { width: number; height: number; overlays: Overlay[] }, t: number, fx: number, fy: number, ratio: number): Overlay | null {
  for (let i = p.overlays.length - 1; i >= 0; i--) {
    const o = p.overlays[i];
    if (t < o.start || t >= o.end) continue;
    const b = overlayBitmap(o, p.width, p.height, ratio);
    const rad = (-o.rotation * Math.PI) / 180;
    const dx = fx - o.x * p.width;
    const dy = fy - o.y * p.height;
    const lx = dx * Math.cos(rad) - dy * Math.sin(rad);
    const ly = dx * Math.sin(rad) + dy * Math.cos(rad);
    if (Math.abs(lx) <= b.w / 2 && Math.abs(ly) <= b.h / 2) return o;
  }
  return null;
}

/** Drags with pointer capture: `move` gets the pointer, `done` once at the end. */
function drag(e: React.PointerEvent, move: (ev: PointerEvent) => void, done?: () => void) {
  e.preventDefault();
  e.stopPropagation();
  const target = e.currentTarget as HTMLElement;
  target.setPointerCapture(e.pointerId);
  st().beginLive();
  const onMove = (ev: PointerEvent) => move(ev);
  const onUp = () => {
    target.removeEventListener("pointermove", onMove);
    target.removeEventListener("pointerup", onUp);
    target.removeEventListener("pointercancel", onUp);
    st().endLive();
    done?.();
  };
  target.addEventListener("pointermove", onMove);
  target.addEventListener("pointerup", onUp);
  target.addEventListener("pointercancel", onUp);
}

/** The picked overlay's box on the preview: drag to move, corner to resize, knob to turn. */
function OverlayBox({ o, scale, guides }: { o: Overlay; scale: number; guides: (g: { x: boolean; y: boolean }) => void }) {
  const p = useStore((s) => s.project);
  const b = overlayBitmap(o, p.width, p.height, scale);
  const w = b.w * scale;
  const h = b.h * scale;
  const cx = o.x * p.width * scale;
  const cy = o.y * p.height * scale;

  const centre = (el: HTMLElement) => {
    const r = el.closest("[data-frame]")!.getBoundingClientRect();
    return { x: r.left + cx, y: r.top + cy };
  };

  const onMove = (e: React.PointerEvent) => {
    const x0 = e.clientX;
    const y0 = e.clientY;
    const base = st().project;
    drag(
      e,
      (ev) => {
        let x = o.x + (ev.clientX - x0) / scale / p.width;
        let y = o.y + (ev.clientY - y0) / scale / p.height;
        // Snaps to the middle lines, which show while it does.
        const sx = Math.abs(x - 0.5) < 0.012;
        const sy = Math.abs(y - 0.5) < 0.012;
        if (sx) x = 0.5;
        if (sy) y = 0.5;
        guides({ x: sx, y: sy });
        st().live(updateOverlay(base, o.id, { x: Math.min(1.2, Math.max(-0.2, x)), y: Math.min(1.2, Math.max(-0.2, y)) }));
      },
      () => guides({ x: false, y: false }),
    );
  };

  const onScale = (e: React.PointerEvent) => {
    const c = centre(e.currentTarget as HTMLElement);
    const d0 = Math.hypot(e.clientX - c.x, e.clientY - c.y) || 1;
    const base = st().project;
    drag(e, (ev) => {
      const d = Math.hypot(ev.clientX - c.x, ev.clientY - c.y);
      const s = Math.min(8, Math.max(0.1, (o.scale * d) / d0));
      st().live(updateOverlay(base, o.id, { scale: Math.round(s * 100) / 100 }));
    });
  };

  const onRotate = (e: React.PointerEvent) => {
    const c = centre(e.currentTarget as HTMLElement);
    const base = st().project;
    drag(e, (ev) => {
      let deg = (Math.atan2(ev.clientY - c.y, ev.clientX - c.x) * 180) / Math.PI + 90;
      if (ev.shiftKey) deg = Math.round(deg / 15) * 15;
      // Upright and the quarter turns catch.
      const near = Math.round(deg / 90) * 90;
      if (Math.abs(deg - near) < 4) deg = near;
      deg = ((((deg + 180) % 360) + 360) % 360) - 180;
      st().live(updateOverlay(base, o.id, { rotation: Math.round(deg) }));
    });
  };

  return (
    <div
      className="absolute cursor-move border border-accent"
      style={{ left: cx - w / 2, top: cy - h / 2, width: w, height: h, transform: `rotate(${o.rotation}deg)` }}
      onPointerDown={onMove}
      onDoubleClick={() => document.querySelector<HTMLTextAreaElement>("[data-overlay-text]")?.select()}
    >
      <div className="absolute -top-7 left-1/2 h-6 w-px -translate-x-1/2 bg-accent" />
      <button
        className="absolute -top-10 left-1/2 flex h-5 w-5 -translate-x-1/2 cursor-grab items-center justify-center rounded-full border border-accent bg-panel text-accent"
        onPointerDown={onRotate}
        title="回す（Shift で 15° ずつ）"
      >
        <RotateCw size={11} />
      </button>
      <div
        className="absolute -right-1.5 -bottom-1.5 h-3 w-3 cursor-nwse-resize rounded-sm border border-accent bg-fg"
        onPointerDown={onScale}
        title="大きさ"
      />
    </div>
  );
}

function Transport() {
  const time = useStore((s) => s.time);
  const playing = useStore((s) => s.playing);
  const duration = useStore((s) => layout(s.project).duration);
  const btn = "rounded-md p-1.5 text-dim hover:bg-white/10 hover:text-fg";
  return (
    <div className="flex h-11 shrink-0 items-center justify-center gap-1 border-t border-line">
      <button className={btn} onClick={() => seek(0)} title="先頭へ（Home）">
        <SkipBack size={16} />
      </button>
      <button className={btn} onClick={() => stepFrames(-1)} title="1 コマ戻る（←）">
        <StepBack size={16} />
      </button>
      <button
        className="mx-1 flex h-8 w-8 items-center justify-center rounded-full bg-fg text-bg hover:brightness-90"
        onClick={() => togglePlay()}
        title="再生 / 一時停止（スペース）"
      >
        {playing ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" className="ml-0.5" />}
      </button>
      <button className={btn} onClick={() => stepFrames(1)} title="1 コマ進む（→）">
        <StepForward size={16} />
      </button>
      <button className={btn} onClick={() => seek(currentLayout().duration)} title="最後へ（End）">
        <SkipForward size={16} />
      </button>
      <span className="ml-3 w-36 text-xs tabular-nums">
        {timecode(time)} <span className="text-dim">/ {timecode(duration)}</span>
      </span>
    </div>
  );
}

export function Preview() {
  const area = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const p = useStore((s) => s.project);
  const time = useStore((s) => s.time);
  const selection = useStore((s) => s.selection);
  const empty = p.clips.length === 0;
  const { w, h } = useFit(area, p.width / p.height);
  const [guides, setGuides] = useState({ x: false, y: false });
  const scale = w / p.width;

  useEffect(() => {
    const c = canvas.current;
    if (!c || !w) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.min(p.width, Math.round(w * dpr));
    c.height = Math.round((c.width * p.height) / p.width);
    attachCanvas(c);
    return () => attachCanvas(null);
  }, [w, h, p.width, p.height, empty]);

  const picked = selection?.kind === "overlay" ? p.overlays.find((o) => o.id === selection.id) : undefined;
  const pickedShown = picked && time >= picked.start && time < picked.end;

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const fx = (e.clientX - r.left) / scale;
    const fy = (e.clientY - r.top) / scale;
    const hit = hitOverlay(p, time, fx, fy, scale);
    if (hit) {
      st().select({ kind: "overlay", id: hit.id });
      // Straight into moving it.
      const x0 = e.clientX;
      const y0 = e.clientY;
      const base = st().project;
      drag(e, (ev) => {
        const x = hit.x + (ev.clientX - x0) / scale / p.width;
        const y = hit.y + (ev.clientY - y0) / scale / p.height;
        st().live(updateOverlay(base, hit.id, { x, y }));
      });
    } else {
      st().select(null);
    }
  };

  return (
    <div className="flex min-w-0 flex-1 flex-col bg-bg">
      <div ref={area} className="relative flex min-h-0 flex-1 items-center justify-center">
        {empty ? (
          <div className="text-center text-dim">
            <div className="mb-1 text-sm">動画や写真をドロップして始めましょう</div>
            <div className="text-xs">左の「動画・写真を追加」からも選べます</div>
          </div>
        ) : (
          <div data-frame className="relative bg-black shadow-xl shadow-black/40" style={{ width: w, height: h }} onPointerDown={onPointerDown}>
            <canvas ref={canvas} className="block h-full w-full" />
            {guides.x && <div className="pointer-events-none absolute inset-y-0 left-1/2 w-px bg-warn/80" />}
            {guides.y && <div className="pointer-events-none absolute inset-x-0 top-1/2 h-px bg-warn/80" />}
            {picked && pickedShown && <OverlayBox o={picked} scale={scale} guides={setGuides} />}
          </div>
        )}
      </div>
      <Transport />
    </div>
  );
}

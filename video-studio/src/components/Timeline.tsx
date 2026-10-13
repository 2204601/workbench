import { Copy, Image as ImageIcon, Maximize2, Scissors, Trash2, VolumeX, ZoomIn, ZoomOut } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { addMediaToTimeline } from "../lib/actions";
import { fileUrl } from "../lib/api";
import { fitTimeline, setTimelineWidth } from "../lib/commands";
import { seconds, timecode } from "../lib/format";
import { seek } from "../lib/player";
import { openSource, showTimeline } from "../lib/sourcePlayer";
import type { Clip, Media, Overlay } from "../lib/project";
import { shapeOf } from "../lib/stamps";
import {
  insertIndexAt,
  lanes,
  layout,
  moveClip,
  snap,
  snapPoints,
  trimClip,
  updateOverlay,
  type Layout,
  type Placed,
} from "../lib/timeline";
import { transitionLabel } from "../lib/transitions";
import { useStore, type MediaInfo } from "../store";
import { CommandButton } from "./Toolbar";

const st = () => useStore.getState();

/** Room left of 0 s. */
const PAD = 16;
const RULER_H = 24;
const VIDEO_H = 76;
const LANE_H = 26;
const MIN_LANES = 2;
/** Clips and texts dragged closer than this (pixels) catch on edges and the playhead. */
const SNAP_PX = 8;

const tx = (t: number, zoom: number) => PAD + t * zoom;

/** Where each clip's block starts and ends: transitions are split between the two. */
function visual(l: Layout, i: number) {
  const it = l.items[i];
  const next = l.items[i + 1];
  return { from: it.start + it.transition / 2, to: it.start + it.duration - (next ? next.transition / 2 : 0) };
}

/** Pointer drags on the timeline: move after a few pixels; a click otherwise. */
function pointerDrag(
  e: React.PointerEvent,
  opts: { move: (dx: number, ev: PointerEvent) => void; start?: () => void; end?: (moved: boolean, ev: PointerEvent) => void; threshold?: number },
) {
  if (e.button !== 0) return;
  e.stopPropagation();
  const x0 = e.clientX;
  const y0 = e.clientY;
  const threshold = opts.threshold ?? 4;
  let moved = false;
  const onMove = (ev: PointerEvent) => {
    if (!moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) < threshold) return;
    if (!moved) {
      moved = true;
      opts.start?.();
    }
    opts.move(ev.clientX - x0, ev);
  };
  const onUp = (ev: PointerEvent) => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    opts.end?.(moved, ev);
  };
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
}

/** Tick spacing: the first step at least 70 px apart. */
function tickStep(zoom: number) {
  const steps = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
  return steps.find((s) => s * zoom >= 70) ?? 600;
}

function Ruler({ zoom, view, duration }: { zoom: number; view: { left: number; width: number }; duration: number }) {
  const step = tickStep(zoom);
  const first = Math.max(0, Math.floor((view.left - PAD) / zoom / step) * step);
  const last = (view.left + view.width) / zoom;
  const ticks: number[] = [];
  for (let t = first; t <= last && ticks.length < 400; t += step) ticks.push(Math.round(t * 1000) / 1000);
  const onDown = (e: React.PointerEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const at = (x: number) => (x - r.left - PAD) / zoom;
    seek(at(e.clientX));
    pointerDrag(e, { threshold: 0, move: (_, ev) => seek(at(ev.clientX)) });
  };
  return (
    <div className="relative cursor-text border-b border-line" style={{ height: RULER_H }} onPointerDown={onDown}>
      {/* The part after the end is dimmer. */}
      <div className="absolute inset-y-0 bg-white/[0.03]" style={{ left: tx(0, zoom), width: duration * zoom }} />
      {ticks.map((t) => (
        <div key={t} className="absolute top-0 h-full" style={{ left: tx(t, zoom) }}>
          <div className="h-2 w-px bg-dim/60" />
          <span className="absolute top-2 left-1 text-[10px] whitespace-nowrap text-dim tabular-nums">
            {timecode(t, step < 1)}
          </span>
          <div className="absolute top-0 h-1.5 w-px bg-dim/30" style={{ left: (step * zoom) / 2 }} />
        </div>
      ))}
    </div>
  );
}

/** Thumbnails along a clip, only those in view. */
function Filmstrip({ it, m, info, from, zoom, width, view, left }: {
  it: Placed;
  m: Media;
  info: MediaInfo | undefined;
  from: number;
  zoom: number;
  width: number;
  view: { left: number; width: number };
  left: number;
}) {
  const h = VIDEO_H - 2;
  const thumbs = info?.prepared?.thumbs;
  const tileW = m.kind === "image" ? (h * m.width) / Math.max(1, m.height) : thumbs ? (h * thumbs.width) / thumbs.height : 0;
  if (!tileW) return null;
  const firstK = Math.max(0, Math.floor((view.left - left) / tileW));
  const lastK = Math.min(Math.ceil(width / tileW), Math.ceil((view.left + view.width - left) / tileW));
  const tiles = [];
  for (let k = firstK; k < lastK && tiles.length < 200; k++) {
    const x = k * tileW;
    if (m.kind === "image") {
      tiles.push(
        <img key={k} src={fileUrl(m.path)} alt="" draggable={false} className="absolute top-0 object-cover" style={{ left: x, width: tileW, height: h }} />,
      );
      continue;
    }
    const s = it.clip.start + (from - it.start) + (x + tileW / 2) / zoom;
    const idx = Math.min(thumbs!.count - 1, Math.max(0, Math.floor(s / thumbs!.step)));
    tiles.push(
      <div
        key={k}
        className="filmstrip absolute top-0"
        style={{
          left: x,
          width: tileW,
          height: h,
          backgroundImage: `url("${fileUrl(thumbs!.path)}")`,
          backgroundSize: `${thumbs!.count * tileW}px ${h}px`,
          backgroundPosition: `${-idx * tileW}px 0`,
        }}
      />,
    );
  }
  return <>{tiles}</>;
}

function ClipBlock({ it, l, zoom, view, onMoveStart }: {
  it: Placed;
  l: Layout;
  zoom: number;
  view: { left: number; width: number };
  onMoveStart: (e: React.PointerEvent, it: Placed) => void;
}) {
  const m = useStore((s) => s.project.media.find((x) => x.id === it.clip.mediaId));
  const info = useStore((s) => s.media[it.clip.mediaId]);
  const selected = useStore((s) => s.selection?.kind === "clip" && s.selection.id === it.clip.id);
  const { from, to } = visual(l, it.index);
  const left = tx(from, zoom);
  const width = Math.max(4, (to - from) * zoom - 2);
  if (!m) return null;
  const wave = info?.prepared?.wave;

  const trim = (edge: "start" | "end") => (e: React.PointerEvent) => {
    const base = st().project;
    st().select({ kind: "clip", id: it.clip.id });
    pointerDrag(e, {
      threshold: 0,
      start: () => st().beginLive(),
      move: (dx) => {
        const next = trimClip(base, it.clip.id, edge, dx / zoom);
        st().live(next);
        // The preview shows the frame at the new edge.
        const p = layout(next).items[it.index];
        seek(edge === "start" ? p.start + p.transition : p.start + p.duration - 1 / next.fps);
      },
      end: () => st().endLive(),
    });
  };

  return (
    <div
      className={`group absolute overflow-hidden rounded-md border bg-[#2e3a52] ${selected ? "z-10 border-fg ring-2 ring-accent" : "border-[#4a5a7a]"}`}
      style={{ left, width, top: RULER_H + 1, height: VIDEO_H - 2 }}
      onPointerDown={(e) => onMoveStart(e, it)}
      // The file this came from, with this part marked: to take a part next to it.
      onDoubleClick={() => m.kind === "video" && openSource(m.id, { in: it.clip.start, out: it.clip.end })}
      title={`${m.name}\n${seconds(it.duration)}（${timecode(it.clip.start)} 〜 ${timecode(it.clip.end)}）${m.kind === "video" ? "\nダブルクリックで素材を開く" : ""}`}
    >
      <Filmstrip it={it} m={m} info={info} from={from} zoom={zoom} width={width} view={view} left={left} />
      {wave && it.clip.volume > 0 && (
        <div
          className="absolute inset-x-0 bottom-0 h-5 bg-black/45"
          style={{
            backgroundImage: `url("${fileUrl(wave)}")`,
            backgroundSize: `${m.duration * zoom}px 100%`,
            backgroundPositionX: `${-(it.clip.start + (from - it.start)) * zoom}px`,
            backgroundRepeat: "no-repeat",
            opacity: 0.4 + 0.6 * Math.min(1, it.clip.volume),
          }}
        />
      )}
      <div className="absolute top-0 left-0 flex max-w-full items-center gap-1 rounded-br bg-black/55 px-1.5 py-0.5 text-[10px]">
        {m.kind === "image" && <ImageIcon size={10} className="shrink-0" />}
        {it.clip.volume === 0 && <VolumeX size={10} className="shrink-0" />}
        <span className="truncate">{m.name}</span>
        <span className="shrink-0 text-dim tabular-nums">{seconds(it.duration)}</span>
      </div>
      <div className="absolute inset-y-0 left-0 w-2 cursor-ew-resize hover:bg-fg/40 group-hover:bg-fg/20" onPointerDown={trim("start")} />
      <div className="absolute inset-y-0 right-0 w-2 cursor-ew-resize hover:bg-fg/40 group-hover:bg-fg/20" onPointerDown={trim("end")} />
    </div>
  );
}

/** The ◇ between two clips: the transition there, or a place for one. */
function Junction({ it, zoom }: { it: Placed; zoom: number }) {
  const selected = useStore((s) => s.selection?.kind === "transition" && s.selection.id === it.clip.id);
  const t = it.clip.transition;
  const has = t && it.transition > 0;
  const x = tx(it.start + it.transition / 2, zoom);
  return (
    <>
      {has && (
        <div
          className="pointer-events-none absolute z-20 rounded-sm bg-[repeating-linear-gradient(135deg,rgba(255,255,255,0.18)_0_4px,transparent_4px_8px)]"
          style={{ left: tx(it.start, zoom), width: it.transition * zoom, top: RULER_H + 1, height: VIDEO_H - 2 }}
        />
      )}
      <button
        className={`absolute z-30 flex h-5 w-5 -translate-x-1/2 -translate-y-1/2 rotate-45 items-center justify-center rounded-[3px] border ${
          has ? "border-fg bg-accent" : "border-dim/70 bg-panel opacity-70 hover:opacity-100"
        } ${selected ? "ring-2 ring-fg" : ""}`}
        style={{ left: x, top: RULER_H + VIDEO_H / 2 }}
        title={has ? `${transitionLabel(t!.kind)}（${seconds(it.transition)}）` : "切り替えを入れる"}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => {
          st().select({ kind: "transition", id: it.clip.id });
          st().setLeftTab("transition");
        }}
      />
    </>
  );
}

function OverlayItem({ o, lane, zoom, l, timeAt }: {
  o: Overlay;
  lane: number;
  zoom: number;
  l: Layout;
  /** Timeline seconds under a pointer's clientX. */
  timeAt: (clientX: number) => number;
}) {
  const selected = useStore((s) => s.selection?.kind === "overlay" && s.selection.id === o.id);
  const top = RULER_H + VIDEO_H + 6 + lane * LANE_H;
  const left = tx(o.start, zoom);
  const width = Math.max(6, (o.end - o.start) * zoom);
  const isText = o.kind === "text";

  const dragWith = (apply: (dt: number, ev: PointerEvent) => Partial<Overlay>) => (e: React.PointerEvent) => {
    const base = st().project;
    st().select({ kind: "overlay", id: o.id });
    pointerDrag(e, {
      start: () => st().beginLive(),
      move: (dx, ev) => st().live(updateOverlay(base, o.id, apply(dx / zoom, ev))),
      end: (moved, ev) => {
        if (moved) st().endLive();
        // A click: the playhead goes where it was clicked.
        else seek(timeAt(ev.clientX));
      },
    });
  };
  const points = () => snapPoints(st().project, l, st().time, o.id);
  const tol = SNAP_PX / zoom;
  const len = o.end - o.start;

  const onMove = dragWith((dt) => {
    const start = Math.max(0, o.start + dt);
    const pts = points();
    // Either end may catch; the nearer catch wins.
    const a = snap(start, pts, tol);
    const b = snap(start + len, pts, tol) - len;
    const da = a !== start ? Math.abs(a - start) : Infinity;
    const db = b !== start ? Math.abs(b - start) : Infinity;
    const to = Math.max(0, da <= db ? (da < Infinity ? a : start) : b);
    return { start: to, end: to + len };
  });
  const onStart = dragWith((dt) => ({ start: Math.min(o.end - 0.2, Math.max(0, snap(o.start + dt, points(), tol))) }));
  const onEnd = dragWith((dt) => ({ end: Math.max(o.start + 0.2, snap(o.end + dt, points(), tol)) }));

  const label = isText ? o.text.split("\n")[0] || "（空の文字）" : shapeOf(o.stamp)?.label ?? o.stamp;
  return (
    <div
      className={`group absolute flex items-center overflow-hidden rounded border text-[11px] ${
        isText ? "border-[#8a6fd6] bg-[#4b3d78]" : "border-[#c98a2c] bg-[#6b4a1a]"
      } ${selected ? "z-10 ring-2 ring-accent" : ""}`}
      style={{ left, width, top, height: LANE_H - 4 }}
      onPointerDown={onMove}
      title={`${label}\n${timecode(o.start)} 〜 ${timecode(o.end)}`}
    >
      <span className="truncate px-2">{label}</span>
      <div className="absolute inset-y-0 left-0 w-1.5 cursor-ew-resize hover:bg-fg/40" onPointerDown={onStart} />
      <div className="absolute inset-y-0 right-0 w-1.5 cursor-ew-resize hover:bg-fg/40" onPointerDown={onEnd} />
    </div>
  );
}

function Playhead({ zoom, height }: { zoom: number; height: number }) {
  const time = useStore((s) => s.time);
  return (
    <div className="pointer-events-none absolute top-0 z-40" style={{ left: tx(time, zoom), height }}>
      <div className="absolute -left-[5px] top-0 h-0 w-0 border-x-[5px] border-t-[7px] border-x-transparent border-t-danger" />
      <div className="absolute top-0 h-full w-px bg-danger" />
    </div>
  );
}

const loadHeight = () => {
  try {
    return Number(localStorage.getItem("timelineHeight")) || 260;
  } catch {
    return 260;
  }
};

export function Timeline() {
  const project = useStore((s) => s.project);
  const zoom = useStore((s) => s.zoom);
  const mediaDrag = useStore((s) => s.mediaDrag);
  const l = useMemo(() => layout(project), [project]);
  const laneOf = useMemo(() => lanes(project.overlays), [project.overlays]);
  const laneCount = Math.max(MIN_LANES, ...[...laneOf.values()].map((x) => x + 1));
  const scroller = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ left: 0, width: 800 });
  const [height, setHeight] = useState(loadHeight);
  /** A clip being moved: where it would go. */
  const [moving, setMoving] = useState<{ id: string; index: number; x: number } | null>(null);
  const contentH = RULER_H + VIDEO_H + 10 + laneCount * LANE_H;
  const contentW = PAD * 2 + l.duration * zoom + 600;

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const update = () => setView({ left: el.scrollLeft, width: el.clientWidth });
    update();
    setTimelineWidth(() => el.clientWidth);
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Fit when the first clips arrive.
  const hadClips = useRef(false);
  useEffect(() => {
    // Not closer than 100 px a second: the first part from the source view may be a second long.
    if (!hadClips.current && project.clips.length) requestAnimationFrame(() => fitTimeline(100));
    hadClips.current = project.clips.length > 0;
  }, [project.clips.length]);

  // Keeps the playhead in view while playing.
  useEffect(
    () =>
      useStore.subscribe((s, prev) => {
        const el = scroller.current;
        if (!el || s.time === prev.time || !s.playing) return;
        const x = tx(s.time, s.zoom);
        if (x > el.scrollLeft + el.clientWidth - 40 || x < el.scrollLeft) el.scrollLeft = x - 60;
      }),
    [],
  );

  // A media file dropped from the list onto the video track.
  const trackRect = () => {
    const el = scroller.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { left: r.left, top: r.top + RULER_H, right: r.right, bottom: r.top + RULER_H + VIDEO_H + 20 };
  };
  const overTrack = (x: number, y: number) => {
    const r = trackRect();
    return !!r && x >= r.left && x <= r.right && y >= r.top - 20 && y <= r.bottom;
  };
  const timeAtClient = (x: number) => (x - scroller.current!.getBoundingClientRect().left + scroller.current!.scrollLeft - PAD) / zoom;
  const dropIndex = mediaDrag && overTrack(mediaDrag.x, mediaDrag.y) ? insertIndexAt(l, timeAtClient(mediaDrag.x)) : null;
  useEffect(() => {
    if (!mediaDrag) return;
    const up = (ev: PointerEvent) => {
      const d = st().mediaDrag;
      if (!d || !overTrack(ev.clientX, ev.clientY)) return;
      const m = st().project.media.find((x) => x.id === d.mediaId);
      if (m) addMediaToTimeline(m, insertIndexAt(layout(st().project), timeAtClient(ev.clientX)));
    };
    window.addEventListener("pointerup", up);
    return () => window.removeEventListener("pointerup", up);
  });

  const boundaryX = (index: number) => {
    if (!l.items.length) return tx(0, zoom);
    if (index >= l.items.length) return tx(l.duration, zoom);
    return tx(visual(l, index).from, zoom);
  };

  const onClipDown = (e: React.PointerEvent, it: Placed) => {
    const base = st().project;
    const without = layout({ ...base, clips: base.clips.filter((c) => c.id !== it.clip.id) });
    st().select({ kind: "clip", id: it.clip.id });
    pointerDrag(e, {
      move: (_, ev) => {
        const t = timeAtClient(ev.clientX);
        setMoving({ id: it.clip.id, index: insertIndexAt(without, t), x: ev.clientX });
      },
      end: (moved, ev) => {
        setMoving(null);
        // A click: the playhead goes where it was clicked.
        if (!moved) {
          seek(timeAtClient(ev.clientX));
          return;
        }
        const to = insertIndexAt(without, timeAtClient(ev.clientX));
        if (to !== it.index) st().commit(moveClip(base, it.clip.id, to));
      },
    });
  };

  /** Where a moved clip would land, in the timeline without it. */
  const movingX = (() => {
    if (!moving) return null;
    const base = layout({ ...project, clips: project.clips.filter((c: Clip) => c.id !== moving.id) });
    if (!base.items.length) return tx(0, zoom);
    return moving.index >= base.items.length ? tx(base.duration, zoom) : tx(visual(base, moving.index).from, zoom);
  })();

  const onWheel = (e: React.WheelEvent) => {
    const el = scroller.current!;
    if (e.ctrlKey || e.metaKey) {
      // Zoom around the pointer.
      const t = timeAtClient(e.clientX);
      const next = Math.min(600, Math.max(4, zoom * Math.exp(-e.deltaY * 0.002)));
      st().setZoom(next);
      requestAnimationFrame(() => {
        el.scrollLeft = PAD + t * next - (e.clientX - el.getBoundingClientRect().left);
      });
    } else if (!e.shiftKey && Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
      el.scrollLeft += e.deltaY;
    }
  };

  const onBackgroundDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    st().select(null);
    seek(timeAtClient(e.clientX));
  };

  const onResize = (e: React.PointerEvent) => {
    const y0 = e.clientY;
    const h0 = height;
    pointerDrag(e, {
      threshold: 0,
      move: (_, ev) => setHeight(Math.min(window.innerHeight - 260, Math.max(160, h0 - (ev.clientY - y0)))),
      end: () => {
        try {
          localStorage.setItem("timelineHeight", String(Math.round(height)));
        } catch {
          /* only a preference */
        }
      },
    });
  };

  return (
    // Working on the timeline: the preview shows the edit again.
    <div className="relative flex shrink-0 flex-col border-t border-line bg-panel" style={{ height }} onPointerDownCapture={showTimeline}>
      <div className="absolute -top-1 right-0 left-0 z-50 h-2 cursor-ns-resize" onPointerDown={onResize} />
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-line px-2">
        <CommandButton id="edit.split" icon={Scissors} text="分割" />
        <CommandButton id="edit.duplicate" icon={Copy} />
        <CommandButton id="edit.delete" icon={Trash2} />
        <div className="flex-1" />
        <CommandButton id="view.zoomOut" icon={ZoomOut} />
        <input
          type="range"
          min={Math.log(4)}
          max={Math.log(600)}
          step={0.01}
          value={Math.log(zoom)}
          onChange={(e) => st().setZoom(Math.exp(Number(e.target.value)))}
          className="w-28"
          aria-label="タイムラインの拡大"
        />
        <CommandButton id="view.zoomIn" icon={ZoomIn} />
        <CommandButton id="view.zoomFit" icon={Maximize2} />
      </div>
      <div
        ref={scroller}
        className="relative min-h-0 flex-1 overflow-auto"
        onScroll={(e) => setView({ left: e.currentTarget.scrollLeft, width: e.currentTarget.clientWidth })}
        onWheel={onWheel}
      >
        <div className="relative" style={{ width: contentW, height: Math.max(contentH, 100) }} onPointerDown={onBackgroundDown}>
          <Ruler zoom={zoom} view={view} duration={l.duration} />
          <div className="absolute right-0 left-0 bg-black/15" style={{ top: RULER_H, height: VIDEO_H }} />
          {l.items.map((it) => (
            <ClipBlock key={it.clip.id} it={it} l={l} zoom={zoom} view={view} onMoveStart={onClipDown} />
          ))}
          {l.items.slice(1).map((it) => (
            <Junction key={`j-${it.clip.id}`} it={it} zoom={zoom} />
          ))}
          {project.overlays.map((o) => (
            <OverlayItem key={o.id} o={o} lane={laneOf.get(o.id) ?? 0} zoom={zoom} l={l} timeAt={timeAtClient} />
          ))}
          {!l.items.length && (
            <div className="pointer-events-none absolute flex items-center px-4 text-xs text-dim" style={{ top: RULER_H, height: VIDEO_H, left: PAD }}>
              ここに動画や写真が並びます
            </div>
          )}
          {project.clips.length > 0 && !project.overlays.length && (
            <div className="pointer-events-none absolute px-4 text-[11px] text-dim/70" style={{ top: RULER_H + VIDEO_H + 10, left: PAD }}>
              文字とスタンプはここに並びます
            </div>
          )}
          {(dropIndex !== null || movingX !== null) && (
            <div
              className="pointer-events-none absolute z-40 w-0.5 rounded bg-warn"
              style={{ left: (movingX ?? boundaryX(dropIndex!)) - 1, top: RULER_H - 2, height: VIDEO_H + 4 }}
            />
          )}
          <Playhead zoom={zoom} height={Math.max(contentH, 100)} />
        </div>
      </div>
      {mediaDrag && <DragGhost />}
    </div>
  );
}

/** The media file following the pointer while dragged from the list. */
function DragGhost() {
  const d = useStore((s) => s.mediaDrag)!;
  const m = useStore((s) => s.project.media.find((x) => x.id === d.mediaId));
  if (!m) return null;
  return (
    <div
      className="pointer-events-none fixed z-50 rounded-md border border-accent bg-raised/90 px-2 py-1 text-xs shadow-lg"
      style={{ left: d.x + 12, top: d.y + 12 }}
    >
      {m.name}
    </div>
  );
}

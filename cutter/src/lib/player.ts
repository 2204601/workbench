/**
 * The preview: draws the frame at the playhead onto the canvas, and plays.
 *
 * Each clip near the playhead has its own <video> (two clips of one file
 * can show at once in a transition). Playing runs on the wall clock; the
 * videos play along and are put back in step when they drift. Pictures are
 * decoded once into ImageBitmaps (src/lib/images.ts).
 */
import { animState } from "./anim";
import { fileUrl } from "./api";
import { imageFor, requestImage } from "./images";
import { warn } from "./log";
import { overlayBitmap } from "./overlayRender";
import type { Fit, Media, Project } from "./project";
import { activeAt, layout, sourceTime, type Layout, type Placed } from "./timeline";
import { drawTransition } from "./transitions";
import { useStore } from "../store";

const st = () => useStore.getState();

/** How far a playing video may drift before it is seeked back, seconds. */
const DRIFT = 0.25;

let canvas: HTMLCanvasElement | null = null;
let current: { project: Project; layout: Layout } | null = null;
const videos = new Map<string, { el: HTMLVideoElement; src: string; failed: boolean }>();
/** Media whose original the window couldn't play: a preview copy is asked for. */
const fallbacks = new Set<string>();
let frameRequested = false;
let clock: { wall: number; time: number } | null = null;
/** Videos asked to play and not yet playing (play() is async). */
const playRequested = new WeakSet<HTMLVideoElement>();
/** How long the clock has been held for a loading video, ms. */
let held = 0;
/** At most this long; then the preview moves on and the video catches up. */
const MAX_HOLD = 1500;
let lastTick = 0;

function project(): { project: Project; layout: Layout } {
  const p = st().project;
  if (current?.project !== p) current = { project: p, layout: layout(p) };
  return current;
}

export const currentLayout = () => project().layout;

const mediaOf = (p: Project, id: string) => p.media.find((m) => m.id === id);

/** The file the preview plays for `m`: the preview copy when there is one. */
function playable(m: Media): string | null {
  const info = st().media[m.id];
  if (info?.prepared?.proxy) return info.prepared.proxy;
  if (fallbacks.has(m.id) || info?.status === "missing") return null;
  return m.path;
}

function videoFor(it: Placed): HTMLVideoElement | null {
  const p = project().project;
  const m = mediaOf(p, it.clip.mediaId);
  if (!m || m.kind !== "video") return null;
  const path = playable(m);
  if (!path) return null;
  const src = fileUrl(path);
  let v = videos.get(it.clip.id);
  if (v && v.src !== src) {
    release(it.clip.id);
    v = undefined;
  }
  if (!v) {
    const el = document.createElement("video");
    el.preload = "auto";
    el.playsInline = true;
    el.src = src;
    const entry = { el, src, failed: false };
    el.addEventListener("seeked", requestFrame);
    el.addEventListener("loadeddata", requestFrame);
    el.addEventListener("error", () => {
      entry.failed = true;
      // Can't play the original here: ask for a preview copy (once).
      if (path === m.path && !fallbacks.has(m.id)) {
        fallbacks.add(m.id);
        warn(`preview: ${m.name} doesn't play here; making a preview copy`, el.error?.message);
        onFallback?.(m);
      }
      requestFrame();
    });
    videos.set(it.clip.id, entry);
    v = entry;
  }
  return v.failed ? null : v.el;
}

/** Called when a media file needs a preview copy (src/lib/media.ts sets it). */
export let onFallback: ((m: Media) => void) | null = null;
export const setOnFallback = (f: (m: Media) => void) => (onFallback = f);

function release(id: string) {
  const v = videos.get(id);
  if (!v) return;
  v.el.pause();
  v.el.removeAttribute("src");
  v.el.load();
  videos.delete(id);
}

/** Keeps the videos of the clips around `t`; lets the others go. */
function keepAround(l: Layout, t: number) {
  const act = activeAt(l, Math.min(t, l.duration - 1e-6));
  const at = act ? (act.b ?? act.a).index : 0;
  const keep = new Set(l.items.slice(Math.max(0, at - 1), at + 3).map((it) => it.clip.id));
  for (const id of [...videos.keys()]) if (!keep.has(id)) release(id);
  return keep;
}

function drawFitted(ctx: CanvasRenderingContext2D, src: CanvasImageSource, sw: number, sh: number, fit: Fit, w: number, h: number) {
  if (!sw || !sh) return;
  const s = fit === "cover" ? Math.max(w / sw, h / sh) : Math.min(w / sw, h / sh);
  const dw = sw * s;
  const dh = sh * s;
  ctx.drawImage(src, (w - dw) / 2, (h - dh) / 2, dw, dh);
}

/** One clip's frame, in frame coordinates (the context is scaled). */
function drawClip(ctx: CanvasRenderingContext2D, it: Placed, p: Project) {
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, p.width, p.height);
  const m = mediaOf(p, it.clip.mediaId);
  if (!m) return;
  if (m.kind === "image") {
    const img = imageFor(m);
    if (img) drawFitted(ctx, img, img.width, img.height, it.clip.fit, p.width, p.height);
    else requestImage(m, requestFrame);
    return;
  }
  const el = videoFor(it);
  if (el && el.readyState >= 2) {
    drawFitted(ctx, el, el.videoWidth, el.videoHeight, it.clip.fit, p.width, p.height);
  } else if (!el || st().media[m.id]?.status === "preparing") {
    // Being made ready, or can't be shown: say so instead of a black frame.
    ctx.fillStyle = "#26272c";
    ctx.fillRect(0, 0, p.width, p.height);
    ctx.fillStyle = "#9a9ba3";
    ctx.font = `${Math.round(p.height / 24)}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const info = st().media[m.id];
    const text =
      info?.status === "missing"
        ? `ファイルが見つかりません: ${m.name}`
        : info?.status === "error"
          ? `再生できません: ${m.name}`
          : `プレビューを準備しています… ${info?.ratio ? Math.floor(info.ratio * 100) + "%" : ""}`;
    ctx.fillText(text, p.width / 2, p.height / 2);
  }
}

/** Draws the frame at `t`. */
export function draw(t: number) {
  if (!canvas) return;
  const { project: p, layout: l } = project();
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const scale = canvas.width / p.width;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(scale, 0, 0, scale, 0, 0);

  const act = activeAt(l, Math.min(t, l.duration - 0.5 / p.fps));
  if (act) {
    if (act.b) {
      const kind = act.b.clip.transition?.kind ?? "fade";
      drawTransition(ctx, kind, act.q, (c) => drawClip(c, act.a, p), (c) => drawClip(c, act.b!, p));
    } else {
      drawClip(ctx, act.a, p);
    }
  }

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const { selection, playing } = st();
  for (const o of p.overlays) {
    if (t < o.start || t >= o.end) continue;
    // The one being edited shows whole while paused: added at the playhead,
    // it would otherwise be at the very start of its fade-in, invisible.
    const editing = !playing && selection?.kind === "overlay" && selection.id === o.id;
    const a = editing ? { alpha: 1, scale: 1, dx: 0, dy: 0 } : animState(o, t, p.width, p.height);
    if (a.alpha <= 0 || a.scale <= 0) continue;
    const b = overlayBitmap(o, p.width, p.height, scale);
    ctx.save();
    ctx.globalAlpha = a.alpha;
    ctx.translate((o.x * p.width + a.dx) * scale, (o.y * p.height + a.dy) * scale);
    ctx.scale(a.scale, a.scale);
    ctx.drawImage(b.canvas, -b.canvas.width / 2, -b.canvas.height / 2);
    ctx.restore();
  }
}

/** Puts the videos where `t` wants them; plays or pauses them. */
function syncVideos(t: number, playing: boolean): boolean {
  const { layout: l } = project();
  const keep = keepAround(l, t);
  const act = activeAt(l, t);
  const on = new Map<string, { it: Placed; weight: number }>();
  if (act) {
    on.set(act.a.clip.id, { it: act.a, weight: act.b ? 1 - act.q : 1 });
    if (act.b) on.set(act.b.clip.id, { it: act.b, weight: act.q });
  }
  let waiting = false;
  for (const { it, weight } of on.values()) {
    const el = videoFor(it);
    if (!el) continue;
    const want = sourceTime(it, t);
    el.volume = Math.min(1, Math.max(0, it.clip.volume * weight));
    el.muted = it.clip.volume === 0;
    if (playing) {
      if (Math.abs(el.currentTime - want) > DRIFT && !el.seeking) el.currentTime = want;
      if (el.paused && !playRequested.has(el)) {
        playRequested.add(el);
        el.play()
          .catch((e) => warn("preview play", e))
          .finally(() => playRequested.delete(el));
      }
      if (el.readyState < 3 || el.seeking) waiting = true;
    } else {
      if (!el.paused) el.pause();
      if (Math.abs(el.currentTime - want) > 0.5 / l.fps) el.currentTime = want;
    }
  }
  // The next clips wait at their first frame, so a cut shows at once.
  for (const it of l.items) {
    if (on.has(it.clip.id) || !keep.has(it.clip.id)) continue;
    const el = videoFor(it);
    if (!el) continue;
    if (!el.paused) el.pause();
    if (it.start > t && !el.seeking && Math.abs(el.currentTime - it.clip.start) > 0.05) el.currentTime = it.clip.start;
  }
  return waiting;
}

function tick() {
  frameRequested = false;
  const s = st();
  if (!s.playing || !clock) {
    clock = null;
    return;
  }
  const now = performance.now();
  let t = clock.time + (now - clock.wall) / 1000;
  const { layout: l } = project();
  if (t >= l.duration) {
    s.setPlaying(false);
    s.setTime(l.duration);
    return;
  }
  const waiting = syncVideos(t, true);
  // A video still loading holds the clock for a while, rather than being
  // seeked again and again.
  if (waiting && held < MAX_HOLD) {
    held += now - lastTick;
    t = s.time;
    clock = { wall: now, time: t };
  } else if (!waiting) {
    held = 0;
  }
  lastTick = now;
  if (t !== s.time) s.setTime(t);
  draw(t);
  frameRequested = true;
  requestAnimationFrame(tick);
}

/** Redraws once on the next frame (while paused). */
export function requestFrame() {
  if (frameRequested) return;
  frameRequested = true;
  requestAnimationFrame(() => {
    frameRequested = false;
    const s = st();
    if (s.playing) return;
    syncVideos(s.time, false);
    draw(s.time);
  });
}

export function play() {
  const s = st();
  const d = project().layout.duration;
  if (d <= 0) return;
  // From the start again when at the end.
  if (s.time >= d - 0.5 / s.project.fps) s.setTime(0);
  clock = { wall: performance.now(), time: st().time };
  held = 0;
  lastTick = clock.wall;
  s.setPlaying(true);
  if (!frameRequested) {
    frameRequested = true;
    requestAnimationFrame(tick);
  }
}

export function pause() {
  st().setPlaying(false);
  clock = null;
  for (const v of videos.values()) v.el.pause();
  requestFrame();
}

export const togglePlay = () => (st().playing ? pause() : play());

/** Moves the playhead (keeps playing from there if playing). */
export function seek(t: number) {
  const s = st();
  const d = project().layout.duration;
  const to = Math.min(Math.max(0, t), d);
  s.setTime(to);
  if (s.playing) clock = { wall: performance.now(), time: to };
  else requestFrame();
}

/** The preview's canvas (Preview.tsx). */
export function attachCanvas(c: HTMLCanvasElement | null) {
  canvas = c;
  requestFrame();
}

/** Lets go of every video (a project closes). */
export function resetPlayer() {
  pause();
  for (const id of [...videos.keys()]) release(id);
  fallbacks.clear();
}

// Redraw when the edit or the media change (not on every playhead move: seek does).
useStore.subscribe((s, prev) => {
  if (s.project !== prev.project || s.media !== prev.media || s.selection !== prev.selection) requestFrame();
});

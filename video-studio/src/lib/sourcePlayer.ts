/**
 * The source view: one media file shown on its own, to mark the part to
 * use (in and out points) and put it on the timeline. The file plays in a
 * plain <video> (SourceView.tsx hands it over); its time goes into the
 * store, so the range bar and the keys follow it.
 */
import { fileUrl } from "./api";
import { prepare } from "./media";
import { pause as pauseTimeline } from "./player";
import type { Media } from "./project";
import { mark, type Range } from "./source";
import { snapToFrame } from "./timeline";
import { useStore } from "../store";

const st = () => useStore.getState();

let video: HTMLVideoElement | null = null;
let raf = 0;

export const sourceMedia = (): Media | undefined => {
  const s = st();
  return s.source ? s.project.media.find((m) => m.id === s.source!.mediaId) : undefined;
};

/** The file the view plays: the preview copy when there is one. */
export function sourceUrl(m: Media): string | null {
  const info = st().media[m.id];
  if (info?.status === "missing") return null;
  return fileUrl(info?.prepared?.proxy ?? m.path);
}

/** Opens `mediaId` in the source view (with a part already marked, from a clip). */
export function openSource(mediaId: string, range?: Range) {
  const s = st();
  const m = s.project.media.find((x) => x.id === mediaId);
  if (!m || m.kind !== "video") return;
  pauseTimeline();
  if (s.source?.mediaId !== mediaId || range) {
    pause();
    s.setSource({ mediaId, in: range?.in ?? null, out: range?.out ?? null });
    s.setSourceTime(range?.in ?? 0);
  }
  s.setView("source");
}

/** Back to the edit. */
export function showTimeline() {
  if (st().view === "timeline") return;
  pause();
  st().setView("timeline");
}

export function closeSource() {
  pause();
  st().setSource(null);
  st().setView("timeline");
}

// ---------------------------------------------------------------- playing

function tick() {
  if (!video || !st().sourcePlaying) return;
  st().setSourceTime(video.currentTime);
  raf = requestAnimationFrame(tick);
}

/** SourceView.tsx: the <video> of the open file. */
export function attachSourceVideo(el: HTMLVideoElement | null) {
  video = el;
  if (!el) return;
  el.currentTime = st().sourceTime;
  el.onended = () => pause();
  el.onerror = () => {
    // Can't play the original here: make a preview copy (once).
    const m = sourceMedia();
    if (m && !st().media[m.id]?.prepared?.proxy && st().media[m.id]?.status !== "preparing") void prepare(m, true);
  };
}

export function play() {
  if (!video) return;
  const m = sourceMedia();
  if (m && st().sourceTime >= m.duration - 0.05) seek(0);
  void video.play().catch(() => {});
  st().setSourcePlaying(true);
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(tick);
}

export function pause() {
  video?.pause();
  cancelAnimationFrame(raf);
  if (st().sourcePlaying) st().setSourcePlaying(false);
  if (video) st().setSourceTime(video.currentTime);
}

export const toggle = () => (st().sourcePlaying ? pause() : play());

export function seek(t: number) {
  const m = sourceMedia();
  const to = Math.min(Math.max(0, t), m?.duration ?? t);
  st().setSourceTime(to);
  if (video) video.currentTime = to;
}

export function step(frames: number) {
  const fps = st().project.fps;
  seek(snapToFrame(st().sourceTime, fps) + frames / fps);
}

// ---------------------------------------------------------------- marking

export function markPoint(which: "in" | "out") {
  const s = st();
  const m = sourceMedia();
  if (!s.source || !m) return;
  const at = snapToFrame(s.sourceTime, s.project.fps);
  s.setSource({ ...s.source, ...mark(s.source, which, at, m.duration) });
}

export function clearMarks() {
  const s = st();
  if (s.source) s.setSource({ ...s.source, in: null, out: null });
}

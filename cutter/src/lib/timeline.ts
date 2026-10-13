/**
 * Where everything sits in time, and the edits on the video track. Pure
 * functions of a Project.
 *
 * The video track is magnetic: clips follow one another with no gaps. A
 * transition overlaps the end of a clip with the start of the next, so it
 * shortens the whole by its length. Lengths are counted in frames and
 * rounded exactly as src-tauri/src/render.rs `frames` does, so the preview
 * and the export agree to the frame.
 */
import type { Clip, Media, Overlay, Project } from "./project";

/** A clip on the timeline. Seconds unless named frames. */
export interface Placed {
  clip: Clip;
  index: number;
  start: number;
  duration: number;
  /** The transition into this clip, as it will play (0 = a cut). */
  transition: number;
  startFrame: number;
  frames: number;
  transitionFrames: number;
}

export interface Layout {
  items: Placed[];
  /** Seconds. */
  duration: number;
  fps: number;
}

/** The shortest a clip can be cut to. */
export const MIN_CLIP_SECONDS = 0.1;

export function layout(p: Pick<Project, "clips" | "fps">): Layout {
  const fps = p.fps;
  const frames = p.clips.map((c) => Math.max(1, Math.round((c.end - c.start) * fps)));
  const trans = p.clips.map(() => 0);
  for (let i = 1; i < frames.length; i++) {
    const t = p.clips[i].transition;
    if (!t) continue;
    const want = Math.max(0, Math.round(t.duration * fps));
    // At most two clips at once: never longer than either clip's free part.
    const room = Math.max(0, Math.min(frames[i - 1] - trans[i - 1], frames[i]) - 1);
    trans[i] = Math.min(want, room);
  }
  const items: Placed[] = [];
  let at = 0;
  for (let i = 0; i < frames.length; i++) {
    at -= trans[i];
    items.push({
      clip: p.clips[i],
      index: i,
      start: at / fps,
      duration: frames[i] / fps,
      transition: trans[i] / fps,
      startFrame: at,
      frames: frames[i],
      transitionFrames: trans[i],
    });
    at += frames[i];
  }
  return { items, duration: at / fps, fps };
}

/** What shows at `t`: one clip, or two in a transition (`q` 0..1 of it). */
export interface Active {
  a: Placed;
  b?: Placed;
  q: number;
}

export function activeAt(l: Layout, t: number): Active | null {
  if (t < 0 || t >= l.duration || !l.items.length) return null;
  const f = Math.floor(t * l.fps + 1e-6);
  // The last clip that has started; the one before may still be ending.
  let i = l.items.length - 1;
  while (i > 0 && l.items[i].startFrame > f) i--;
  const cur = l.items[i];
  if (i > 0 && f < cur.startFrame + cur.transitionFrames) {
    return { a: l.items[i - 1], b: cur, q: (t * l.fps - cur.startFrame) / cur.transitionFrames };
  }
  return { a: cur, q: 0 };
}

/** The clip under `t` for cutting there: the one that started last. */
export function clipAt(l: Layout, t: number): Placed | null {
  let found: Placed | null = null;
  for (const it of l.items) if (it.start <= t + 1e-9 && t < it.start + it.duration) found = it;
  return found;
}

/** The file's time shown at timeline time `t` of a placed clip. */
export const sourceTime = (it: Placed, t: number) => it.clip.start + (t - it.start);

export const snapToFrame = (t: number, fps: number) => Math.round(t * fps) / fps;

// ---------------------------------------------------------------- edits

const replaceClip = (p: Project, id: string, f: (c: Clip) => Clip): Project => ({
  ...p,
  clips: p.clips.map((c) => (c.id === id ? f(c) : c)),
});

/**
 * Cuts the clip under `t` in two at `t`. Null when `t` is too close to an
 * end to leave two pieces. `ids` names the two new clips.
 */
export function split(p: Project, t: number, ids: [string, string]): Project | null {
  const l = layout(p);
  const it = clipAt(l, snapToFrame(t, p.fps));
  if (!it) return null;
  const at = snapToFrame(sourceTime(it, snapToFrame(t, p.fps)), p.fps);
  const c = it.clip;
  if (at - c.start < MIN_CLIP_SECONDS || c.end - at < MIN_CLIP_SECONDS) return null;
  const media = p.media.find((m) => m.id === c.mediaId);
  // A picture shows the same all along: the second piece starts at 0 again.
  const still = media?.kind === "image";
  const first: Clip = { ...c, id: ids[0], end: at };
  const second: Clip = still
    ? { ...c, id: ids[1], start: 0, end: c.end - at, transition: null }
    : { ...c, id: ids[1], start: at, transition: null };
  const clips = [...p.clips];
  clips.splice(it.index, 1, first, second);
  return { ...p, clips };
}

export function removeClips(p: Project, ids: Set<string>): Project {
  const clips = p.clips.filter((c) => !ids.has(c.id));
  // The first clip has no transition into it.
  if (clips[0]?.transition) clips[0] = { ...clips[0], transition: null };
  return { ...p, clips };
}

/** Moves a clip to `to`, an index among the clips without it. */
export function moveClip(p: Project, id: string, to: number): Project {
  const from = p.clips.findIndex((c) => c.id === id);
  if (from < 0) return p;
  const clips = p.clips.filter((c) => c.id !== id);
  clips.splice(Math.max(0, Math.min(to, clips.length)), 0, p.clips[from]);
  if (clips[0]?.transition) clips[0] = { ...clips[0], transition: null };
  return { ...p, clips };
}

export function insertClips(p: Project, index: number, add: Clip[]): Project {
  const clips = [...p.clips];
  clips.splice(Math.max(0, Math.min(index, clips.length)), 0, ...add);
  if (clips[0]?.transition) clips[0] = { ...clips[0], transition: null };
  return { ...p, clips };
}

/**
 * Drags an edge of a clip by `delta` seconds (from where the drag began, so
 * a live drag gives the same answer each move). A video can't go past its
 * file; a picture just gets longer or shorter.
 */
export function trimClip(p: Project, id: string, edge: "start" | "end", delta: number): Project {
  const c = p.clips.find((x) => x.id === id);
  if (!c) return p;
  const media = p.media.find((m) => m.id === c.mediaId);
  const fps = p.fps;
  if (!media || media.kind === "image") {
    const len = c.end - c.start + (edge === "end" ? delta : -delta);
    return replaceClip(p, id, (x) => ({ ...x, start: 0, end: snapToFrame(Math.max(MIN_CLIP_SECONDS, len), fps) }));
  }
  if (edge === "start") {
    const start = Math.min(Math.max(0, c.start + delta), c.end - MIN_CLIP_SECONDS);
    return replaceClip(p, id, (x) => ({ ...x, start: snapToFrame(start, fps) }));
  }
  const end = Math.max(Math.min(media.duration, c.end + delta), c.start + MIN_CLIP_SECONDS);
  return replaceClip(p, id, (x) => ({ ...x, end: Math.min(media.duration, snapToFrame(end, fps)) }));
}

export const updateClip = (p: Project, id: string, change: Partial<Clip>) => replaceClip(p, id, (c) => ({ ...c, ...change }));

/** A clip made of all of `m` (a picture: `imageSeconds` long). */
export function clipOf(m: Media, id: string, imageSeconds: number): Clip {
  return {
    id,
    mediaId: m.id,
    start: 0,
    end: m.kind === "image" ? imageSeconds : m.duration,
    volume: 1,
    fit: "contain",
    transition: null,
  };
}

/** Where a clip dropped at `t` goes: before the clip whose middle is past `t`. */
export function insertIndexAt(l: Layout, t: number): number {
  for (const it of l.items) if (t < it.start + it.duration / 2) return it.index;
  return l.items.length;
}

// ---------------------------------------------------------------- overlays

export const updateOverlay = (p: Project, id: string, change: Partial<Overlay>): Project => ({
  ...p,
  overlays: p.overlays.map((o) => (o.id === id ? { ...o, ...change } : o)),
});

/** Rows for the overlay track: each item on the first row free at its start. */
export function lanes(overlays: Overlay[]): Map<string, number> {
  const out = new Map<string, number>();
  const ends: number[] = [];
  for (const o of [...overlays].sort((a, b) => a.start - b.start || a.end - b.end)) {
    let lane = ends.findIndex((e) => e <= o.start + 1e-9);
    if (lane < 0) lane = ends.length;
    ends[lane] = o.end;
    out.set(o.id, lane);
  }
  return out;
}

/** `t` moved to the nearest of `points` within `tolerance`. */
export function snap(t: number, points: number[], tolerance: number): number {
  let best = t;
  let dist = tolerance;
  for (const p of points) {
    const d = Math.abs(p - t);
    if (d < dist) {
      dist = d;
      best = p;
    }
  }
  return best;
}

/** Where things begin and end, for snapping. */
export function snapPoints(p: Project, l: Layout, playhead: number, skipOverlay?: string): number[] {
  const pts = [0, l.duration, playhead];
  for (const it of l.items) pts.push(it.start, it.start + it.duration);
  for (const o of p.overlays) if (o.id !== skipOverlay) pts.push(o.start, o.end);
  return pts;
}

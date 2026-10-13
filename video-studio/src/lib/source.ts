/**
 * Picking parts of one media file (the source view): the marked part, and
 * where the file is already used on the timeline. Pure functions; the
 * <video> that plays the file is src/lib/sourcePlayer.ts.
 */
import type { Clip, Media, Project } from "./project";
import { MIN_CLIP_SECONDS } from "./timeline";

export interface Range {
  in: number | null;
  out: number | null;
}

/**
 * Sets the in or the out point at `t`. A point that would leave less than
 * MIN_CLIP_SECONDS (or be on the wrong side of the other) clears the other.
 */
export function mark(r: Range, which: "in" | "out", t: number, duration: number): Range {
  const at = Math.min(Math.max(0, t), duration);
  if (which === "in") {
    return { in: at, out: r.out !== null && r.out - at >= MIN_CLIP_SECONDS ? r.out : null };
  }
  return { in: r.in !== null && at - r.in >= MIN_CLIP_SECONDS ? r.in : null, out: at };
}

/** The part to use: from the in point (or the start) to the out point (or the end). */
export function span(r: Range, duration: number): { start: number; end: number } {
  return { start: r.in ?? 0, end: r.out ?? duration };
}

/** A clip of that part of `m`, or null when it is too short. */
export function clipOfRange(m: Media, r: Range, id: string): Clip | null {
  const { start, end } = span(r, m.duration);
  if (end - start < MIN_CLIP_SECONDS) return null;
  return { id, mediaId: m.id, start, end, volume: 1, fit: "contain", transition: null };
}

/** The parts of the file the timeline uses, in file order. */
export function usedRanges(p: Pick<Project, "clips">, mediaId: string): { start: number; end: number }[] {
  return p.clips
    .filter((c) => c.mediaId === mediaId)
    .map((c) => ({ start: c.start, end: c.end }))
    .sort((a, b) => a.start - b.start);
}

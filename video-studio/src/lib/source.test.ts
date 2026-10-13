import { describe, expect, it } from "vitest";
import type { Clip, Media } from "./project";
import { clipOfRange, mark, span, usedRanges } from "./source";

const m: Media = { id: "m", path: "/a.mp4", name: "a.mp4", kind: "video", duration: 10, width: 1920, height: 1080, fps: 30, hasAudio: true };

describe("marking a part of a file", () => {
  it("keeps the other point while it stays on its side", () => {
    let r = mark({ in: null, out: null }, "in", 2, 10);
    r = mark(r, "out", 5, 10);
    expect(r).toEqual({ in: 2, out: 5 });
    // A new in point past the out point drops the out point.
    expect(mark(r, "in", 6, 10)).toEqual({ in: 6, out: null });
    expect(mark(r, "out", 1, 10)).toEqual({ in: null, out: 1 });
    // Within the file.
    expect(mark(r, "out", 12, 10)).toEqual({ in: 2, out: 10 });
  });

  it("uses the whole file where a point is missing", () => {
    expect(span({ in: null, out: null }, 10)).toEqual({ start: 0, end: 10 });
    expect(span({ in: 3, out: null }, 10)).toEqual({ start: 3, end: 10 });
    expect(clipOfRange(m, { in: 3, out: 4.5 }, "c")).toMatchObject({ mediaId: "m", start: 3, end: 4.5, transition: null });
    expect(clipOfRange(m, { in: 3, out: 3.05 }, "c")).toBeNull();
  });
});

it("lists the parts the timeline uses, in file order", () => {
  const c = (id: string, mediaId: string, start: number, end: number) => ({ id, mediaId, start, end }) as Clip;
  expect(usedRanges({ clips: [c("a", "m", 6, 8), c("b", "x", 0, 1), c("c", "m", 1, 2)] }, "m")).toEqual([
    { start: 1, end: 2 },
    { start: 6, end: 8 },
  ]);
});

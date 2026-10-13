import { describe, expect, it } from "vitest";
import { emptyProject, type Clip, type Media, type Project } from "./project";
import { activeAt, insertIndexAt, lanes, layout, moveClip, removeClips, split, trimClip } from "./timeline";

const video: Media = { id: "m", path: "/a.mp4", name: "a.mp4", kind: "video", duration: 10, width: 1920, height: 1080, fps: 30, hasAudio: true };
const photo: Media = { ...video, id: "p", path: "/p.jpg", kind: "image", duration: 0 };

const clip = (id: string, start: number, end: number, transition: number | null = null, mediaId = "m"): Clip => ({
  id,
  mediaId,
  start,
  end,
  volume: 1,
  fit: "contain",
  transition: transition === null ? null : { kind: "fade", duration: transition },
});

const project = (clips: Clip[]): Project => ({ ...emptyProject(), media: [video, photo], clips });

describe("layout", () => {
  it("overlaps transitions and rounds like render.rs", () => {
    // The same case as render.rs frames_round_and_keep_transitions_inside_clips.
    const l = layout(project([clip("a", 0, 2), clip("b", 0, 1, 0.5), clip("c", 0, 3, 2)]));
    expect(l.items.map((i) => [i.startFrame, i.frames, i.transitionFrames])).toEqual([
      [0, 60, 0],
      [45, 30, 15],
      [61, 90, 14],
    ]);
    expect(l.duration).toBeCloseTo((60 + 30 + 90 - 15 - 14) / 30);
  });

  it("finds one clip or the two in a transition", () => {
    const l = layout(project([clip("a", 0, 2), clip("b", 0, 2, 1)]));
    expect(activeAt(l, 0.5)?.a.clip.id).toBe("a");
    const mid = activeAt(l, 1.5)!;
    expect([mid.a.clip.id, mid.b?.clip.id]).toEqual(["a", "b"]);
    expect(mid.q).toBeCloseTo(0.5);
    expect(activeAt(l, 2.5)?.a.clip.id).toBe("b");
    expect(activeAt(l, 3)).toBeNull();
  });
});

describe("edits", () => {
  it("splits at the playhead", () => {
    const p = split(project([clip("a", 1, 5)]), 2, ["x", "y"])!;
    expect(p.clips.map((c) => [c.id, c.start, c.end])).toEqual([
      ["x", 1, 3],
      ["y", 3, 5],
    ]);
    expect(split(project([clip("a", 1, 5)]), 0.02, ["x", "y"])).toBeNull();
    // A picture's second piece starts again from 0.
    const q = split(project([clip("a", 0, 3, null, "p")]), 1, ["x", "y"])!;
    expect(q.clips.map((c) => [c.start, c.end])).toEqual([
      [0, 1],
      [0, 2],
    ]);
  });

  it("keeps the first clip without a transition", () => {
    const p = project([clip("a", 0, 2), clip("b", 0, 2, 0.5), clip("c", 0, 2)]);
    expect(removeClips(p, new Set(["a"])).clips[0].transition).toBeNull();
    expect(moveClip(p, "b", 0).clips.map((c) => [c.id, c.transition])).toEqual([
      ["b", null],
      ["a", null],
      ["c", null],
    ]);
  });

  it("trims within the file", () => {
    const p = project([clip("a", 1, 5)]);
    expect(trimClip(p, "a", "start", -3).clips[0].start).toBe(0);
    expect(trimClip(p, "a", "end", 100).clips[0].end).toBe(10);
    expect(trimClip(p, "a", "start", 100).clips[0].start).toBeCloseTo(4.9);
    const q = project([clip("a", 0, 3, null, "p")]);
    expect(trimClip(q, "a", "start", 1).clips[0]).toMatchObject({ start: 0, end: 2 });
  });

  it("drops a clip before the one whose middle is past", () => {
    const l = layout(project([clip("a", 0, 2), clip("b", 0, 2)]));
    expect([insertIndexAt(l, 0.5), insertIndexAt(l, 1.5), insertIndexAt(l, 3.5)]).toEqual([0, 1, 2]);
  });
});

it("stacks overlapping overlays in rows", () => {
  const o = (id: string, start: number, end: number) => ({ id, start, end }) as never;
  const m = lanes([o("a", 0, 3), o("b", 1, 2), o("c", 2, 4), o("d", 3, 5)]);
  expect([m.get("a"), m.get("b"), m.get("c"), m.get("d")]).toEqual([0, 1, 1, 0]);
});

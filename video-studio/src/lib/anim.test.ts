import { describe, expect, it } from "vitest";
import { animState } from "./anim";

const o = (animIn: string, animOut: string) => ({ start: 1, end: 3, animIn, animOut }) as never;

// The same moments as src-tauri/src/render.rs overlays_animate_with_expressions.
describe("animState", () => {
  it("fades in and out in a straight line", () => {
    expect(animState(o("fade", "fade"), 1, 1280, 720).alpha).toBe(0);
    expect(animState(o("fade", "fade"), 1.2, 1280, 720).alpha).toBeCloseTo(0.5);
    expect(animState(o("fade", "fade"), 2, 1280, 720).alpha).toBe(1);
    expect(animState(o("fade", "fade"), 2.8, 1280, 720).alpha).toBeCloseTo(0.5);
  });

  it("pops with a little overshoot, visible in a third of the time", () => {
    const at = (t: number) => animState(o("pop", "none"), t, 1280, 720);
    expect(at(1).scale).toBeCloseTo(0);
    expect(at(1 + 0.4 / 3).alpha).toBeCloseTo(1);
    expect(Math.max(...[1.2, 1.25, 1.3].map((t) => at(t).scale))).toBeGreaterThan(1);
    expect(at(1.4).scale).toBeCloseTo(1);
  });

  it("slides in from the left and out to the right; rises", () => {
    expect(animState(o("slide", "slide"), 1, 1280, 720).dx).toBeCloseTo(-192);
    expect(animState(o("slide", "slide"), 3, 1280, 720).dx).toBeCloseTo(192);
    expect(animState(o("rise", "rise"), 1, 1280, 720).dy).toBeCloseTo(57.6);
    expect(animState(o("rise", "rise"), 3, 1280, 720).dy).toBeCloseTo(-57.6);
    expect(animState(o("slide", "rise"), 2, 1280, 720)).toEqual({ alpha: 1, scale: 1, dx: 0, dy: 0 });
  });
});

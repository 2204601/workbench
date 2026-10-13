import { memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import { create } from "zustand";
import type { Annot } from "../lib/api";
import { addAnnot, moved, raiseAnnot, removeAnnot, resized, updateAnnot } from "../lib/edit";
import {
  apply,
  bounds,
  invert,
  normalize,
  readingSize,
  rectToPdf,
  rectToScreen,
  screenTurn,
  simplify,
  type Matrix,
  type Point,
  type Rect,
} from "../lib/geometry";
import { imageUrl } from "../lib/images";
import { sealLayout } from "../lib/seal";
import { LINE_HEIGHT, TEXT_PADDING, textFontFamily, textHeight, textWidth, wrapText } from "../lib/text";
import { activeDoc, newAnnotId, useStore, type Tool } from "../store";
import { NotePopup } from "./NotePopup";

const st = () => useStore.getState();

/**
 * The text box being typed in (one at a time, on any page). `fresh`: made
 * just now, so leaving it empty takes it away without an undo step.
 */
export const useEditing = create<{ id: string | null; fresh: boolean; set: (id: string | null, fresh?: boolean) => void }>()(
  (set) => ({
    id: null,
    fresh: false,
    set: (id, fresh = false) => set({ id, fresh }),
  }),
);

/** Tools that draw on the page (they take the pointer from the text). */
const DRAWING: Tool[] = ["text", "note", "ink", "rect", "ellipse", "line", "arrow", "image", "fill", "check", "cross", "dot", "dash", "date", "eraser", "seal"];

/** Tools that type into a text box. */
const TYPING: Tool[] = ["text", "fill"];

/** Today as 2026/10/13 (the date tool; it can be edited after). */
function todayText(): string {
  const t = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${t.getFullYear()}/${p(t.getMonth() + 1)}/${p(t.getDate())}`;
}

/** Distance from `p` to the segment a–b. */
function segmentDistance(p: Point, a: Point, b: Point): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2)) : 0;
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** Kinds that can be moved and resized by hand. */
const BOXED = new Set(["rect", "ellipse", "text", "image", "ink", "seal"]);

type Handle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
const HANDLES: Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

type Drag =
  | { kind: "move"; id: string; start: Point; orig: Annot; moved: boolean }
  | { kind: "resize"; id: string; handle: Handle; start: Point; orig: Annot; box: Rect; pdfBox: Rect; moved: boolean }
  | { kind: "end"; id: string; end: 0 | 1; orig: Annot; moved: boolean }
  | { kind: "create"; tool: Tool; start: Point; cur: Point; points: Point[] }
  | { kind: "erase"; erased: boolean };

/** Screen distance to PDF distance (the linear part of the inverse). */
function toPdfDelta(m: Matrix, dx: number, dy: number): Point {
  const inv = invert(m);
  return [inv[0] * dx + inv[2] * dy, inv[1] * dx + inv[3] * dy];
}

function annotBase(tool: Tool): Annot {
  const s = st();
  const style = s.styles[tool];
  return {
    id: newAnnotId(),
    kind: "rect",
    color: style.color,
    opacity: style.opacity,
    width: style.width,
    fill: style.fill,
    rect: null,
    quads: [],
    paths: [],
    line: null,
    text: "",
    lines: [],
    fontSize: style.fontSize,
    rotation: 0,
    image: null,
    seal: null,
    contents: "",
    author: s.author,
    modified: "",
  };
}

/** When the last ink stroke ended, to join quick strokes into one annotation. */
let lastInk: { id: string; uid: string; at: number } | null = null;

/**
 * Our annotations on one page, drawn in screen coordinates, and the tools
 * that make and change them.
 */
export const Overlay = memo(function Overlay({
  docKey,
  uid,
  matrix,
  rotation,
  px,
  readOnly,
}: {
  docKey: string;
  uid: string;
  matrix: Matrix;
  /** The page's rotation as shown. */
  rotation: number;
  /** CSS pixels per point. */
  px: number;
  readOnly: boolean;
}) {
  const annots = useStore((s) => s.docs.find((d) => d.key === docKey)?.annots[uid]);
  const selected = useStore((s) => {
    const d = s.docs.find((x) => x.key === docKey);
    const id = d?.selectedAnnot;
    return id && d?.annots[uid]?.some((a) => a.id === id) ? id : null;
  });
  const tool = useStore((s) => s.tool);
  const editing = useEditing((s) => s.id);
  const root = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  dragRef.current = drag;

  const drawing = !readOnly && DRAWING.includes(tool);
  const selecting = tool === "select";

  const local = (e: { clientX: number; clientY: number }): Point => {
    const r = root.current!.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };

  // ----------------------------------------------------- moving, resizing

  useEffect(() => {
    if (!drag || drag.kind === "create" || drag.kind === "erase") return;
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d || d.kind === "create" || d.kind === "erase") return;
      const p = local(e);
      if (!d.moved) {
        if (d.kind !== "end" && Math.hypot(p[0] - d.start[0], p[1] - d.start[1]) < 3) return;
        st().checkpoint();
        setDrag({ ...d, moved: true });
      }
      if (d.kind === "move") {
        const [dx, dy] = toPdfDelta(matrix, p[0] - d.start[0], p[1] - d.start[1]);
        st().amend((s) => updateAnnot(s, d.id, moved(d.orig, dx, dy)));
      } else if (d.kind === "resize") {
        const [x1, y1, x2, y2] = d.box;
        const dx = p[0] - d.start[0];
        const dy = p[1] - d.start[1];
        let b: Rect = [
          d.handle.includes("w") ? x1 + dx : x1,
          d.handle.includes("n") ? y1 + dy : y1,
          d.handle.includes("e") ? x2 + dx : x2,
          d.handle.includes("s") ? y2 + dy : y2,
        ];
        b = normalize(b);
        // Pictures and round seals keep their shape from the corners.
        if ((d.orig.kind === "image" || (d.orig.kind === "seal" && d.orig.seal === "round")) && d.handle.length === 2) {
          const ratio = (y2 - y1) / (x2 - x1 || 1);
          const w = Math.max(b[2] - b[0], 8);
          const h = w * ratio;
          b = d.handle.includes("n") ? [b[0], y2 - h, b[0] + w, y2] : [b[0], y1, b[0] + w, y1 + h];
          if (d.handle.includes("w")) b = [x2 - w, b[1], x2, b[3]];
        }
        if (b[2] - b[0] < 6 || b[3] - b[1] < 6) return;
        const to = rectToPdf(matrix, b);
        st().amend((s) => updateAnnot(s, d.id, resized(d.orig, d.pdfBox, to)));
      } else if (d.kind === "end" && d.orig.line) {
        const [x, y] = apply(invert(matrix), p);
        const l = [...d.orig.line] as [number, number, number, number];
        if (d.end === 0) [l[0], l[1]] = [x, y];
        else [l[2], l[3]] = [x, y];
        st().amend((s) => updateAnnot(s, d.id, { line: l }));
      }
    };
    const onUp = () => setDrag(null);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
    // A new listener per drag; `drag.moved` changes don't need one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag?.kind, drag && "id" in drag ? drag.id : null, matrix]);

  const select = (id: string | null) => {
    st().patchDoc({ selectedAnnot: id }, docKey);
    if (id !== editing) useEditing.getState().set(null);
  };

  const onAnnotDown = (e: React.PointerEvent, a: Annot) => {
    if (!selecting || e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    window.getSelection()?.removeAllRanges();
    select(a.id);
    if (readOnly || editing === a.id) return;
    const markup = a.kind === "highlight" || a.kind === "underline" || a.kind === "strikeout";
    if (!markup) setDrag({ kind: "move", id: a.id, start: local(e), orig: a, moved: false });
  };

  const onHandleDown = (e: React.PointerEvent, a: Annot, handle: Handle) => {
    e.stopPropagation();
    e.preventDefault();
    const pdfBox = (a.kind === "ink" ? bounds(a) : a.rect)!;
    setDrag({ kind: "resize", id: a.id, handle, start: local(e), orig: a, box: rectToScreen(matrix, pdfBox), pdfBox, moved: false });
  };

  const onEndDown = (e: React.PointerEvent, a: Annot, end: 0 | 1) => {
    e.stopPropagation();
    e.preventDefault();
    setDrag({ kind: "end", id: a.id, end, orig: a, moved: false });
  };

  // ----------------------------------------------------- making new ones

  /**
   * The eraser: pen strokes under the pointer go away, one stroke at a
   * time (the annotation when its last stroke goes). One undo step per drag.
   */
  const eraseAt = (p: Point) => {
    const d = activeDoc(st());
    const list = d?.annots[uid] ?? [];
    for (const a of list) {
      if (a.kind !== "ink") continue;
      const reach = Math.max(8, (a.width * px) / 2 + 4);
      const keep = a.paths.filter((path) => {
        let prev: Point | null = null;
        for (let k = 0; k + 1 < path.length; k += 2) {
          const q = apply(matrix, [path[k], path[k + 1]]);
          if (prev ? segmentDistance(p, prev, q) < reach : Math.hypot(p[0] - q[0], p[1] - q[1]) < reach) return false;
          prev = q;
        }
        return true;
      });
      if (keep.length === a.paths.length) continue;
      const dr = dragRef.current;
      if (dr?.kind === "erase" && !dr.erased) {
        st().checkpoint();
        setDrag({ kind: "erase", erased: true });
      }
      st().amend((s) => (keep.length ? updateAnnot(s, a.id, { paths: keep }) : removeAnnot(s, a.id)));
    }
  };

  const onRootDown = (e: React.PointerEvent) => {
    if (!drawing || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    // Finishing a text box: the click that ends it doesn't start another.
    if (editing) {
      useEditing.getState().set(null);
      if (TYPING.includes(tool)) return;
    }
    const p = local(e);
    if (tool === "eraser") {
      root.current!.setPointerCapture(e.pointerId);
      dragRef.current = { kind: "erase", erased: false };
      setDrag(dragRef.current);
      eraseAt(p);
      return;
    }
    // The text tool on a text box types in it, as in Acrobat.
    if (TYPING.includes(tool) && !readOnly) {
      const hit = [...(annots ?? [])].reverse().find((a) => {
        if (a.kind !== "text" || !a.rect) return false;
        const [x1, y1, x2, y2] = rectToScreen(matrix, a.rect);
        return p[0] >= x1 && p[0] <= x2 && p[1] >= y1 && p[1] <= y2;
      });
      if (hit) {
        st().patchDoc({ selectedAnnot: hit.id }, docKey);
        useEditing.getState().set(hit.id);
        return;
      }
    }
    root.current!.setPointerCapture(e.pointerId);
    setDrag({ kind: "create", tool, start: p, cur: p, points: [p] });
  };

  const onRootMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (d?.kind === "erase") {
      eraseAt(local(e));
      return;
    }
    if (!d || d.kind !== "create") return;
    let p = local(e);
    if (e.shiftKey && (d.tool === "rect" || d.tool === "ellipse")) {
      const s = Math.max(Math.abs(p[0] - d.start[0]), Math.abs(p[1] - d.start[1]));
      p = [d.start[0] + Math.sign(p[0] - d.start[0]) * s, d.start[1] + Math.sign(p[1] - d.start[1]) * s];
    } else if (e.shiftKey && (d.tool === "line" || d.tool === "arrow")) {
      const ang = Math.round(Math.atan2(p[1] - d.start[1], p[0] - d.start[0]) / (Math.PI / 4)) * (Math.PI / 4);
      const len = Math.hypot(p[0] - d.start[0], p[1] - d.start[1]);
      p = [d.start[0] + Math.cos(ang) * len, d.start[1] + Math.sin(ang) * len];
    }
    setDrag({ ...d, cur: p, points: d.tool === "ink" ? [...d.points, local(e)] : d.points });
  };

  const onRootUp = () => {
    const d = dragRef.current;
    if (d?.kind === "erase") {
      setDrag(null);
      return;
    }
    if (!d || d.kind !== "create") return;
    setDrag(null);
    finishCreate(d);
  };

  /** One placed: the pointer is 選択 again, unless 続けて置く is on. */
  const backToSelect = () => {
    if (!st().sticky) st().setTool("select");
  };

  const finishCreate = (d: Extract<Drag, { kind: "create" }>) => {
    const inv = invert(matrix);
    const toPdf = (p: Point) => apply(inv, p);
    const dragged = Math.hypot(d.cur[0] - d.start[0], d.cur[1] - d.start[1]) > 4;
    const base = annotBase(d.tool);
    const add = (a: Annot, after?: () => void) => {
      st().commit((s) => addAnnot(s, uid, a), docKey);
      after?.();
    };
    switch (d.tool) {
      case "ink": {
        const pts = simplify(d.points, 0.6).map(toPdf);
        const flat = pts.flat();
        if (flat.length === 2) flat.push(flat[0] + 0.01, flat[1]);
        // Strokes a moment apart are one drawing (a signature, a word).
        if (lastInk && lastInk.uid === uid && Date.now() - lastInk.at < 1500) {
          const id = lastInk.id;
          st().commit((s) => updateAnnot(s, id, (a) => ({ paths: [...a.paths, flat] })), docKey);
          lastInk = { ...lastInk, at: Date.now() };
          return;
        }
        const a = { ...base, kind: "ink" as const, paths: [flat] };
        add(a);
        lastInk = { id: a.id, uid, at: Date.now() };
        return;
      }
      case "rect":
      case "ellipse": {
        const box: Rect = dragged
          ? normalize([d.start[0], d.start[1], d.cur[0], d.cur[1]])
          : [d.start[0] - 50 * px, d.start[1] - 30 * px, d.start[0] + 50 * px, d.start[1] + 30 * px];
        add({ ...base, kind: d.tool, rect: rectToPdf(matrix, box) }, () => {
          backToSelect();
          select(base.id);
        });
        return;
      }
      case "line":
      case "arrow": {
        const end: Point = dragged ? d.cur : [d.start[0] + 100 * px, d.start[1]];
        const [x1, y1] = toPdf(d.start);
        const [x2, y2] = toPdf(end);
        add({ ...base, kind: d.tool, line: [x1, y1, x2, y2] }, () => {
          backToSelect();
          select(base.id);
        });
        return;
      }
      case "note": {
        const box: Rect = [d.start[0], d.start[1], d.start[0] + 20 * px, d.start[1] + 20 * px];
        add({ ...base, kind: "note", rect: rectToPdf(matrix, box) }, () => {
          select(base.id);
          st().setTool("select");
          st().patchDoc({ selectedAnnot: base.id }, docKey);
        });
        return;
      }
      case "check":
      case "cross": {
        // The marks people make on paper, about 14pt across.
        const S = 7 * px;
        const [x, y] = d.start;
        const stroke = (pts: Point[]) => pts.map(toPdf).flat();
        const paths =
          d.tool === "check"
            ? [stroke([[x - S, y + 0.05 * S], [x - 0.35 * S, y + 0.8 * S], [x + S, y - 0.8 * S]])]
            : [stroke([[x - 0.8 * S, y - 0.8 * S], [x + 0.8 * S, y + 0.8 * S]]), stroke([[x + 0.8 * S, y - 0.8 * S], [x - 0.8 * S, y + 0.8 * S]])];
        add({ ...base, kind: "ink", paths }, () => {
          backToSelect();
          select(base.id);
        });
        return;
      }
      case "dot": {
        const r = 3.5 * px;
        const [x, y] = d.start;
        add({ ...base, kind: "ellipse", width: 0, fill: base.color, rect: rectToPdf(matrix, [x - r, y - r, x + r, y + r]) }, () => {
          backToSelect();
          select(base.id);
        });
        return;
      }
      case "dash": {
        const half = 10 * px;
        const [x, y] = d.start;
        const [x1, y1] = toPdf([x - half, y]);
        const [x2, y2] = toPdf([x + half, y]);
        add({ ...base, kind: "line", line: [x1, y1, x2, y2] }, () => {
          backToSelect();
          select(base.id);
        });
        return;
      }
      case "date": {
        const text = todayText();
        const w = (textWidth(text, base.fontSize) + 2 * (TEXT_PADDING + base.width) + 2) * px;
        const h = textHeight(1, base.fontSize, base.width) * px;
        const [x, y] = d.start;
        const a: Annot = { ...base, kind: "text", text, rotation, rect: rectToPdf(matrix, [x, y - h / 2, x + w, y + h / 2]) };
        add(a, () => {
          backToSelect();
          select(a.id);
        });
        return;
      }
      case "text":
      case "fill": {
        const width = dragged ? Math.abs(d.cur[0] - d.start[0]) : 180 * px;
        const left = Math.min(d.start[0], dragged ? d.cur[0] : d.start[0]);
        const top = Math.min(d.start[1], dragged ? d.cur[1] : d.start[1]);
        const height = Math.max(textHeight(1, base.fontSize, base.width) * px, dragged ? Math.abs(d.cur[1] - d.start[1]) : 0);
        const a: Annot = {
          ...base,
          kind: "text",
          // Upright as the page is shown now.
          rotation,
          rect: rectToPdf(matrix, [left, top, left + Math.max(width, 24 * px), top + height]),
        };
        st().checkpoint();
        st().amend((s) => addAnnot(s, uid, a));
        st().patchDoc({ selectedAnnot: a.id }, docKey);
        useEditing.getState().set(a.id, true);
        return;
      }
      case "seal": {
        const seal = st().pendingSeal;
        if (!seal) {
          st().toast("先に「印鑑・画像」で印を作ってください", true);
          st().setTool("select");
          return;
        }
        const [w, h] = [seal.size[0] * px, seal.size[1] * px];
        const [x, y] = d.start;
        const a: Annot = {
          ...base,
          kind: "seal",
          seal: seal.shape,
          text: seal.lines.join("\n"),
          color: seal.color,
          width: seal.width,
          fontSize: seal.fontSize,
          fill: null,
          rotation,
          rect: rectToPdf(matrix, [x - w / 2, y - h / 2, x + w / 2, y + h / 2]),
        };
        add(a, () => {
          backToSelect();
          select(a.id);
        });
        return;
      }
      case "image": {
        const img = st().pendingImage;
        if (!img) {
          st().toast("先に画像を選んでください", true);
          return;
        }
        const ratio = img.height / (img.width || 1);
        let box: Rect;
        if (dragged) {
          const w = Math.abs(d.cur[0] - d.start[0]);
          const x = Math.min(d.start[0], d.cur[0]);
          const y = Math.min(d.start[1], d.cur[1]);
          box = [x, y, x + w, y + w * ratio];
        } else {
          // About 3 cm on its long side: the size of a seal.
          const long = 85 * px;
          const w = ratio > 1 ? long / ratio : long;
          box = [d.start[0] - w / 2, d.start[1] - (w * ratio) / 2, d.start[0] + w / 2, d.start[1] + (w * ratio) / 2];
        }
        add({ ...base, kind: "image", image: img.id, rotation, rect: rectToPdf(matrix, box), width: 0 }, () => {
          backToSelect();
          select(base.id);
        });
        return;
      }
    }
  };

  // ----------------------------------------------------- drawing

  const s = px; // points → pixels
  const shapes: React.ReactNode[] = [];
  const boxes: React.ReactNode[] = [];
  for (const a of annots ?? []) {
    const hit = selecting && !readOnly ? "cursor-move" : "";
    const events = {
      "data-annot": a.id,
      onPointerDown: (e: React.PointerEvent) => onAnnotDown(e, a),
      onDoubleClick: (e: React.MouseEvent) => {
        if (!selecting || readOnly) return;
        e.stopPropagation();
        if (a.kind === "text") useEditing.getState().set(a.id);
      },
    };
    const stroke = a.color;
    const sw = Math.max(a.width * s, 0.5);
    switch (a.kind) {
      case "highlight":
      case "underline":
      case "strikeout": {
        const polys = a.quads.map((q) => {
          const pts = [0, 1, 3, 2].map((i) => apply(matrix, [q[i * 2], q[i * 2 + 1]]));
          return pts;
        });
        shapes.push(
          <g key={a.id} {...events} className={selecting ? "cursor-pointer" : ""} style={{ pointerEvents: selecting ? "auto" : "none" }}>
            {polys.map((pts, i) => {
              if (a.kind === "highlight") {
                return (
                  <polygon
                    key={i}
                    points={pts.map((p) => p.join(",")).join(" ")}
                    fill={a.color}
                    opacity={a.opacity}
                    style={{ mixBlendMode: "multiply" }}
                  />
                );
              }
              // pts: ul, ur, lr, ll
              const [ul, , lr, ll] = pts;
              const h = Math.hypot(ul[0] - ll[0], ul[1] - ll[1]) || 1;
              const up: Point = [(ul[0] - ll[0]) / h, (ul[1] - ll[1]) / h];
              const t = Math.max(h / 14, 0.6 * s);
              const at = a.kind === "underline" ? t / 2 + h * 0.04 : h * 0.45;
              return (
                <g key={i}>
                  <polygon points={pts.map((p) => p.join(",")).join(" ")} fill="transparent" />
                  <line
                    x1={ll[0] + up[0] * at}
                    y1={ll[1] + up[1] * at}
                    x2={lr[0] + up[0] * at}
                    y2={lr[1] + up[1] * at}
                    stroke={stroke}
                    strokeWidth={t}
                    opacity={a.opacity}
                  />
                </g>
              );
            })}
          </g>,
        );
        break;
      }
      case "ink":
        shapes.push(
          <g key={a.id} {...events} className={hit} opacity={a.opacity} style={{ pointerEvents: selecting ? "auto" : "none" }}>
            {a.paths.map((p, i) => {
              const pts: string[] = [];
              for (let k = 0; k + 1 < p.length; k += 2) pts.push(apply(matrix, [p[k], p[k + 1]]).join(","));
              return (
                <g key={i}>
                  <polyline points={pts.join(" ")} fill="none" stroke="transparent" strokeWidth={Math.max(sw, 10)} />
                  <polyline points={pts.join(" ")} fill="none" stroke={stroke} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" />
                </g>
              );
            })}
          </g>,
        );
        break;
      case "rect":
      case "ellipse": {
        if (!a.rect) break;
        const [x1, y1, x2, y2] = rectToScreen(matrix, a.rect);
        const i = (a.width * s) / 2;
        const common = {
          fill: a.fill ?? "transparent",
          stroke: a.width > 0 ? stroke : "none",
          strokeWidth: a.width * s,
        };
        shapes.push(
          <g key={a.id} {...events} className={hit} opacity={a.opacity} style={{ pointerEvents: selecting ? "auto" : "none" }}>
            {a.kind === "rect" ? (
              <rect x={x1 + i} y={y1 + i} width={Math.max(0, x2 - x1 - 2 * i)} height={Math.max(0, y2 - y1 - 2 * i)} {...common} />
            ) : (
              <ellipse cx={(x1 + x2) / 2} cy={(y1 + y2) / 2} rx={Math.max(0, (x2 - x1) / 2 - i)} ry={Math.max(0, (y2 - y1) / 2 - i)} {...common} />
            )}
            {/* Easier to grab than a thin outline. */}
            {!a.fill && <rect x={x1} y={y1} width={x2 - x1} height={y2 - y1} fill="none" stroke="transparent" strokeWidth={10} />}
          </g>,
        );
        break;
      }
      case "line":
      case "arrow": {
        if (!a.line) break;
        const p1 = apply(matrix, [a.line[0], a.line[1]]);
        const p2 = apply(matrix, [a.line[2], a.line[3]]);
        const head = (6 + a.width * 3) * s;
        const ang = Math.atan2(p2[1] - p1[1], p2[0] - p1[0]);
        const wing = (d: number): Point => [p2[0] - head * Math.cos(ang + d), p2[1] - head * Math.sin(ang + d)];
        shapes.push(
          <g key={a.id} {...events} className={hit} opacity={a.opacity} style={{ pointerEvents: selecting ? "auto" : "none" }}>
            <line x1={p1[0]} y1={p1[1]} x2={p2[0]} y2={p2[1]} stroke="transparent" strokeWidth={Math.max(sw, 12)} />
            <line x1={p1[0]} y1={p1[1]} x2={p2[0]} y2={p2[1]} stroke={stroke} strokeWidth={sw} strokeLinecap="round" />
            {a.kind === "arrow" && (
              <polyline
                points={[wing(0.5), p2, wing(-0.5)].map((p) => p.join(",")).join(" ")}
                fill="none"
                stroke={stroke}
                strokeWidth={sw}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            )}
          </g>,
        );
        break;
      }
      case "note": {
        if (!a.rect) break;
        const [x1, y1, x2, y2] = rectToScreen(matrix, a.rect);
        boxes.push(
          <div
            key={a.id}
            {...events}
            title={a.contents || "付箋"}
            className={`absolute ${selecting ? "cursor-pointer" : ""}`}
            style={{ left: x1, top: y1, width: x2 - x1, height: y2 - y1, opacity: a.opacity, pointerEvents: selecting ? "auto" : "none" }}
          >
            <svg viewBox="0 0 20 20" width="100%" height="100%">
              <path d="M2 1.5h16v12H9l-4.5 5 1-5H2z" fill={a.color} stroke="rgba(0,0,0,.45)" strokeWidth="1" strokeLinejoin="round" />
              <path d="M5 5.5h10M5 9.5h10" stroke="rgba(0,0,0,.55)" strokeWidth="1.2" />
            </svg>
          </div>,
        );
        break;
      }
      case "text":
      case "image":
      case "seal": {
        if (!a.rect) break;
        const r = rectToScreen(matrix, a.rect);
        const turn = screenTurn(rotation, a.rotation);
        const [rw, rh] = readingSize(a.rect, a.rotation);
        const style: React.CSSProperties = {
          left: (r[0] + r[2]) / 2,
          top: (r[1] + r[3]) / 2,
          width: rw * s,
          height: rh * s,
          transform: `translate(-50%, -50%) rotate(${turn}deg)`,
          opacity: a.opacity,
          pointerEvents: selecting ? "auto" : "none",
        };
        if (a.kind === "image") {
          boxes.push(
            <div key={a.id} {...events} className={`absolute ${hit}`} style={style}>
              {a.image !== null && <AnnotImage id={a.image} />}
            </div>,
          );
        } else if (a.kind === "seal") {
          boxes.push(
            <div key={a.id} {...events} className={`absolute ${hit}`} style={style}>
              <SealView a={a} w={rw} h={rh} />
            </div>,
          );
        } else {
          boxes.push(
            <TextBox
              key={a.id}
              a={a}
              s={s}
              style={style}
              editing={editing === a.id}
              className={hit}
              events={events}
              onGrow={(dh) => grow(a, dh)}
            />,
          );
        }
        break;
      }
    }
  }

  /** A text box grows downwards (as it reads) to fit what is typed. */
  const grow = (a: Annot, dh: number) => {
    if (!a.rect || dh <= 0) return;
    const r = [...a.rect] as Rect;
    switch (a.rotation) {
      case 90:
        r[2] += dh;
        break;
      case 180:
        r[3] += dh;
        break;
      case 270:
        r[0] -= dh;
        break;
      default:
        r[1] -= dh;
    }
    st().amend((x) => updateAnnot(x, a.id, { rect: r }));
  };

  // The selection's frame and handles.
  let frame: React.ReactNode = null;
  const sel = selected ? annots?.find((a) => a.id === selected) : null;
  if (sel && selecting) {
    const b = bounds(sel);
    if (b) {
      const [x1, y1, x2, y2] = rectToScreen(matrix, b);
      const pad = sel.kind === "highlight" || sel.kind === "underline" || sel.kind === "strikeout" ? 2 : 0;
      const handles = !readOnly && BOXED.has(sel.kind) && editing !== sel.id;
      frame = (
        <>
          <div
            className="pointer-events-none absolute border border-dashed border-accent"
            style={{ left: x1 - pad - 1, top: y1 - pad - 1, width: x2 - x1 + 2 * pad + 2, height: y2 - y1 + 2 * pad + 2 }}
          />
          {handles &&
            HANDLES.map((h) => {
              const hx = h.includes("w") ? x1 : h.includes("e") ? x2 : (x1 + x2) / 2;
              const hy = h.includes("n") ? y1 : h.includes("s") ? y2 : (y1 + y2) / 2;
              return (
                <div
                  key={h}
                  onPointerDown={(e) => onHandleDown(e, sel, h)}
                  className="absolute h-2.5 w-2.5 rounded-[2px] border border-accent bg-white"
                  style={{ left: hx - 5, top: hy - 5, cursor: `${h}-resize` }}
                />
              );
            })}
          {!readOnly &&
            sel.line &&
            [0, 1].map((end) => {
              const [hx, hy] = apply(matrix, [sel.line![end * 2], sel.line![end * 2 + 1]]);
              return (
                <div
                  key={end}
                  onPointerDown={(e) => onEndDown(e, sel, end as 0 | 1)}
                  className="absolute h-3 w-3 cursor-crosshair rounded-full border border-accent bg-white"
                  style={{ left: hx - 6, top: hy - 6 }}
                />
              );
            })}
        </>
      );
    }
  }

  // What is being drawn.
  let preview: React.ReactNode = null;
  if (drag?.kind === "create") {
    const style = st().styles[drag.tool];
    const [sx, sy] = drag.start;
    const [cx, cy] = drag.cur;
    const sw = Math.max(style.width * s, 1);
    if (drag.tool === "ink") {
      preview = (
        <polyline
          points={drag.points.map((p) => p.join(",")).join(" ")}
          fill="none"
          stroke={style.color}
          strokeWidth={sw}
          opacity={style.opacity}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      );
    } else if (drag.tool === "rect" || drag.tool === "text" || drag.tool === "image") {
      const [x1, y1, x2, y2] = normalize([sx, sy, cx, cy]);
      preview = (
        <rect
          x={x1}
          y={y1}
          width={x2 - x1}
          height={y2 - y1}
          fill={drag.tool === "rect" ? (style.fill ?? "none") : "color-mix(in srgb, var(--accent) 10%, transparent)"}
          stroke={drag.tool === "rect" ? style.color : "var(--accent)"}
          strokeWidth={drag.tool === "rect" ? sw : 1}
          strokeDasharray={drag.tool === "rect" ? undefined : "4 3"}
        />
      );
    } else if (drag.tool === "ellipse") {
      preview = (
        <ellipse
          cx={(sx + cx) / 2}
          cy={(sy + cy) / 2}
          rx={Math.abs(cx - sx) / 2}
          ry={Math.abs(cy - sy) / 2}
          fill={style.fill ?? "none"}
          stroke={style.color}
          strokeWidth={sw}
        />
      );
    } else if (drag.tool === "line" || drag.tool === "arrow") {
      preview = <line x1={sx} y1={sy} x2={cx} y2={cy} stroke={style.color} strokeWidth={sw} strokeLinecap="round" />;
    }
  }

  return (
    <div
      ref={root}
      className="absolute inset-0"
      style={{
        pointerEvents: drawing ? "auto" : "none",
        cursor: drawing ? (TYPING.includes(tool) ? "text" : tool === "eraser" ? "cell" : "crosshair") : undefined,
        zIndex: 3,
      }}
      onPointerDown={onRootDown}
      onPointerMove={onRootMove}
      onPointerUp={onRootUp}
    >
      <svg className="absolute inset-0 h-full w-full overflow-visible" style={{ pointerEvents: "none" }}>
        {shapes}
        {preview}
      </svg>
      {boxes}
      {frame}
      {sel && sel.kind === "note" && selecting && <NotePopup annot={sel} matrix={matrix} readOnly={readOnly} />}
    </div>
  );
});

/** A seal as lines and words (the same layout the file gets, lib/seal.ts). */
function SealView({ a, w, h }: { a: Annot; w: number; h: number }) {
  const shape = a.seal === "box" ? "box" : "round";
  const l = sealLayout(shape, w, h, a.fontSize, a.width, a.text.split("\n").map((t) => t.trim()));
  const i = a.width / 2;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" height="100%" className="pointer-events-none block" style={{ fontFamily: textFontFamily() }}>
      {shape === "round" ? (
        <ellipse cx={w / 2} cy={h / 2} rx={w / 2 - i} ry={h / 2 - i} fill="none" stroke={a.color} strokeWidth={a.width} />
      ) : (
        <rect x={i} y={i} width={w - a.width} height={h - a.width} fill="none" stroke={a.color} strokeWidth={a.width} />
      )}
      {l.dividers.map(([y, x1, x2], k) => (
        <line key={k} x1={x1} y1={h - y} x2={x2} y2={h - y} stroke={a.color} strokeWidth={a.width} />
      ))}
      {l.lines.map((line, k) => (
        <text key={k} x={line.x} y={h - line.y} fontSize={line.size} fill={a.color} dominantBaseline="central" style={{ fontKerning: "none" }}>
          {line.text}
        </text>
      ))}
    </svg>
  );
}

function AnnotImage({ id }: { id: number }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let gone = false;
    imageUrl(id).then((u) => !gone && setUrl(u), () => {});
    return () => {
      gone = true;
    };
  }, [id]);
  return url ? <img src={url} alt="" draggable={false} className="pointer-events-none h-full w-full select-none" /> : null;
}

/** A text box: its lines as they will be written, or a field while typing. */
function TextBox({
  a,
  s,
  style,
  editing,
  className,
  events,
  onGrow,
}: {
  a: Annot;
  s: number;
  style: React.CSSProperties;
  editing: boolean;
  className: string;
  events: Record<string, unknown>;
  onGrow: (dh: number) => void;
}) {
  const field = useRef<HTMLTextAreaElement>(null);
  const [rw, rh] = a.rect ? readingSize(a.rect, a.rotation) : [0, 0];
  const pad = TEXT_PADDING + a.width;
  const lines = wrapText(a.text, a.fontSize, rw - 2 * pad);
  /** This typing session has changed the text (and saved a step for undo). */
  const touched = useRef(false);
  const fresh = useRef(false);
  const was = useRef(editing);

  useLayoutEffect(() => {
    if (editing) {
      touched.current = false;
      fresh.current = useEditing.getState().fresh;
      field.current?.focus();
      const n = field.current?.value.length ?? 0;
      field.current?.setSelectionRange(n, n);
    }
  }, [editing]);

  // Finished typing: an empty box goes away (undo brings back what it was
  // before this typing, which for a new box is nothing).
  useEffect(() => {
    const ended = was.current && !editing;
    was.current = editing;
    if (!ended) return;
    const d = activeDoc(st());
    const now = d && Object.values(d.annots).flat().find((x) => x.id === a.id);
    if (now && !now.text.trim()) st().amend((x) => removeAnnot(x, a.id));
    if (TYPING.includes(st().tool) && !st().sticky) st().setTool("select");
  }, [editing, a.id]);

  const text: React.CSSProperties = {
    fontFamily: textFontFamily(),
    fontSize: a.fontSize * s,
    lineHeight: LINE_HEIGHT,
    color: a.color,
    padding: TEXT_PADDING * s,
    fontKerning: "none",
    whiteSpace: "pre",
  };
  return (
    <div
      {...events}
      className={`absolute overflow-hidden ${className}`}
      style={{
        ...style,
        background: a.fill ?? undefined,
        border: a.width > 0 ? `${a.width * s}px solid ${a.color}` : editing ? "1px dashed var(--accent)" : undefined,
        boxSizing: "border-box",
        overflow: "visible",
      }}
    >
      {editing ? (
        <textarea
          ref={field}
          value={a.text}
          spellCheck={false}
          onPointerDown={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            e.stopPropagation();
            // Esc while converting Japanese cancels the conversion only.
            if (e.key === "Escape" && !e.nativeEvent.isComposing && e.keyCode !== 229) useEditing.getState().set(null);
          }}
          onChange={(e) => {
            const value = e.target.value;
            if (!touched.current && !fresh.current) st().checkpoint();
            touched.current = true;
            st().amend((x) => updateAnnot(x, a.id, { text: value }));
            const need = textHeight(wrapText(value, a.fontSize, rw - 2 * pad).length, a.fontSize, a.width);
            if (need > rh + 0.01) onGrow(need - rh);
          }}
          onBlur={() => useEditing.getState().set(null)}
          className="block h-full w-full resize-none overflow-hidden bg-transparent outline-none"
          style={{ ...text, boxSizing: "border-box", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}
        />
      ) : (
        <div style={{ ...text, overflow: "hidden", height: "100%" }}>{lines.join("\n")}</div>
      )}
    </div>
  );
}

/** Delete / Backspace on a selected annotation; arrows nudge it. */
export function deleteSelectedAnnot() {
  const d = activeDoc(st());
  if (!d?.selectedAnnot || d.readOnly) return;
  const id = d.selectedAnnot;
  st().commit((x) => removeAnnot(x, id));
  st().patchDoc({ selectedAnnot: null });
}

export function bringToFront() {
  const d = activeDoc(st());
  if (!d?.selectedAnnot) return;
  const id = d.selectedAnnot;
  st().commit((x) => raiseAnnot(x, id));
}

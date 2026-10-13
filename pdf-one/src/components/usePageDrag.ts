import { useEffect, useRef, useState } from "react";
import { movePagesTo } from "../lib/actions";
import { activeDoc, useStore } from "../store";

const st = () => useStore.getState();

export interface PageDrag {
  uids: string[];
  /** Where the pointer is (client coordinates), for the label under it. */
  x: number;
  y: number;
  /** Drop position: before page `to`. */
  to: number;
}

/**
 * Reordering pages by dragging their thumbnails, with pointer events
 * (Platform UI §6: not HTML5 drag and drop, which doesn't work with the
 * window's file drop on Windows). Thumbnails carry `data-thumb-index`.
 */
export function usePageDrag(container: React.RefObject<HTMLElement | null>, axis: "y" | "grid") {
  const [drag, setDrag] = useState<PageDrag | null>(null);
  const press = useRef<{ uid: string; x: number; y: number } | null>(null);
  const dragRef = useRef<PageDrag | null>(null);
  dragRef.current = drag;
  const ended = useRef(0);

  const dropIndex = (x: number, y: number): number => {
    const els = Array.from(container.current?.querySelectorAll<HTMLElement>("[data-thumb-index]") ?? []);
    let best: { i: number; d: number; after: boolean } | null = null;
    for (const el of els) {
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const d = axis === "y" ? Math.abs(y - cy) : Math.hypot(x - cx, (y - cy) * 2);
      if (!best || d < best.d) best = { i: Number(el.dataset.thumbIndex), d, after: axis === "y" ? y > cy : x > cx };
    }
    return best ? best.i + (best.after ? 1 : 0) : 0;
  };

  useEffect(() => {
    let frame = 0;
    const onMove = (e: PointerEvent) => {
      const p = press.current;
      if (!p) return;
      if (!dragRef.current) {
        if (Math.hypot(e.clientX - p.x, e.clientY - p.y) < 6) return;
        const d = activeDoc(st());
        if (!d || d.readOnly) return;
        const uids = d.selectedPages.includes(p.uid) ? d.pages.filter((x) => d.selectedPages.includes(x.uid)).map((x) => x.uid) : [p.uid];
        document.body.style.cursor = "grabbing";
        setDrag({ uids, x: e.clientX, y: e.clientY, to: dropIndex(e.clientX, e.clientY) });
        return;
      }
      setDrag({ ...dragRef.current, x: e.clientX, y: e.clientY, to: dropIndex(e.clientX, e.clientY) });
      // Near the edge, the list scrolls.
      cancelAnimationFrame(frame);
      const el = container.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const edge = 40;
      const speed = e.clientY < r.top + edge ? -12 : e.clientY > r.bottom - edge ? 12 : 0;
      if (speed) {
        const step = () => {
          el.scrollTop += speed;
          frame = requestAnimationFrame(step);
        };
        frame = requestAnimationFrame(step);
      }
    };
    const onUp = () => {
      cancelAnimationFrame(frame);
      const d = dragRef.current;
      press.current = null;
      if (!d) return;
      ended.current = performance.now();
      document.body.style.cursor = "";
      setDrag(null);
      movePagesTo(d.uids, d.to);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
    // dropIndex reads the DOM; it needs no re-binding.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onPointerDown = (e: React.PointerEvent, uid: string) => {
    if (e.button !== 0) return;
    press.current = { uid, x: e.clientX, y: e.clientY };
  };

  /** A drag that just ended shouldn't also count as a click. */
  const wasDrag = () => performance.now() - ended.current < 300;

  return { drag, onPointerDown, wasDrag };
}

/** Click on a thumbnail: pick it, add it (⌘ / Ctrl), or a range (Shift). */
export function pickPage(uid: string, e: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }, mac: boolean) {
  const d = activeDoc(st());
  if (!d) return;
  const toggle = mac ? e.metaKey : e.ctrlKey;
  let next: string[];
  if (e.shiftKey && d.selectedPages.length) {
    const a = d.pages.findIndex((p) => p.uid === d.selectedPages[d.selectedPages.length - 1]);
    const b = d.pages.findIndex((p) => p.uid === uid);
    const [lo, hi] = a < b ? [a, b] : [b, a];
    next = d.pages.slice(lo, hi + 1).map((p) => p.uid);
  } else if (toggle) {
    next = d.selectedPages.includes(uid) ? d.selectedPages.filter((u) => u !== uid) : [...d.selectedPages, uid];
  } else {
    next = [uid];
  }
  st().patchDoc({ selectedPages: next });
}

import { ChevronDown, ChevronUp, Copy, Highlighter, Strikethrough, Underline } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { AnnotKind } from "../lib/api";
import { addAnnot } from "../lib/edit";
import { CSS_PER_PT, apply, quadsFromRects, viewportTransform, type Rect } from "../lib/geometry";
import { clampScale, fitScale, layout, pageAt, type PageGeom } from "../lib/layout";
import { selectionPage, selectionQuads } from "../lib/markup";
import { activeDoc, newAnnotId, useStore, type Doc, type SearchMatch } from "../store";
import { useEditing } from "./Overlay";
import { PageView } from "./PageView";

const st = () => useStore.getState();
const MARKUP: AnnotKind[] = ["highlight", "underline", "strikeout"];

/** The screen transform of a laid-out page. */
const matrixOf = (g: PageGeom, scale: number) => viewportTransform(g.view, scale * CSS_PER_PT, g.rotation);

/** Marks the text selected on a page (or `area`, a dragged box there). */
function markup(kind: AnnotKind, d: Doc, geoms: PageGeom[], area?: { uid: string; box: Rect }) {
  const pageEl = area ? null : selectionPage();
  const uid = area?.uid ?? pageEl?.dataset.pageUid;
  const g = geoms.find((x) => x.uid === uid);
  if (!g || !uid) return false;
  const m = matrixOf(g, d.scale);
  let quads: number[][];
  if (area) {
    quads = quadsFromRects(m, [area.box], 0);
  } else {
    const r = selectionQuads(pageEl!, m);
    if (!r) return false;
    quads = r.quads;
  }
  const style = st().styles[kind as "highlight"];
  st().commit((s) =>
    addAnnot(s, uid, {
      id: newAnnotId(),
      kind,
      color: style.color,
      opacity: style.opacity,
      width: 1,
      fill: null,
      rect: null,
      quads,
      paths: [],
      line: null,
      text: "",
      lines: [],
      fontSize: 12,
      rotation: 0,
      image: null,
      seal: null,
      runs: [],
      contents: "",
      author: st().author,
      modified: "",
    }),
  );
  window.getSelection()?.removeAllRanges();
  return true;
}

/** The pages of the active tab, one under the other. */
export function Viewer({ d }: { d: Doc }) {
  const scroller = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [scrollTop, setScrollTop] = useState(0);
  const tool = useStore((s) => s.tool);
  const search = useStore((s) => s.search);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  // The zoom as a number for the window's size. "Fit" fits the page in view
  // when the mode or the window changes, and stays as it is while scrolling
  // (see fitScale). Shown again (after the page organizer, another tab), the
  // view fits the same page as before, so coming back doesn't change the zoom.
  const page = useRef(d.page);
  page.current = d.page;
  /** The view has been laid out at its real size once (set below). */
  const sized = useRef(false);
  const { scale, fitPage } = useMemo(() => {
    if (!size.w) return { scale: d.scale, fitPage: d.fitPage };
    const base = Math.min(sized.current ? page.current : d.fitPage, d.pages.length - 1);
    return { scale: fitScale(d.zoom, d.pages, base, size.w, size.h, d.viewRotate), fitPage: base };
    // Not d.page: scrolling to another page doesn't refit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d.zoom, d.pages, size.w, size.h, d.viewRotate]);
  useEffect(() => {
    if (Math.abs(scale - d.scale) > 1e-4 || fitPage !== d.fitPage) st().patchDoc({ scale, fitPage }, d.key);
  }, [scale, fitPage, d.scale, d.fitPage, d.key]);

  const lay = useMemo(() => layout(d.pages, scale, size.w, d.viewRotate), [d.pages, scale, size.w, d.viewRotate]);

  // Keep the same place in view when the zoom changes: the point under the
  // pointer (wheel) or the middle of the view.
  const anchor = useRef<{ x: number; y: number; scale: number; top: number; left: number } | null>(null);
  const lastScale = useRef(scale);
  // Before the view is laid out at its real size, a zoom change is no move.
  useLayoutEffect(() => {
    const el = scroller.current;
    const prev = lastScale.current;
    lastScale.current = scale;
    const first = !sized.current;
    if (size.w > 0) sized.current = true;
    if (first && el && size.w > 0) {
      // Back to the spot the tab was on (after the page organizer, another tab).
      const g = lay.geoms[page.current];
      if (g) el.scrollTop = g.top + d.pageOffset * g.height;
      return;
    }
    if (!el || prev === scale) return;
    const a = anchor.current ?? { x: el.clientWidth / 2, y: el.clientHeight / 2, scale: prev, top: el.scrollTop, left: el.scrollLeft };
    anchor.current = null;
    const k = scale / a.scale;
    el.scrollTop = (a.top + a.y) * k - a.y;
    el.scrollLeft = (a.left + a.x) * k - a.x;
    // Only the zoom and the first real size move the view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scale, size.w]);

  // Hidden (the page organizer, another tab): remember the spot to come back to.
  const geoms = useRef(lay.geoms);
  geoms.current = lay.geoms;
  useLayoutEffect(() => {
    const el = scroller.current;
    const key = d.key;
    return () => {
      const doc = st().docs.find((x) => x.key === key);
      const g = doc && geoms.current[doc.page];
      if (el && g && sized.current) st().patchDoc({ pageOffset: (el.scrollTop - g.top) / g.height }, key);
    };
  }, [d.key]);

  // ⌘ / Ctrl + wheel (and the trackpad's pinch) zooms at the pointer.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const doc = activeDoc(st());
      if (!doc) return;
      const r = el.getBoundingClientRect();
      const next = clampScale(doc.scale * Math.exp(-e.deltaY * 0.0025));
      anchor.current = { x: e.clientX - r.left, y: e.clientY - r.top, scale: doc.scale, top: el.scrollTop, left: el.scrollLeft };
      st().patchDoc({ zoom: { mode: "scale", value: next } });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // The page in view.
  const onScroll = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    setScrollTop(el.scrollTop);
    const p = pageAt(lay.geoms, el.scrollTop, el.clientHeight);
    if (p !== activeDoc(st())?.page) st().patchDoc({ page: p }, d.key);
  }, [lay.geoms, d.key]);

  // Asked to show a page (thumbnails, search, links, page number). A request
  // made before this view was shown (another tab, the page organizer) is
  // done already: the view comes back to the page the tab was on instead.
  const handled = useRef(d.scrollTo?.seq ?? 0);
  useEffect(() => {
    const el = scroller.current;
    const req = d.scrollTo;
    if (!el || !req || req.seq === handled.current) return;
    handled.current = req.seq;
    const g = lay.geoms[req.page];
    if (!g) return;
    let top = g.top - 8;
    if (req.y !== undefined) {
      const [, y] = apply(matrixOf(g, scale), [g.view[0], req.y]);
      top = g.top + y - 24;
    }
    el.scrollTo({ top, behavior: "auto" });
    st().patchDoc({ page: req.page }, d.key);
    // Only a new request moves the view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d.scrollTo?.seq]);

  // Every page has a blank sheet, so a fast scroll (the OS scrolls before
  // onScroll comes) shows white pages, not the background, until the pages
  // near the view are drawn over them.
  const sheets = useMemo(
    () =>
      lay.geoms.map((g) => (
        <div
          key={g.uid}
          className="absolute bg-white shadow-md"
          style={{ left: g.left, top: g.top, width: g.width, height: g.height }}
        />
      )),
    [lay.geoms],
  );

  // The pages near the view are drawn over their sheets.
  const visible = useMemo(() => {
    const from = scrollTop - size.h;
    const to = scrollTop + size.h * 2;
    return lay.geoms.map((g, i) => ({ g, i })).filter(({ g }) => g.top + g.height >= from && g.top <= to);
  }, [lay.geoms, scrollTop, size.h]);

  const matchesByPage = useMemo(() => {
    const m = new Map<string, SearchMatch[]>();
    if (!search.open) return m;
    for (const r of search.results) {
      const list = m.get(r.uid) ?? [];
      list.push(r);
      m.set(r.uid, list);
    }
    return m;
  }, [search.open, search.results]);
  const current = search.open ? (search.results[search.current] ?? null) : null;

  // The hand tool, and the space bar held: dragging moves the view.
  const space = useRef(false);
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.code === "Space" && !(t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) {
        space.current = true;
        if (scroller.current) scroller.current.style.cursor = "grab";
        e.preventDefault();
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        space.current = false;
        if (scroller.current) scroller.current.style.cursor = "";
      }
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  /** Where a press started: for dragging the view, or a box to mark. */
  const press = useRef<{ x: number; y: number; top: number; left: number; pan: boolean; uid?: string; px?: number; py?: number } | null>(
    null,
  );
  const [popup, setPopup] = useState<{ x: number; y: number } | null>(null);

  const onPointerDown = (e: React.PointerEvent) => {
    const el = scroller.current!;
    setPopup(null);
    const pan = tool === "hand" || space.current || e.button === 1;
    const target = e.target as HTMLElement;
    const pageEl = target.closest<HTMLElement>("[data-page-uid]");
    let pagePt: { uid?: string; px?: number; py?: number } = {};
    if (pageEl) {
      const r = pageEl.getBoundingClientRect();
      pagePt = { uid: pageEl.dataset.pageUid, px: e.clientX - r.left, py: e.clientY - r.top };
    }
    press.current = { x: e.clientX, y: e.clientY, top: el.scrollTop, left: el.scrollLeft, pan, ...pagePt };
    if (pan) {
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      el.style.cursor = "grabbing";
      return;
    }
    // A press on the page (not on an annotation or a field) lets go of
    // the selected annotation.
    if (tool === "select" && !target.closest("[data-annot], .annotationLayer section, textarea, input, select")) {
      if (activeDoc(st())?.selectedAnnot) st().patchDoc({ selectedAnnot: null });
      if (useEditing.getState().id) useEditing.getState().set(null);
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const p = press.current;
    if (!p?.pan) return;
    const el = scroller.current!;
    el.scrollTop = p.top - (e.clientY - p.y);
    el.scrollLeft = p.left - (e.clientX - p.x);
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const p = press.current;
    press.current = null;
    const el = scroller.current!;
    if (p?.pan) {
      el.style.cursor = space.current ? "grab" : "";
      return;
    }
    if (d.readOnly) return;
    const kind = tool as AnnotKind;
    if (MARKUP.includes(kind)) {
      if (markup(kind, d, lay.geoms)) return;
      // No text there (a scan): the dragged box is marked instead.
      if (p?.uid && p.px !== undefined && p.py !== undefined) {
        const pageEl = el.querySelector<HTMLElement>(`[data-page-uid="${p.uid}"]`);
        const r = pageEl?.getBoundingClientRect();
        if (r) {
          const x2 = e.clientX - r.left;
          const y2 = e.clientY - r.top;
          if (Math.abs(x2 - p.px) > 4 && Math.abs(y2 - p.py) > 4) {
            const box: Rect = [Math.min(p.px, x2), Math.min(p.py, y2), Math.max(p.px, x2), Math.max(p.py, y2)];
            markup(kind, d, lay.geoms, { uid: p.uid, box });
          }
        }
      }
      return;
    }
    // Text selected with the select tool: offer to mark it.
    if (tool === "select") {
      const pageEl = selectionPage();
      const sel = window.getSelection();
      if (pageEl && sel && sel.rangeCount) {
        const rects = sel.getRangeAt(0).getClientRects();
        const last = rects[rects.length - 1];
        const box = el.getBoundingClientRect();
        if (last) setPopup({ x: last.right - box.left + el.scrollLeft, y: last.bottom - box.top + el.scrollTop + 6 });
      }
    }
  };

  const cursor = tool === "hand" ? "grab" : undefined;
  return (
    <div
      ref={scroller}
      className="pdfViewer relative min-h-0 min-w-0 flex-1 overflow-auto bg-canvas outline-none"
      style={{ cursor }}
      onScroll={onScroll}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      data-tool={tool}
      tabIndex={-1}
    >
      <div className="relative" style={{ width: lay.width, height: lay.height }}>
        {sheets}
        {visible.map(({ g, i }) => (
          <PageView
            key={g.uid}
            docKey={d.key}
            item={d.pages[i]}
            geom={g}
            scale={scale}
            pageNumber={i + 1}
            readOnly={!!d.readOnly}
            matches={matchesByPage.get(g.uid) ?? NONE}
            currentMatch={current?.uid === g.uid ? current : null}
          />
        ))}
        {popup && !d.readOnly && <SelectionPopup at={popup} onPick={(k) => (k ? markup(k, d, lay.geoms) : copySelection()) && setPopup(null)} />}
      </div>
    </div>
  );
}

const NONE: SearchMatch[] = [];

/** Up and down through search results, from the search bar. */
export function SearchNav({ onPrev, onNext }: { onPrev: () => void; onNext: () => void }) {
  return (
    <>
      <button onClick={onPrev} className="rounded p-1 hover:bg-hover" aria-label="前を検索" title="前を検索">
        <ChevronUp size={15} />
      </button>
      <button onClick={onNext} className="rounded p-1 hover:bg-hover" aria-label="次を検索" title="次を検索">
        <ChevronDown size={15} />
      </button>
    </>
  );
}

function copySelection() {
  const text = window.getSelection()?.toString() ?? "";
  if (text) void navigator.clipboard.writeText(text).then(() => st().notify({ title: "コピーしました", duration: 1500 }));
  return true;
}

/** After selecting text: mark it, or copy it. */
function SelectionPopup({ at, onPick }: { at: { x: number; y: number }; onPick: (k: AnnotKind | null) => void }) {
  const items: { k: AnnotKind | null; label: string; icon: typeof Copy }[] = [
    { k: "highlight", label: "マーカー", icon: Highlighter },
    { k: "underline", label: "下線", icon: Underline },
    { k: "strikeout", label: "取り消し線", icon: Strikethrough },
    { k: null, label: "コピー", icon: Copy },
  ];
  return (
    <div
      className="absolute z-20 flex animate-fade-in gap-0.5 rounded-lg border border-line bg-panel p-1 shadow-xl"
      style={{ left: at.x - 70, top: at.y }}
      onPointerDown={(e) => {
        e.stopPropagation();
        e.preventDefault();
      }}
      onPointerUp={(e) => e.stopPropagation()}
    >
      {items.map(({ k, label, icon: Icon }) => (
        <button
          key={label}
          title={label}
          aria-label={label}
          onClick={() => onPick(k)}
          className="flex h-8 items-center gap-1 rounded-md px-2 text-sm text-fg hover:bg-hover"
        >
          <Icon size={14} />
          {label}
        </button>
      ))}
    </div>
  );
}

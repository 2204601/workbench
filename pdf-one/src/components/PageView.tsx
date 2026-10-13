import { AnnotationLayer, AnnotationMode, TextLayer, type PDFPageProxy, type RenderTask } from "pdfjs-dist";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { CSS_PER_PT, viewportTransform } from "../lib/geometry";
import type { PageGeom } from "../lib/layout";
import { makeLinkService } from "../lib/links";
import { warn } from "../lib/log";
import { getSource } from "../lib/pdfjs";
import { useStore, type PageItem, type SearchMatch } from "../store";
import { Overlay } from "./Overlay";

/** Canvases larger than this (pixels) are drawn at a lower resolution. */
const MAX_CANVAS = 4096 * 4096;

/**
 * One page: pdf.js draws it on a canvas, with its text (for selecting and
 * searching) and its form fields and links in layers over it; our
 * annotations and tools are over those (Overlay).
 */
export const PageView = memo(function PageView({
  docKey,
  item,
  geom,
  scale,
  pageNumber,
  readOnly,
  matches,
  currentMatch,
}: {
  docKey: string;
  item: PageItem;
  geom: PageGeom;
  scale: number;
  pageNumber: number;
  readOnly: boolean;
  matches: SearchMatch[];
  /** The match search is on, if it is on this page. */
  currentMatch: SearchMatch | null;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState<PDFPageProxy | null>(null);
  const [textLayer, setTextLayer] = useState<TextLayer | null>(null);
  const px = scale * CSS_PER_PT;
  const matrix = useMemo(() => viewportTransform(geom.view, px, geom.rotation), [geom.view, px, geom.rotation]);

  useEffect(() => {
    if (item.source === null) return;
    let gone = false;
    getSource(item.source)
      ?.pdf.getPage(item.index + 1)
      .then((p) => !gone && setPage(p))
      .catch((e) => warn("page", e));
    return () => {
      gone = true;
    };
  }, [item.source, item.index]);

  // The picture: drawn again a moment after the zoom stops changing; the
  // old one is stretched meanwhile.
  const drawn = useRef(false);
  useEffect(() => {
    if (!page || !wrap.current) return;
    let task: RenderTask | null = null;
    let gone = false;
    const draw = () => {
      const viewport = page.getViewport({ scale: px, rotation: geom.rotation });
      const want = window.devicePixelRatio || 1;
      const ratio = Math.min(want, Math.sqrt(MAX_CANVAS / (viewport.width * viewport.height)));
      const canvas = document.createElement("canvas");
      canvas.width = Math.floor(viewport.width * ratio);
      canvas.height = Math.floor(viewport.height * ratio);
      task = page.render({
        canvas,
        viewport,
        transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : undefined,
        annotationMode: AnnotationMode.ENABLE_FORMS,
      });
      task.promise.then(
        () => {
          if (gone || !wrap.current) return;
          wrap.current.replaceChildren(canvas);
          drawn.current = true;
        },
        (e) => {
          if ((e as Error)?.name !== "RenderingCancelledException") warn("render", e);
        },
      );
    };
    const t = setTimeout(draw, drawn.current ? 150 : 0);
    return () => {
      gone = true;
      clearTimeout(t);
      task?.cancel();
    };
  }, [page, px, geom.rotation]);

  // The text, for selecting and searching. Laid out again after a zoom.
  useEffect(() => {
    const div = textRef.current;
    if (!page || !div) return;
    div.replaceChildren();
    const layer = new TextLayer({
      textContentSource: page.streamTextContent({ includeMarkedContent: true, disableNormalization: true }),
      container: div,
      viewport: page.getViewport({ scale: px, rotation: geom.rotation }),
    });
    let gone = false;
    layer.render().then(
      () => {
        if (gone) return;
        // pdf.js's own viewer adds this so a drag past the text selects to
        // the end rather than jumping around.
        const end = document.createElement("div");
        end.className = "endOfContent";
        div.append(end);
        setTextLayer(layer);
      },
      (e) => warn("text layer", e),
    );
    return () => {
      gone = true;
      layer.cancel();
      setTextLayer(null);
    };
    // The zoom is handled by `update` below, not by a new layer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, geom.rotation]);
  useEffect(() => {
    if (!page || !textLayer) return;
    const t = setTimeout(() => textLayer.update({ viewport: page.getViewport({ scale: px, rotation: geom.rotation }) }), 150);
    return () => clearTimeout(t);
  }, [page, textLayer, px, geom.rotation]);

  // Form fields and links.
  useEffect(() => {
    const div = formRef.current;
    if (!page || !div || item.source === null) return;
    const source = getSource(item.source);
    if (!source) return;
    div.replaceChildren();
    let gone = false;
    const viewport = page.getViewport({ scale: px, rotation: geom.rotation }).clone({ dontFlip: true });
    const linkService = makeLinkService(item.source);
    page
      .getAnnotations({ intent: "display" })
      .then((annotations) => {
        if (gone || !annotations.length) return;
        const layer = new AnnotationLayer({
          div,
          accessibilityManager: null,
          annotationCanvasMap: null,
          annotationEditorUIManager: null,
          page,
          viewport,
          structTreeLayer: null,
          commentManager: null,
          linkService,
          annotationStorage: source.pdf.annotationStorage,
        });
        return layer.render({
          annotations,
          div,
          page,
          viewport,
          linkService,
          annotationStorage: source.pdf.annotationStorage,
          renderForms: true,
          enableScripting: false,
          hasJSActions: false,
          fieldObjects: null,
        });
      })
      .then(() => {
        // Read-only files: fields show their values but can't be changed.
        if (readOnly) div.querySelectorAll<HTMLInputElement>("input, textarea, select").forEach((el) => (el.disabled = true));
      })
      .catch((e) => warn("annotation layer", e));
    return () => {
      gone = true;
    };
    // Only the rotation changes the layout; the zoom is a CSS variable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, geom.rotation, item.source, readOnly]);

  // While text is being selected, pdf.js's end-of-content block covers the
  // layer so a drag past the last line doesn't jump back (its viewer does
  // the same: TextLayerBuilder).
  useEffect(() => {
    const div = textRef.current;
    if (!div) return;
    const down = () => div.classList.add("selecting");
    const up = () => div.classList.remove("selecting");
    div.addEventListener("pointerdown", down);
    window.addEventListener("pointerup", up);
    return () => {
      div.removeEventListener("pointerdown", down);
      window.removeEventListener("pointerup", up);
    };
  }, []);

  // A value typed into a field makes the tab unsaved.
  useEffect(() => {
    const div = formRef.current;
    if (!div || readOnly) return;
    const changed = () => {
      const d = useStore.getState().docs.find((x) => x.key === docKey);
      if (d && !d.dirty) useStore.getState().patchDoc({ dirty: true }, docKey);
    };
    div.addEventListener("input", changed);
    div.addEventListener("change", changed);
    return () => {
      div.removeEventListener("input", changed);
      div.removeEventListener("change", changed);
    };
  }, [docKey, readOnly]);

  // Search hits: boxes over the text of each match.
  const [hits, setHits] = useState<{ x: number; y: number; w: number; h: number; current: boolean }[]>([]);
  useEffect(() => {
    if (!textLayer || !matches.length || !wrap.current) {
      setHits([]);
      return;
    }
    const t = setTimeout(() => {
      const box = wrap.current?.parentElement?.getBoundingClientRect();
      if (!box) return;
      const divs = textLayer.textDivs;
      const out: typeof hits = [];
      for (const m of matches) {
        for (const part of m.parts) {
          const node = divs[part.item]?.firstChild;
          if (!node || node.nodeType !== Node.TEXT_NODE) continue;
          const len = node.textContent?.length ?? 0;
          const range = document.createRange();
          range.setStart(node, Math.min(part.start, len));
          range.setEnd(node, Math.min(part.end, len));
          for (const r of Array.from(range.getClientRects())) {
            out.push({ x: r.left - box.left, y: r.top - box.top, w: r.width, h: r.height, current: m === currentMatch });
          }
        }
      }
      setHits(out);
    }, 160);
    return () => clearTimeout(t);
  }, [textLayer, matches, currentMatch, px]);

  return (
    <div
      className="page absolute bg-white shadow-lg shadow-black/40"
      data-page-uid={item.uid}
      data-page-number={pageNumber}
      style={
        {
          left: geom.left,
          top: geom.top,
          width: geom.width,
          height: geom.height,
          "--scale-factor": px,
          "--user-unit": 1,
          "--total-scale-factor": px,
          "--scale-round-x": "1px",
          "--scale-round-y": "1px",
        } as React.CSSProperties
      }
    >
      <div ref={wrap} className="canvasWrapper absolute inset-0 overflow-hidden" />
      <div ref={textRef} className="textLayer" />
      <div ref={formRef} className="annotationLayer" />
      {hits.length > 0 && (
        <div className="pointer-events-none absolute inset-0">
          {hits.map((h, i) => (
            <div
              key={i}
              className={`absolute rounded-[2px] ${h.current ? "bg-[#ff7a00]/45 outline-2 outline-[#ff7a00]" : "bg-[#ffd400]/40"}`}
              style={{ left: h.x - 1, top: h.y - 1, width: h.w + 2, height: h.h + 2, mixBlendMode: "multiply" }}
            />
          ))}
        </div>
      )}
      <Overlay docKey={docKey} uid={item.uid} matrix={matrix} rotation={geom.rotation} px={px} readOnly={readOnly} />
    </div>
  );
});

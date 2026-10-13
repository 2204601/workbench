/**
 * 印刷 (docs/SPEC.md「印刷」): the pages are drawn as pictures with pdf.js,
 * annotations and typed values included, laid on sheets of the chosen
 * paper in a part of the page only print media shows, and handed to the
 * OS's print dialog with window.print(). Printer, copies and two-sided
 * printing are the dialog's.
 *
 * The pictures come from the file as it would be saved (Rust composes it,
 * api.composePdf), so what prints is what Acrobat would print.
 */
import { AnnotationMode } from "pdfjs-dist";
import { api } from "./api";
import { buildPages, formValues } from "./actions";
import { warn } from "./log";
import { getSource, loadBytes } from "./pdfjs";
import { useStore, type Doc } from "../store";

const st = () => useStore.getState();

/** Paper sizes in millimetres (JIS B sizes, as Japanese printers have them). */
export const PAPERS: Record<string, { label: string; w: number; h: number }> = {
  a4: { label: "A4", w: 210, h: 297 },
  a3: { label: "A3", w: 297, h: 420 },
  b5: { label: "B5", w: 182, h: 257 },
  b4: { label: "B4", w: 257, h: 364 },
  letter: { label: "レター", w: 216, h: 279 },
};

export interface PrintOptions {
  /** Indexes of the tab's pages to print, in order. */
  pages: number[];
  paper: keyof typeof PAPERS;
  /** Scale each page to the sheet (else its real size). */
  fit: boolean;
  perSheet: 1 | 2;
  orientation: "auto" | "portrait" | "landscape";
  /** Annotations and typed values included. */
  withMarks: boolean;
}

/** "1-3, 5" → [0, 1, 2, 4] within `count` pages; null when it makes no sense. */
export function parseRange(text: string, count: number): number[] | null {
  const out = new Set<number>();
  for (const part of text.replace(/[－ー‐–—]/g, "-").replace(/[、，]/g, ",").split(",")) {
    const t = part.trim().normalize("NFKC");
    if (!t) continue;
    const m = /^(\d+)(?:\s*-\s*(\d+))?$/.exec(t);
    if (!m) return null;
    const a = Number(m[1]);
    const b = m[2] ? Number(m[2]) : a;
    if (a < 1 || b < a || a > count) return null;
    for (let i = a; i <= Math.min(b, count); i++) out.add(i - 1);
  }
  return out.size ? [...out].sort((x, y) => x - y) : null;
}

/** A page drawn for printing: its picture and its size in millimetres. */
interface Printed {
  url: string;
  w: number;
  h: number;
}

const MM_PER_PT = 25.4 / 72;

/** Draws the pages. Big documents are drawn smaller and as JPEG, to fit in memory. */
async function draw(d: Doc, o: PrintOptions, progress: (done: number, total: number) => void): Promise<Printed[]> {
  const n = o.pages.length;
  const dpi = n > 50 ? 110 : 150;
  const jpeg = n > 20;
  const scale = dpi / 72;
  let composed: { pdf: Awaited<ReturnType<typeof loadBytes>["promise"]>; destroy: () => Promise<void> } | null = null;
  if (o.withMarks && !d.readOnly) {
    const bytes = await api.composePdf({ pages: buildPages(d), forms: formValues(d) });
    const task = loadBytes(bytes);
    composed = { pdf: await task.promise, destroy: () => task.destroy() };
  }
  const out: Printed[] = [];
  try {
    for (const [k, i] of o.pages.entries()) {
      const item = d.pages[i];
      let page = null;
      let rotation: number | undefined;
      if (composed) {
        page = await composed.pdf.getPage(i + 1);
      } else if (item.source !== null) {
        page = await getSource(item.source)?.pdf.getPage(item.index + 1);
        if (page) rotation = page.rotate + item.rotate;
      }
      const canvas = document.createElement("canvas");
      let w: number;
      let h: number;
      if (page) {
        const viewport = page.getViewport({ scale, rotation });
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        await page.render({ canvas, viewport, annotationMode: AnnotationMode.ENABLE_STORAGE }).promise;
        w = (viewport.width / scale) * MM_PER_PT;
        h = (viewport.height / scale) * MM_PER_PT;
      } else {
        // A blank page.
        const [pw, ph] = item.size ?? [595.276, 841.89];
        const turned = item.rotate % 180 !== 0;
        [w, h] = turned ? [ph * MM_PER_PT, pw * MM_PER_PT] : [pw * MM_PER_PT, ph * MM_PER_PT];
        canvas.width = Math.ceil((w / MM_PER_PT) * scale);
        canvas.height = Math.ceil((h / MM_PER_PT) * scale);
        const ctx = canvas.getContext("2d")!;
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
      const blob = await new Promise<Blob | null>((r) => (jpeg ? canvas.toBlob(r, "image/jpeg", 0.9) : canvas.toBlob(r, "image/png")));
      canvas.width = canvas.height = 0;
      if (!blob) throw new Error("ページの絵を作れませんでした");
      out.push({ url: URL.createObjectURL(blob), w, h });
      progress(k + 1, n);
    }
  } finally {
    await composed?.destroy().catch(() => {});
  }
  return out;
}

/** The sheets as HTML in the print root, and the @page rule for the paper. */
function layOut(pages: Printed[], o: PrintOptions): HTMLElement {
  const paper = PAPERS[o.paper];
  const landscape =
    o.orientation === "landscape" || (o.orientation === "auto" && (o.perSheet === 2 || (pages[0] && pages[0].w > pages[0].h)));
  const [sw, sh] = landscape ? [paper.h, paper.w] : [paper.w, paper.h];
  const root = document.createElement("div");
  root.id = "print-root";
  const style = document.createElement("style");
  // 6 mm in from the edge: what most printers can't reach anyway.
  style.textContent = `@page { size: ${sw}mm ${sh}mm; margin: 0; }
#print-root .sheet { width: ${sw}mm; height: ${sh}mm; box-sizing: border-box; padding: 6mm; display: flex; align-items: center; justify-content: center; gap: 6mm; overflow: hidden; break-after: page; page-break-after: always; }
#print-root .sheet:last-child { break-after: auto; page-break-after: auto; }
#print-root img { display: block; object-fit: contain; }`;
  root.append(style);
  const per = o.perSheet;
  for (let i = 0; i < pages.length; i += per) {
    const sheet = document.createElement("div");
    sheet.className = "sheet";
    for (const p of pages.slice(i, i + per)) {
      const img = document.createElement("img");
      img.src = p.url;
      img.alt = "";
      if (o.fit) {
        img.style.maxWidth = per === 2 ? "calc(50% - 3mm)" : "100%";
        img.style.maxHeight = "100%";
      } else {
        img.style.width = `${p.w}mm`;
        img.style.height = `${p.h}mm`;
      }
      sheet.append(img);
    }
    root.append(sheet);
  }
  return root;
}

let current: { root: HTMLElement; urls: string[] } | null = null;

function cleanUp() {
  if (!current) return;
  current.root.remove();
  for (const u of current.urls) URL.revokeObjectURL(u);
  current = null;
}

/**
 * Draws the pages and opens the OS's print dialog. What the user picks
 * there (printer, copies, two-sided) is theirs; the sheets are ours.
 */
export async function printDocument(d: Doc, o: PrintOptions): Promise<void> {
  cleanUp();
  st().setBusy(`印刷の準備をしています…（0 / ${o.pages.length} ページ）`);
  let pages: Printed[];
  try {
    pages = await draw(d, o, (done, total) => st().setBusy(`印刷の準備をしています…（${done} / ${total} ページ）`));
  } catch (e) {
    st().notify({ title: "印刷の準備ができませんでした", detail: String((e as Error)?.message ?? e), kind: "error" });
    return;
  } finally {
    st().setBusy(null);
  }
  const root = layOut(pages, o);
  current = { root, urls: pages.map((p) => p.url) };
  document.body.append(root);
  // The pictures have to be decoded before the dialog takes its snapshot.
  await Promise.all([...root.querySelectorAll("img")].map((img) => img.decode().catch(() => {})));
  const done = () => {
    window.removeEventListener("afterprint", done);
    cleanUp();
  };
  window.addEventListener("afterprint", done);
  // Some WebViews never say afterprint; don't keep the pictures forever.
  setTimeout(done, 10 * 60 * 1000);
  try {
    window.print();
  } catch (e) {
    warn("print", e);
    st().notify({ title: "印刷の画面を開けませんでした", detail: String(e), kind: "error" });
    done();
  }
}

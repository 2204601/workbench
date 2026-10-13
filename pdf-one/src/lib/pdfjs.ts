/**
 * pdf.js: how it is set up, and the documents it has open ("sources").
 *
 * A source is one opened file. A tab's pages can come from several sources
 * (pages inserted from another file), so pages refer to a source and an
 * index in it (store.ts `PageItem`). pdf.js objects aren't plain data, so
 * they are kept here rather than in the store.
 */
import { getDocument, GlobalWorkerOptions, PasswordResponses, type PDFDocumentLoadingTask, type PDFDocumentProxy } from "pdfjs-dist";
import type { TextContent } from "pdfjs-dist/types/src/display/api";
// The legacy build, as for the main thread (vite.config.ts).
import workerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";
import { api, type OpenedPdf } from "./api";

GlobalWorkerOptions.workerSrc = workerUrl;

/** Files pdf.js reads at run time (vite.config.ts `pdfjsAssets`). */
const assets = new URL("pdfjs/", document.baseURI).href;

export interface PageInfo {
  /** The visible box in PDF space (pdf.js `page.view`). */
  view: [number, number, number, number];
  /** The page's own /Rotate. */
  rotate: number;
}

export interface Source {
  id: number;
  path: string;
  name: string;
  pdf: PDFDocumentProxy;
  /** Destroying it lets go of the document in pdf.js's worker. */
  task: PDFDocumentLoadingTask;
  pages: PageInfo[];
  readOnly: string | null;
  signed: boolean;
}

const sources = new Map<number, Source>();

export const getSource = (id: number) => sources.get(id);

/** Asks for a password (a dialog); null = cancelled. Set by the app. */
let askPassword: (name: string, wrong: boolean) => Promise<string | null> = async () => null;
export function setPasswordPrompt(f: typeof askPassword) {
  askPassword = f;
}

/** A loading task for `data`, set up the way every document here is. */
export function loadBytes(data: Uint8Array): PDFDocumentLoadingTask {
  return getDocument({
    data,
    cMapUrl: `${assets}cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${assets}standard_fonts/`,
    wasmUrl: `${assets}wasm/`,
    // WebAssembly would need 'wasm-unsafe-eval' in the CSP; pdf.js has
    // JavaScript decoders for the same images.
    useWasm: false,
    enableXfa: false,
  });
}

/** Loads an opened file (Rust has read and checked it) into pdf.js. */
export async function loadSource(opened: OpenedPdf): Promise<Source> {
  const data = await api.pdfViewBytes(opened.id);
  const task = loadBytes(data);
  task.onPassword = (update: (password: string) => void, reason: number) => {
    void askPassword(opened.name, reason === PasswordResponses.INCORRECT_PASSWORD).then((p) => {
      if (p === null) void task.destroy();
      else update(p);
    });
  };
  const pdf = await task.promise;
  const pages = await Promise.all(
    Array.from({ length: pdf.numPages }, async (_, i) => {
      const p = await pdf.getPage(i + 1);
      return { view: p.view as PageInfo["view"], rotate: p.rotate };
    }),
  );
  const source: Source = {
    id: opened.id,
    path: opened.path,
    name: opened.name,
    pdf,
    task,
    pages,
    readOnly: opened.readOnly,
    signed: opened.signed,
  };
  sources.set(opened.id, source);
  return source;
}

/** Lets go of a source no tab uses any more. */
export async function releaseSource(id: number) {
  const s = sources.get(id);
  sources.delete(id);
  for (const key of textCache.keys()) if (key.startsWith(`${id}:`)) textCache.delete(key);
  await Promise.allSettled([s?.task.destroy(), api.closePdf(id)]);
}

const textCache = new Map<string, Promise<TextContent>>();

/** A page's text (for search), read once. */
export function pageText(source: number, index: number): Promise<TextContent> {
  const key = `${source}:${index}`;
  let t = textCache.get(key);
  if (!t) {
    const s = sources.get(source);
    if (!s) return Promise.reject(new Error("closed"));
    // The same text as the text layer shows (PageView), so offsets match.
    t = s.pdf.getPage(index + 1).then((p) => p.getTextContent({ disableNormalization: true }));
    textCache.set(key, t);
  }
  return t;
}

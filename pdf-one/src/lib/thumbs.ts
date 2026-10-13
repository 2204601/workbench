/**
 * Small pictures of pages (the sidebar, the page organizer): drawn by
 * pdf.js a few at a time, and kept as blob URLs so scrolling back is free.
 */
import { warn } from "./log";
import { getSource } from "./pdfjs";

/** How many are drawn at once; more would hold up the main view's pages. */
const PARALLEL = 2;
/** How many are kept; the least recently used go first. */
const KEEP = 600;

const cache = new Map<string, string>();
const waiting: { key: string; run: () => Promise<void> }[] = [];
const pending = new Map<string, Promise<string | null>>();
let running = 0;

function pump() {
  while (running < PARALLEL && waiting.length) {
    const job = waiting.shift()!;
    running++;
    void job.run().finally(() => {
      running--;
      pump();
    });
  }
}

function remember(key: string, url: string) {
  cache.set(key, url);
  if (cache.size > KEEP) {
    const [oldest, old] = cache.entries().next().value!;
    cache.delete(oldest);
    URL.revokeObjectURL(old);
  }
}

/** A thumbnail `width` CSS pixels wide, of page `index` of `source` turned `rotation`. */
export function thumbnail(source: number, index: number, rotation: number, width: number): Promise<string | null> {
  const key = `${source}:${index}:${rotation}:${width}`;
  const hit = cache.get(key);
  if (hit) {
    // Most recently used goes to the end.
    cache.delete(key);
    cache.set(key, hit);
    return Promise.resolve(hit);
  }
  const p = pending.get(key);
  if (p) return p;
  const promise = new Promise<string | null>((resolve) => {
    waiting.push({
      key,
      run: async () => {
        try {
          const s = getSource(source);
          if (!s) return resolve(null);
          const page = await s.pdf.getPage(index + 1);
          const base = page.getViewport({ scale: 1, rotation });
          const ratio = window.devicePixelRatio || 1;
          const viewport = page.getViewport({ scale: (width / base.width) * ratio, rotation });
          const canvas = document.createElement("canvas");
          canvas.width = Math.ceil(viewport.width);
          canvas.height = Math.ceil(viewport.height);
          await page.render({ canvas, viewport }).promise;
          const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
          // Its pixels now (Safari keeps them until garbage collection: PageView).
          canvas.width = canvas.height = 0;
          if (!blob) return resolve(null);
          const url = URL.createObjectURL(blob);
          remember(key, url);
          resolve(url);
        } catch (e) {
          warn("thumbnail", e);
          resolve(null);
        } finally {
          pending.delete(key);
        }
      },
    });
    pump();
  });
  pending.set(key, promise);
  return promise;
}

/** Thumbnails not yet started that nobody waits for any more. */
export function cancelThumbnail(source: number, index: number, rotation: number, width: number) {
  const key = `${source}:${index}:${rotation}:${width}`;
  const i = waiting.findIndex((j) => j.key === key);
  if (i >= 0) {
    waiting.splice(i, 1);
    pending.delete(key);
  }
}

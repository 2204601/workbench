/**
 * Finding text in a tab's pages. Matching ignores case, full / half width
 * (ＡＢＣ = ABC, ｶﾀｶﾅ = カタカナ) and spaces, which PDFs often put between
 * Japanese characters or drop at line ends.
 */
import type { TextItem } from "pdfjs-dist/types/src/display/api";
import { pageText } from "./pdfjs";
import { activeDoc, useStore, type SearchMatch } from "../store";

const st = () => useStore.getState();

/** One character of a page's text, normalized, and where it came from. */
interface Mapped {
  text: string;
  /** For each character of `text`: text item and offset in it. */
  from: [number, number][];
}

function normalizeChar(c: string): string {
  return c.normalize("NFKC").toLowerCase();
}

export function normalizeQuery(q: string): string {
  return Array.from(q)
    .map(normalizeChar)
    .join("")
    .replace(/\s+/g, "");
}

/** A page's text items as one normalized string, spaces left out. */
export function mapItems(items: string[]): Mapped {
  let text = "";
  const from: [number, number][] = [];
  items.forEach((str, item) => {
    let offset = 0;
    for (const ch of Array.from(str)) {
      const n = normalizeChar(ch).replace(/\s+/g, "");
      for (const out of n) {
        text += out;
        from.push([item, offset]);
      }
      offset += ch.length;
    }
  });
  return { text, from };
}

/** Where `q` (normalized) is in `m`, as pieces of items. */
export function matchesIn(m: Mapped, q: string): SearchMatch["parts"][] {
  const out: SearchMatch["parts"][] = [];
  if (!q) return out;
  let at = m.text.indexOf(q);
  while (at >= 0) {
    const parts: SearchMatch["parts"] = [];
    for (let i = at; i < at + q.length; i++) {
      const [item, offset] = m.from[i];
      const last = parts[parts.length - 1];
      if (last?.item === item) {
        last.start = Math.min(last.start, offset);
        last.end = Math.max(last.end, offset + 1);
      } else {
        parts.push({ item, start: offset, end: offset + 1 });
      }
    }
    out.push(parts);
    at = m.text.indexOf(q, at + Math.max(1, q.length));
  }
  return out;
}

let runSeq = 0;

/** Searches the active tab for `query`; results arrive page by page. */
export async function runSearch(query: string) {
  const seq = ++runSeq;
  const d = activeDoc(st());
  const q = normalizeQuery(query);
  if (!d || !q) {
    st().setSearch({ results: [], current: 0, progress: null });
    return;
  }
  const results: (SearchMatch & { y?: number })[] = [];
  const pages = d.pages;
  let jumped = false;
  st().setSearch({ results: [], current: 0, progress: { done: 0, total: pages.length } });
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i];
    if (p.source === null) continue;
    let items: TextItem[];
    try {
      const content = await pageText(p.source, p.index);
      items = content.items.filter((x): x is TextItem => "str" in x);
    } catch {
      continue;
    }
    if (seq !== runSeq) return;
    const m = mapItems(items.map((x) => x.str));
    for (const parts of matchesIn(m, q)) {
      const first = items[parts[0].item];
      results.push({ uid: p.uid, parts, y: first ? first.transform[5] + Math.abs(first.transform[3] || first.height) : undefined });
    }
    if (i % 8 === 7 || i === pages.length - 1) {
      // The first match from the page in view on is shown as soon as found.
      let current = st().search.current;
      if (!jumped) {
        const here = results.findIndex((r) => pages.findIndex((x) => x.uid === r.uid) >= d.page);
        if (here >= 0) {
          current = here;
          jumped = true;
          show(results[here]);
        }
      }
      st().setSearch({ results: [...results], current, progress: { done: i + 1, total: pages.length } });
    }
  }
  if (seq !== runSeq) return;
  if (!jumped && results.length) show(results[0]);
  st().setSearch({ results, progress: null, current: jumped ? st().search.current : 0 });
}

function show(r: SearchMatch & { y?: number }) {
  const d = activeDoc(st());
  const page = d?.pages.findIndex((p) => p.uid === r.uid) ?? -1;
  if (page < 0) return;
  st().patchDoc((x) => ({ scrollTo: { page, seq: (x.scrollTo?.seq ?? 0) + 1, y: r.y } }));
}

/** ⌘G / ⌘⇧G: the next or previous match. */
export function findNext(dir: 1 | -1) {
  const { results, current } = st().search;
  if (!results.length) return;
  const next = (current + dir + results.length) % results.length;
  st().setSearch({ current: next, open: true });
  show(results[next]);
}

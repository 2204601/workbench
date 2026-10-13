import { Search, X } from "lucide-react";
import { useEffect, useRef } from "react";
import { findNext, runSearch } from "../lib/search";
import { useStore } from "../store";
import { SearchNav } from "./Viewer";

const st = () => useStore.getState();

/** ⌘F: finding text, at the top right of the pages. */
export function SearchBar() {
  const search = useStore((s) => s.search);
  const active = useStore((s) => s.active);
  const field = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (search.open) {
      field.current?.focus();
      field.current?.select();
    }
  }, [search.open, search.focusSeq]);

  // Typing searches after a pause; another tab searches again.
  useEffect(() => {
    if (!search.open) return;
    const t = setTimeout(() => void runSearch(search.query), 250);
    return () => clearTimeout(t);
  }, [search.query, search.open, active]);

  if (!search.open) return null;
  const n = search.results.length;
  return (
    <div className="absolute top-3 right-5 z-20 flex animate-fade-in items-center gap-1 rounded-lg border border-line bg-panel py-1 pr-1 pl-2 shadow-xl">
      <Search size={14} className="text-dim" />
      <input
        ref={field}
        value={search.query}
        placeholder="文書内を検索"
        onChange={(e) => st().setSearch({ query: e.target.value })}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing || e.keyCode === 229) return;
          if (e.key === "Enter") {
            e.preventDefault();
            findNext(e.shiftKey ? -1 : 1);
          } else if (e.key === "Escape") {
            e.preventDefault();
            st().setSearch({ open: false });
          }
        }}
        className="h-6 w-56 bg-transparent text-sm outline-none placeholder:text-dim"
      />
      <span className="min-w-14 text-right text-xs text-dim tabular-nums">
        {search.progress && !n ? "検索中…" : search.query ? (n ? `${search.current + 1} / ${n}` : "なし") : ""}
      </span>
      <SearchNav onPrev={() => findNext(-1)} onNext={() => findNext(1)} />
      <button onClick={() => st().setSearch({ open: false })} className="rounded p-1 hover:bg-hover" aria-label="閉じる">
        <X size={14} />
      </button>
    </div>
  );
}

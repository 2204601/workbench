import { ChevronDown, ChevronUp, FileText, Plus, X } from "lucide-react";
import { useEffect, useState } from "react";
import { closeDoc } from "../lib/actions";
import { runCommand, TOOLS } from "../lib/commands";
import { percent } from "../lib/format";
import { dragRegion } from "../lib/titleBar";
import { activeDoc, useStore, type Doc } from "../store";
import { CommandButton } from "./CommandButton";

const st = () => useStore.getState();

/** The tabs: one per open file, like a browser. */
export function TabBar() {
  const docs = useStore((s) => s.docs);
  const active = useStore((s) => s.active);
  return (
    <header
      {...dragRegion(true)}
      className="flex h-[max(var(--titlebar),40px)] shrink-0 items-end gap-1 border-b border-line bg-[#141518] pr-2 pl-[max(var(--traffic-lights),8px)]"
    >
      <div className="flex min-w-0 flex-1 items-end gap-1 overflow-x-auto pt-1.5" role="tablist">
        {docs.map((d) => (
          <div
            key={d.key}
            role="tab"
            aria-selected={d.key === active}
            title={d.savePath ?? d.openedPath}
            onMouseDown={(e) => {
              if (e.button === 1) {
                e.preventDefault();
                void closeDoc(d.key);
              } else st().setActive(d.key);
            }}
            className={`group flex h-8 max-w-56 min-w-28 shrink-0 cursor-default items-center gap-1.5 rounded-t-lg pr-1 pl-2.5 text-[13px] ${
              d.key === active ? "bg-panel text-fg" : "text-dim hover:bg-white/5 hover:text-fg"
            }`}
          >
            <FileText size={14} className="shrink-0 opacity-70" />
            <span className="min-w-0 flex-1 truncate">{d.name}</span>
            {d.readOnly && <span className="shrink-0 rounded bg-white/10 px-1 text-[10px] text-dim">表示のみ</span>}
            <button
              aria-label={`${d.name} を閉じる`}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={() => void closeDoc(d.key)}
              className="relative flex h-5 w-5 shrink-0 items-center justify-center rounded hover:bg-white/15"
            >
              {d.dirty && <span className="absolute h-2 w-2 rounded-full bg-fg group-hover:hidden" />}
              <X size={13} className={d.dirty ? "hidden group-hover:block" : ""} />
            </button>
          </div>
        ))}
        <button
          onClick={() => runCommand("file.open")}
          title="開く"
          aria-label="PDF を開く"
          className="mb-1.5 flex h-6 w-6 shrink-0 items-center justify-center rounded text-dim hover:bg-white/10 hover:text-fg"
        >
          <Plus size={15} />
        </button>
      </div>
    </header>
  );
}

const Sep = () => <div className="mx-1 h-5 w-px shrink-0 bg-line" />;

/** The page number in view, which can be typed to go there. */
function PageNumber({ d }: { d: Doc }) {
  const [text, setText] = useState(String(d.page + 1));
  useEffect(() => setText(String(d.page + 1)), [d.page]);
  const go = () => {
    const n = Math.max(1, Math.min(d.pages.length, parseInt(text, 10) || d.page + 1));
    setText(String(n));
    st().patchDoc((x) => ({ scrollTo: { page: n - 1, seq: (x.scrollTo?.seq ?? 0) + 1 } }));
  };
  return (
    <div className="flex shrink-0 items-center gap-1 text-[13px] text-dim">
      <input
        value={text}
        onChange={(e) => setText(e.target.value.replace(/[^\d]/g, ""))}
        onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && go()}
        onBlur={go}
        aria-label="ページ番号"
        className="h-6 w-10 rounded border border-line bg-bg text-center text-fg tabular-nums outline-none focus:border-accent"
      />
      <span className="tabular-nums">/ {d.pages.length}</span>
    </div>
  );
}

const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];

function ZoomBox({ d }: { d: Doc }) {
  const value = d.zoom.mode === "scale" ? String(d.zoom.value) : d.zoom.mode;
  const known = d.zoom.mode !== "scale" || ZOOMS.includes(d.zoom.value);
  return (
    <select
      value={value}
      aria-label="表示の大きさ"
      onChange={(e) => {
        const v = e.target.value;
        st().patchDoc({ zoom: v === "fit-width" || v === "fit-page" ? { mode: v } : { mode: "scale", value: Number(v) } });
      }}
      className="h-7 w-[124px] shrink-0 rounded-md border border-line bg-bg px-1.5 text-[13px] tabular-nums outline-none focus:border-accent"
    >
      <option value="fit-width">幅に合わせる</option>
      <option value="fit-page">ページ全体</option>
      {!known && <option value={value}>{percent(d.scale)}</option>}
      {ZOOMS.map((z) => (
        <option key={z} value={String(z)}>
          {percent(z)}
        </option>
      ))}
    </select>
  );
}

/** The tools and the view's controls, over the pages. */
export function ToolBar() {
  const d = useStore(activeDoc);
  if (!d) return null;
  const view = d.readOnly !== null;
  return (
    <div className="flex h-11 shrink-0 items-center gap-1 overflow-x-auto border-b border-line bg-panel px-2">
      <CommandButton id="view.panel" compact />
      <CommandButton id="view.organizer" compact />
      <Sep />
      {TOOLS.slice(0, 2).map((t) => (
        <CommandButton key={t.tool} id={`tool.${t.tool}`} compact />
      ))}
      {!view && (
        <>
          <Sep />
          {TOOLS.slice(2).map((t) => (
            <CommandButton key={t.tool} id={`tool.${t.tool}`} compact />
          ))}
          <CommandButton id="tool.image" compact />
        </>
      )}
      <div className="min-w-2 flex-1" />
      {!view && (
        <>
          <CommandButton id="edit.undo" compact />
          <CommandButton id="edit.redo" compact />
          <Sep />
        </>
      )}
      <CommandButton id="view.zoomOut" compact />
      <ZoomBox d={d} />
      <CommandButton id="view.zoomIn" compact />
      <Sep />
      <PageNumber d={d} />
      <Sep />
      <CommandButton id="edit.find" compact />
      {!view && <CommandButton id="file.save" label="保存" />}
    </div>
  );
}

/** Up and down through search results, from the search bar. */
export function SearchNav({ onPrev, onNext }: { onPrev: () => void; onNext: () => void }) {
  return (
    <>
      <button onClick={onPrev} className="rounded p-1 hover:bg-white/10" aria-label="前を検索" title="前を検索">
        <ChevronUp size={15} />
      </button>
      <button onClick={onNext} className="rounded p-1 hover:bg-white/10" aria-label="次を検索" title="次を検索">
        <ChevronDown size={15} />
      </button>
    </>
  );
}

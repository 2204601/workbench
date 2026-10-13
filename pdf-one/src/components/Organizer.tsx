import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { deleteTargetPages } from "../lib/actions";
import { isMac } from "../lib/keys";
import { useStore, type Doc } from "../store";
import { CommandButton } from "./CommandButton";
import { useContextMenu } from "./ContextMenu";
import { DragLabel } from "./Sidebar";
import { Thumb } from "./Thumb";
import { pickPage, usePageDrag } from "./usePageDrag";

const st = () => useStore.getState();

const MENU = ["page.rotateLeft", "page.rotateRight", "-", "page.insertBlank", "page.insertFile", "-", "page.extract", "-", "page.delete"];

const load = () => {
  try {
    return Number(localStorage.getItem("organizer.size")) || 180;
  } catch {
    return 180;
  }
};

/**
 * ページを整理 (Acrobat's Organize Pages): every page as a thumbnail, to
 * reorder by dragging, turn, delete, insert and write out.
 */
export function Organizer({ d }: { d: Doc }) {
  const scroller = useRef<HTMLDivElement>(null);
  const { drag, onPointerDown, wasDrag } = usePageDrag(scroller, "grid");
  const [size, setSize] = useState(load);
  useEffect(() => {
    try {
      localStorage.setItem("organizer.size", String(size));
    } catch {
      /* only a preference */
    }
  }, [size]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if ((e.key === "Delete" || e.key === "Backspace") && d.selectedPages.length && !d.readOnly) {
      e.preventDefault();
      e.stopPropagation();
      deleteTargetPages();
    } else if ((e.key === "a" || e.key === "A") && (isMac ? e.metaKey : e.ctrlKey)) {
      e.preventDefault();
      e.stopPropagation();
      st().patchDoc({ selectedPages: d.pages.map((p) => p.uid) });
    }
  };

  return (
    <div data-organizer className="flex min-h-0 min-w-0 flex-1 flex-col bg-[#2a2b30]">
      <div className="flex h-10 shrink-0 items-center gap-1.5 border-b border-line bg-panel px-3">
        <span className="mr-2 font-semibold">ページを整理</span>
        <CommandButton id="page.rotateLeft" />
        <CommandButton id="page.rotateRight" />
        <CommandButton id="page.delete" />
        <div className="mx-1 h-5 w-px bg-line" />
        <CommandButton id="page.insertBlank" label="白紙" />
        <CommandButton id="page.insertFile" label="ファイルから挿入" />
        <CommandButton id="page.extract" label="書き出す" />
        <CommandButton id="page.split" label="分割" />
        <div className="flex-1" />
        <span className="text-xs text-dim">
          {d.selectedPages.length ? `${d.selectedPages.length} ページを選択中・` : ""}全 {d.pages.length} ページ
        </span>
        <input
          type="range"
          min={100}
          max={320}
          value={size}
          onChange={(e) => setSize(Number(e.target.value))}
          className="w-24 accent-accent"
          aria-label="サムネイルの大きさ"
        />
        <button onClick={() => st().setOrganizer(false)} className="flex h-7 items-center gap-1 rounded-md bg-raised px-2 hover:bg-white/10">
          <X size={14} />
          閉じる
        </button>
      </div>
      <div
        ref={scroller}
        tabIndex={0}
        onKeyDown={onKeyDown}
        className="min-h-0 flex-1 overflow-y-auto p-6 outline-none"
        onPointerDown={(e) => {
          if (e.target === e.currentTarget) st().patchDoc({ selectedPages: [] });
        }}
      >
        <div className="flex flex-wrap gap-x-5 gap-y-6">
          {d.pages.map((p, i) => {
            const picked = d.selectedPages.includes(p.uid);
            const before = drag && drag.to === i;
            const after = drag && drag.to === d.pages.length && i === d.pages.length - 1;
            return (
              <div
                key={p.uid}
                data-thumb-index={i}
                className="relative flex flex-col items-center gap-1.5"
                style={{ width: size }}
                onPointerDown={(e) => onPointerDown(e, p.uid)}
                onClick={(e) => !wasDrag() && pickPage(p.uid, e, isMac)}
                onDoubleClick={() => {
                  // The view, shown again, comes back to this spot (Viewer).
                  st().patchDoc({ page: i, pageOffset: 0 });
                  st().setOrganizer(false);
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  if (!picked) st().patchDoc({ selectedPages: [p.uid] });
                  useContextMenu.getState().open(e, MENU);
                }}
              >
                {before && <div className="absolute top-0 bottom-6 -left-3 w-1 rounded bg-accent" />}
                {after && <div className="absolute top-0 bottom-6 -right-3 w-1 rounded bg-accent" />}
                <div className="flex items-end justify-center" style={{ height: size * 1.42 }}>
                  <div className={`rounded p-1 ${picked ? "bg-accent" : "hover:bg-white/15"}`}>
                    <Thumb item={p} width={size - 8} height={size * 1.42 - 8} />
                  </div>
                </div>
                <span className={`text-xs tabular-nums ${picked ? "text-fg" : "text-dim"}`}>{i + 1}</span>
              </div>
            );
          })}
        </div>
      </div>
      {drag && <DragLabel n={drag.uids.length} x={drag.x} y={drag.y} />}
    </div>
  );
}

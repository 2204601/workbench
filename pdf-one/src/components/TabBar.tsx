import { FileText, Plus, X } from "lucide-react";
import { closeDoc } from "../lib/actions";
import { dragRegion } from "../lib/titleBar";
import { useStore } from "../store";

const st = () => useStore.getState();

/** The tabs: one per open file, like a browser (docs/UX.md §4). */
export function TabBar() {
  const docs = useStore((s) => s.docs);
  const active = useStore((s) => s.active);
  return (
    <header
      {...dragRegion(true)}
      className="flex h-[max(var(--titlebar),40px)] shrink-0 items-end gap-1 border-b border-line bg-tabbar pr-2 pl-[max(var(--traffic-lights),8px)]"
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
            className={`group flex h-8 max-w-56 min-w-28 shrink-0 cursor-default items-center gap-1.5 rounded-t-lg pr-1 pl-2.5 text-sm ${
              d.key === active ? "bg-panel text-fg" : "text-dim hover:bg-hover hover:text-fg"
            }`}
          >
            <FileText size={14} className="shrink-0 opacity-70" />
            <span className="min-w-0 flex-1 truncate">{d.name}</span>
            {d.readOnly && <span className="shrink-0 rounded bg-raised px-1 text-xs text-dim">表示のみ</span>}
            <button
              aria-label={`${d.name} を閉じる`}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={() => void closeDoc(d.key)}
              className="relative flex h-5 w-5 shrink-0 items-center justify-center rounded hover:bg-hover"
            >
              {d.dirty && <span className="absolute h-2 w-2 rounded-full bg-fg group-hover:hidden" title="変更あり（保存していません）" />}
              <X size={13} className={d.dirty ? "hidden group-hover:block" : ""} />
            </button>
          </div>
        ))}
        {/* The + shows the start screen (open, recent files) in a tab of its own, as when the app starts. */}
        {active === null && docs.length > 0 && (
          <div
            role="tab"
            aria-selected
            className="group flex h-8 max-w-56 min-w-28 shrink-0 cursor-default items-center gap-1.5 rounded-t-lg bg-panel pr-1 pl-2.5 text-sm text-fg"
          >
            <FileText size={14} className="shrink-0 opacity-70" />
            <span className="min-w-0 flex-1 truncate">はじめる</span>
            <button
              aria-label="はじめる画面を閉じる"
              onClick={() => st().setActive(docs[docs.length - 1].key)}
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded hover:bg-hover"
            >
              <X size={13} />
            </button>
          </div>
        )}
        <button
          onClick={() => st().setActive(null)}
          title="新しいタブ（開く PDF を選びます）"
          aria-label="新しいタブ"
          className="mb-1.5 flex h-6 w-6 shrink-0 items-center justify-center rounded text-dim hover:bg-hover hover:text-fg"
        >
          <Plus size={15} />
        </button>
      </div>
    </header>
  );
}

import { File, Folder, TriangleAlert } from "lucide-react";
import { useMemo } from "react";
import { activate } from "../lib/actions";
import { OTHER, slotsOf } from "../lib/charts";
import { itemMenu } from "../lib/contextMenu";
import { bytes, count, percent } from "../lib/format";
import { useStore } from "../store";

/**
 * What is directly in the folder, largest first (docs/SPEC.md §6). The
 * swatches match the chart's colors; pointing at a row outlines it there.
 */
export function ItemList() {
  const folder = useStore((s) => s.folder);
  const view = useStore((s) => s.view);
  const hover = useStore((s) => s.hover);
  const selected = useStore((s) => s.selected);
  const setHover = useStore((s) => s.setHover);
  const select = useStore((s) => s.select);
  const slots = useMemo(() => slotsOf(view), [view]);
  if (!folder) return null;
  const largest = folder.items[0]?.size || 1;

  return (
    <aside className="flex w-[340px] shrink-0 flex-col border-l border-line bg-panel" aria-label="中身の一覧">
      <div className="flex items-baseline gap-2 border-b border-line px-3 py-2">
        <span className="min-w-0 flex-1 truncate font-semibold" title={folder.path}>
          {folder.crumbs.length === 1 ? folder.path : folder.name}
        </span>
        <span className="shrink-0 text-xs text-dim tabular-nums">
          {count(folder.items.length + folder.more)} 項目
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto" onMouseLeave={() => setHover(null)}>
        {folder.items.map((it) => {
          const color = slots.get(it.id) ?? OTHER;
          const on = selected === it.id;
          return (
            <div
              key={it.id}
              data-row={it.id}
              onMouseEnter={() => setHover(it.id)}
              onClick={() => (it.dir ? activate(it.id, true) : select(on ? null : it.id))}
              onContextMenu={(e) => {
                e.preventDefault();
                void itemMenu(it.id, it.dir);
              }}
              className={`grid cursor-default grid-cols-[10px_16px_minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1 border-b border-line/50 px-3 py-1.5 ${
                on ? "bg-accent/25" : hover === it.id ? "bg-white/5" : ""
              } ${it.dir ? "cursor-pointer" : ""}`}
            >
              <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: color }} />
              {it.dir ? <Folder size={15} className="text-dim" /> : <File size={15} className="text-dim" />}
              <span className="flex min-w-0 items-center gap-1">
                <span className="truncate" title={it.name}>
                  {it.name}
                </span>
                {it.unreadable && (
                  <span title="読めないところがありました（その分は数えていません）" className="shrink-0 text-warn">
                    <TriangleAlert size={13} />
                  </span>
                )}
              </span>
              <span className="text-right text-xs tabular-nums">{bytes(it.size)}</span>
              <span className="col-start-3 h-1 overflow-hidden rounded-full bg-bg">
                <span className="block h-full rounded-full" style={{ width: `${(it.size / largest) * 100}%`, background: color }} />
              </span>
              <span className="text-right text-[11px] text-dim tabular-nums">{percent(it.size, folder.size)}</span>
            </div>
          );
        })}
        {folder.more > 0 && (
          <div className="px-3 py-2 text-xs text-dim">
            ほか {count(folder.more)} 項目（合わせて {bytes(folder.moreSize)}）
          </div>
        )}
        {folder.items.length === 0 && <div className="px-3 py-6 text-center text-dim">空のフォルダです</div>}
      </div>
    </aside>
  );
}

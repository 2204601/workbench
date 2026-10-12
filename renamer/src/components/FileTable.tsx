import { useVirtualizer } from "@tanstack/react-virtual";
import { AlertTriangle, ArrowRight, Check, Minus, OctagonX } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import type { Row, Status } from "../lib/api";
import { runCommand } from "../lib/commands";
import { baseName, bytes, count, dateTime } from "../lib/format";
import { fromField } from "../lib/keys";
import { useStore, type View } from "../store";

const ROW = 30;

/** checkbox | 元の名前 | → | 新しい名前 | 状態 | 更新日時 | サイズ */
const GRID = "grid grid-cols-[36px_minmax(0,1fr)_24px_minmax(0,1fr)_minmax(0,200px)_132px_72px] items-center";

const VIEWS: { value: View; label: string }[] = [
  { value: "all", label: "すべて" },
  { value: "changing", label: "変わるもの" },
  { value: "problems", label: "問題のあるもの" },
];

const inView = (r: Row, v: View) =>
  v === "all" || (v === "changing" ? r.status === "change" || r.status === "warn" : r.status === "error" || r.status === "warn");

function StatusCell({ row }: { row: Row }) {
  const s: Status = row.status;
  if (s === "error")
    return (
      <span className="flex min-w-0 items-center gap-1.5 text-danger" title={row.message ?? undefined}>
        <OctagonX size={14} className="shrink-0" />
        <span className="truncate">{row.message}</span>
      </span>
    );
  if (s === "warn")
    return (
      <span className="flex min-w-0 items-center gap-1.5 text-warn" title={row.message ?? undefined}>
        <AlertTriangle size={14} className="shrink-0" />
        <span className="truncate">{row.message}</span>
      </span>
    );
  if (s === "change") return <Check size={14} className="text-success" />;
  return <Minus size={14} className="text-dim/60" />;
}

/** The view switch above the list, with how many rows each shows. */
function ViewTabs({ rows }: { rows: Row[] }) {
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const n = (v: View) => rows.filter((r) => inView(r, v)).length;
  return (
    <div className="flex items-center gap-1 border-b border-line px-3 py-1.5">
      {VIEWS.map((v) => (
        <button
          key={v.value}
          onClick={() => setView(v.value)}
          className={`rounded-md px-2.5 py-1 text-xs ${view === v.value ? "bg-raised text-fg" : "text-dim hover:text-fg"}`}
        >
          {v.label}
          <span className="ml-1.5 tabular-nums opacity-70">{count(n(v.value))}</span>
        </button>
      ))}
      <div className="flex-1" />
      {rows.some((r) => r.status === "error") && (
        <button
          onClick={() => runCommand("list.uncheckProblems")}
          className="rounded-md bg-danger/15 px-2.5 py-1 text-xs text-danger hover:bg-danger/25"
          title="問題のある行を対象から外し、その名前のままにします"
        >
          問題のある行をすべて外す
        </button>
      )}
    </div>
  );
}

export function FileTable() {
  const all = useStore((s) => s.listing.rows);
  const view = useStore((s) => s.view);
  const folders = useStore((s) => s.listing.summary.folders.length);
  const selected = useStore((s) => s.selected);
  const focus = useStore((s) => s.focus);
  const select = useStore((s) => s.select);
  const setChecked = useStore((s) => s.setChecked);
  const rows = useMemo(() => all.filter((r) => inView(r, view)), [all, view]);
  const scroller = useRef<HTMLDivElement>(null);
  const virtual = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => ROW,
    overscan: 12,
  });

  const indexOf = useMemo(() => new Map(rows.map((r, i) => [r.id, i])), [rows]);

  /** Click / Shift+click / ⌘+click (Platform UI §7). */
  const onRowClick = (e: React.MouseEvent, row: Row) => {
    const s = useStore.getState();
    const mod = e.metaKey || e.ctrlKey;
    if (e.shiftKey && s.anchor !== null && indexOf.has(s.anchor)) {
      const [a, b] = [indexOf.get(s.anchor)!, indexOf.get(row.id)!].sort((x, y) => x - y);
      const range = rows.slice(a, b + 1).map((r) => r.id);
      select(new Set(mod ? [...s.selected, ...range] : range), row.id);
    } else if (mod) {
      const next = new Set(s.selected);
      if (next.has(row.id)) next.delete(row.id);
      else next.add(row.id);
      select(next, row.id, row.id);
    } else {
      select(new Set([row.id]), row.id, row.id);
    }
  };

  // ↑ ↓ (Shift: extend), Home / End, Esc: the list's keys.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || fromField(e) || document.querySelector("[data-modal]")) return;
      if (e.metaKey || e.ctrlKey || e.altKey || !rows.length) return;
      const s = useStore.getState();
      const at = s.focus !== null && indexOf.has(s.focus) ? indexOf.get(s.focus)! : -1;
      let to: number;
      if (e.key === "ArrowDown") to = Math.min(rows.length - 1, at + 1);
      else if (e.key === "ArrowUp") to = Math.max(0, at < 0 ? 0 : at - 1);
      else if (e.key === "Home") to = 0;
      else if (e.key === "End") to = rows.length - 1;
      else if (e.key === "Escape") {
        select(new Set(), s.focus, null);
        return;
      } else return;
      e.preventDefault();
      const id = rows[to].id;
      if (e.shiftKey) {
        const anchor = s.anchor !== null && indexOf.has(s.anchor) ? s.anchor : id;
        const [a, b] = [indexOf.get(anchor)!, to].sort((x, y) => x - y);
        select(new Set(rows.slice(a, b + 1).map((r) => r.id)), id, anchor);
      } else {
        select(new Set([id]), id, id);
      }
      virtual.scrollToIndex(to, { align: "auto" });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [rows, indexOf, select, virtual]);

  const allChecked = all.length > 0 && all.every((r) => r.checked);
  const someChecked = all.some((r) => r.checked);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ViewTabs rows={all} />
      <div className={`${GRID} h-8 shrink-0 border-b border-line px-1 text-xs text-dim`}>
        <span className="flex justify-center">
          <input
            type="checkbox"
            className="accent-accent"
            title="すべてを対象にする / 外す"
            checked={allChecked}
            ref={(el) => {
              if (el) el.indeterminate = someChecked && !allChecked;
            }}
            onChange={() => setChecked(all.map((r) => r.id), !allChecked)}
          />
        </span>
        <span className="px-2">元の名前</span>
        <span />
        <span className="px-2">新しい名前</span>
        <span className="px-2">状態</span>
        <span className="px-2">更新日時</span>
        <span className="px-2 text-right">サイズ</span>
      </div>
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto" tabIndex={-1}>
        {rows.length === 0 ? (
          <div className="flex h-full items-center justify-center text-dim">
            {all.length === 0 ? "条件に合うファイルがありません" : "この表示に当てはまる行はありません"}
          </div>
        ) : (
          <div style={{ height: virtual.getTotalSize(), position: "relative" }}>
            {virtual.getVirtualItems().map((v) => {
              const row = rows[v.index];
              const isSel = selected.has(row.id);
              const changed = row.newName !== row.name;
              return (
                <div
                  key={row.id}
                  onMouseDown={(e) => e.button === 0 && onRowClick(e, row)}
                  className={`${GRID} absolute inset-x-0 px-1 ${
                    isSel ? "bg-accent/25" : v.index % 2 ? "bg-white/[0.02]" : ""
                  } ${focus === row.id ? "outline outline-1 -outline-offset-1 outline-accent/70" : ""} ${
                    row.checked ? "" : "opacity-45"
                  }`}
                  style={{ top: v.start, height: ROW }}
                >
                  <span className="flex justify-center" onMouseDown={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      className="accent-accent"
                      checked={row.checked}
                      onChange={() => setChecked([row.id], !row.checked)}
                      aria-label={`${row.name} を対象にする`}
                    />
                  </span>
                  <span className="min-w-0 truncate px-2" title={`${row.dir}\n${row.name}`}>
                    {folders > 1 && <span className="mr-1.5 text-dim">{baseName(row.dir)} /</span>}
                    {row.name}
                  </span>
                  <ArrowRight size={14} className={changed ? "text-accent" : "text-dim/40"} />
                  <span
                    className={`min-w-0 truncate px-2 ${
                      row.status === "error" ? "text-danger" : changed ? "font-medium text-fg" : "text-dim"
                    }`}
                    title={row.newName}
                  >
                    {row.newName}
                  </span>
                  <span className="flex min-w-0 px-2">
                    <StatusCell row={row} />
                  </span>
                  <span className="truncate px-2 text-xs text-dim tabular-nums">{dateTime(row.modified)}</span>
                  <span className="truncate px-2 text-right text-xs text-dim tabular-nums">{bytes(row.size)}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

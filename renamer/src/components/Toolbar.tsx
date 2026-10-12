import { ArrowDownWideNarrow, ArrowUpNarrowWide, ChevronDown, Search, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { SortBy } from "../lib/api";
import { command, isEnabled, runCommand } from "../lib/commands";
import { count } from "../lib/format";
import { composing } from "../lib/ime";
import { comboText } from "../lib/keys";
import { dragRegion } from "../lib/titleBar";
import { useStore } from "../store";

const SORTS: { value: SortBy; label: string }[] = [
  { value: "name", label: "名前" },
  { value: "modified", label: "更新日時" },
  { value: "created", label: "作成日時" },
  { value: "size", label: "サイズ" },
];

function CommandButton({ id, label }: { id: string; label: string }) {
  const c = command(id);
  const enabled = useStore((s) => isEnabled(c, s));
  const Icon = c.icon;
  return (
    <button
      onClick={() => runCommand(id)}
      disabled={!enabled}
      title={c.keys ? `${c.title}（${comboText(c.keys[0])}）` : c.title}
      className="flex h-7 items-center gap-1.5 rounded-md bg-raised px-2.5 text-[13px] hover:bg-white/10 disabled:opacity-40"
    >
      {Icon && <Icon size={15} />}
      {label}
    </button>
  );
}

/** Extensions to show, ticked in a drop-down; none ticked shows all. */
function ExtFilter() {
  const exts = useStore((s) => s.listing.summary.exts);
  const chosen = useStore((s) => s.exts);
  const setFilter = useStore((s) => s.setFilter);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open]);
  const label = chosen.length === 0 ? "すべての種類" : chosen.map((e) => (e ? `.${e}` : "拡張子なし")).join(" ");
  const toggle = (ext: string) =>
    setFilter({ exts: chosen.includes(ext) ? chosen.filter((x) => x !== ext) : [...chosen, ext] });
  return (
    <div ref={box} className="relative">
      <button
        onClick={() => setOpen(!open)}
        disabled={exts.length === 0}
        className={`flex h-7 max-w-48 items-center gap-1 rounded-md px-2.5 hover:bg-white/10 disabled:opacity-40 ${
          chosen.length ? "bg-accent/20 text-accent" : "bg-raised"
        }`}
      >
        <span className="truncate">{label}</span>
        <ChevronDown size={14} className="shrink-0" />
      </button>
      {open && (
        <div
          data-modal
          className="absolute top-8 left-0 z-30 max-h-80 w-56 animate-fade-in overflow-y-auto rounded-lg border border-line bg-raised p-1 shadow-xl shadow-black/50"
          onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
        >
          {exts.map(({ ext, count: n }) => (
            <label key={ext} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 hover:bg-white/5">
              <input type="checkbox" className="accent-accent" checked={chosen.includes(ext)} onChange={() => toggle(ext)} />
              <span className="flex-1">{ext ? `.${ext}` : "拡張子なし"}</span>
              <span className="text-xs text-dim tabular-nums">{count(n)}</span>
            </label>
          ))}
          {chosen.length > 0 && (
            <button onClick={() => setFilter({ exts: [] })} className="mt-1 w-full rounded px-2 py-1.5 text-left text-dim hover:bg-white/5">
              すべての種類を表示
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** "名前に含む…": applied a moment after typing stops. */
function NameFilter() {
  const contains = useStore((s) => s.contains);
  const loaded = useStore((s) => s.listing.summary.total > 0);
  const setFilter = useStore((s) => s.setFilter);
  const [text, setText] = useState(contains);
  useEffect(() => setText(contains), [contains]);
  useEffect(() => {
    if (text === contains) return;
    const t = setTimeout(() => setFilter({ contains: text }), 150);
    return () => clearTimeout(t);
  }, [text, contains, setFilter]);
  return (
    <div className="relative flex items-center">
      <Search size={14} className="pointer-events-none absolute left-2 text-dim" />
      <input
        id="name-filter"
        value={text}
        disabled={!loaded}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape" && !composing(e)) {
            setText("");
            (e.target as HTMLInputElement).blur();
          }
        }}
        placeholder="名前に含む…"
        className="h-7 w-48 rounded-md border border-transparent bg-raised pr-7 pl-7 outline-none placeholder:text-dim focus:border-accent disabled:opacity-40"
      />
      {text && (
        <button onClick={() => setText("")} className="absolute right-1 rounded p-0.5 text-dim hover:text-fg" aria-label="消す">
          <X size={13} />
        </button>
      )}
    </div>
  );
}

function SortControl() {
  const sort = useStore((s) => s.sort);
  const desc = useStore((s) => s.desc);
  const setFilter = useStore((s) => s.setFilter);
  return (
    <div className="flex items-center gap-1">
      <select
        value={sort}
        onChange={(e) => setFilter({ sort: e.target.value as SortBy })}
        className="h-7 rounded-md bg-raised px-2 outline-none hover:bg-white/10"
        title="並び順（連番もこの順に振る）"
      >
        {SORTS.map((s) => (
          <option key={s.value} value={s.value}>
            {s.label}順
          </option>
        ))}
      </select>
      <button
        onClick={() => setFilter({ desc: !desc })}
        className="flex h-7 w-7 items-center justify-center rounded-md bg-raised hover:bg-white/10"
        title={desc ? "降順" : "昇順"}
      >
        {desc ? <ArrowDownWideNarrow size={15} /> : <ArrowUpNarrowWide size={15} />}
      </button>
    </div>
  );
}

export function Toolbar() {
  return (
    <header
      {...dragRegion(true)}
      className="flex h-[max(var(--titlebar),48px)] shrink-0 items-center gap-2 border-b border-line bg-panel pr-3 pl-[max(var(--traffic-lights),12px)]"
    >
      <CommandButton id="file.openFolder" label="フォルダを開く" />
      <CommandButton id="file.addFiles" label="ファイルを追加" />
      <div className="mx-1 h-5 w-px bg-line" />
      <ExtFilter />
      <NameFilter />
      <div className="flex-1" />
      <SortControl />
    </header>
  );
}

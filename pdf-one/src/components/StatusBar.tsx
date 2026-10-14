import { Minus, PanelLeft, PanelRight, Plus, RotateCw } from "lucide-react";
import { useEffect, useState } from "react";
import { runCommand } from "../lib/commands";
import { percent } from "../lib/format";
import { hint } from "../lib/hints";
import { useStore, type Doc } from "../store";

const st = () => useStore.getState();

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
    <div className="flex shrink-0 items-center gap-1 text-dim">
      <input
        value={text}
        onChange={(e) => setText(e.target.value.replace(/[^\d]/g, ""))}
        onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && go()}
        onBlur={go}
        aria-label="ページ番号"
        title="ページ番号（打って Enter で移動）"
        className="h-6 w-11 rounded border border-line bg-bg text-center text-sm text-fg tabular-nums outline-none focus:border-accent"
      />
      <span className="tabular-nums">/ {d.pages.length} ページ</span>
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
      title="表示の大きさ"
      onChange={(e) => {
        const v = e.target.value;
        st().patchDoc({ zoom: v === "fit-width" || v === "fit-page" ? { mode: v } : { mode: "scale", value: Number(v) } });
      }}
      className="h-6 w-[7.5rem] shrink-0 rounded border border-line bg-bg px-1 text-sm tabular-nums outline-none focus:border-accent"
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

function SaveState({ d }: { d: Doc }) {
  if (d.readOnly) return null;
  if (d.dirty) return <span className="shrink-0 text-warn">変更あり（保存していません）</span>;
  if (d.savedAt) {
    const t = new Date(d.savedAt);
    const p = (n: number) => String(n).padStart(2, "0");
    return <span className="shrink-0 text-dim">{`保存しました ${p(t.getHours())}:${p(t.getMinutes())}`}</span>;
  }
  return null;
}

/**
 * The line along the bottom (docs/UX.md §4): what state the app is in and
 * what to do next, the save state, the page number and the zoom.
 */
export function StatusBar({ d }: { d: Doc }) {
  const text = useStore(hint);
  const organizer = useStore((s) => s.organizer);
  const panel = useStore((s) => s.panel !== null && !s.organizer);
  const details = useStore((s) => s.details);
  return (
    <div className="flex h-8 shrink-0 items-center gap-3 border-t border-line bg-panel px-3 text-xs">
      <div className="min-w-0 flex-1 truncate" title={text} role="status" aria-live="polite">
        {text}
      </div>
      <SaveState d={d} />
      {!organizer && (
        <>
          <PageNumber d={d} />
          <div className="h-4 w-px bg-line" />
          <button onClick={() => runCommand("view.zoomOut")} className="rounded p-0.5 hover:bg-hover" aria-label="縮小" title="縮小">
            <Minus size={14} />
          </button>
          <ZoomBox d={d} />
          <button onClick={() => runCommand("view.zoomIn")} className="rounded p-0.5 hover:bg-hover" aria-label="拡大" title="拡大">
            <Plus size={14} />
          </button>
          <div className="h-4 w-px bg-line" />
          <button
            onClick={() => runCommand("view.rotateRight")}
            className="rounded p-0.5 hover:bg-hover"
            aria-label="右に回転して見る"
            title="右に回転して見る（ファイルは変わりません）"
          >
            <RotateCw size={14} />
          </button>
        </>
      )}
      <div className="h-4 w-px bg-line" />
      {/* The side panels come back from here: a closed 詳細 must not be lost (UX §2). */}
      <PanelButton on={panel} id="view.panel" label="一覧" title="左の一覧を出す・隠す（F4）" icon={<PanelLeft size={14} />} />
      <PanelButton on={details && !organizer} id="view.details" label="詳細" title="右の詳細を出す・隠す" icon={<PanelRight size={14} />} />
    </div>
  );
}

function PanelButton({ on, id, label, title, icon }: { on: boolean; id: string; label: string; title: string; icon: React.ReactNode }) {
  return (
    <button
      onClick={() => runCommand(id)}
      aria-pressed={on}
      title={title}
      className={`flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 ${on ? "bg-raised text-fg" : "text-dim hover:bg-hover hover:text-fg"}`}
    >
      {icon}
      {label}
    </button>
  );
}

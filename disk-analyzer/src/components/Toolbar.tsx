import { ChevronRight } from "lucide-react";
import { CHART_KINDS, CHARTS } from "../lib/charts";
import { command, isEnabled, runCommand } from "../lib/commands";
import { comboText } from "../lib/keys";
import { dragRegion } from "../lib/titleBar";
import { useStore } from "../store";

function CommandButton({ id, label }: { id: string; label?: string }) {
  const c = command(id);
  const enabled = useStore((s) => isEnabled(c, s));
  const Icon = c.icon;
  return (
    <button
      onClick={() => runCommand(id)}
      disabled={!enabled}
      title={c.keys ? `${c.title}（${comboText(c.keys[0])}）` : c.title}
      aria-label={c.title}
      className="flex h-7 shrink-0 items-center gap-1.5 rounded-md bg-raised px-2 text-[13px] hover:bg-white/10 disabled:opacity-40"
    >
      {Icon && <Icon size={15} />}
      {label}
    </button>
  );
}

const NO_CRUMBS: { id: number; name: string }[] = [];

/** Where the folder on screen is, from the folder scanned down; each part goes back there. */
function Crumbs() {
  const crumbs = useStore((s) => s.folder?.crumbs ?? NO_CRUMBS);
  const go = useStore((s) => s.go);
  return (
    <nav className="flex min-w-0 flex-1 items-center overflow-hidden" aria-label="場所">
      {crumbs.map((c, i) => {
        const last = i === crumbs.length - 1;
        return (
          <span key={c.id} className={`flex items-center ${last ? "min-w-0" : "min-w-0 shrink"}`}>
            {i > 0 && <ChevronRight size={14} className="shrink-0 text-dim" />}
            {last ? (
              <span className="truncate px-1.5 font-semibold" title={c.name}>
                {c.name}
              </span>
            ) : (
              <button
                onClick={() => void go(c.id)}
                className="max-w-48 truncate rounded px-1.5 py-0.5 text-dim hover:bg-white/10 hover:text-fg"
                title={c.name}
              >
                {c.name}
              </button>
            )}
          </span>
        );
      })}
    </nav>
  );
}

/** The charts, side by side (⌘1 … ⌘5). */
function ChartSwitch() {
  const chart = useStore((s) => s.chart);
  const setChart = useStore((s) => s.setChart);
  return (
    <div className="flex shrink-0 rounded-lg bg-bg p-0.5" role="tablist" aria-label="グラフ">
      {CHART_KINDS.map((k, i) => {
        const { icon: Icon, label } = CHARTS[k];
        const on = chart === k;
        return (
          <button
            key={k}
            role="tab"
            aria-selected={on}
            onClick={() => setChart(k)}
            title={`${label}（${comboText(`Mod+${i + 1}`)}）`}
            className={`flex h-6 items-center gap-1.5 rounded-md px-2.5 text-[12px] ${
              on ? "bg-raised text-fg shadow-sm shadow-black/40" : "text-dim hover:text-fg"
            }`}
          >
            <Icon size={14} />
            {label}
          </button>
        );
      })}
    </div>
  );
}

export function Toolbar() {
  return (
    <header
      {...dragRegion(true)}
      className="flex h-[max(var(--titlebar),48px)] shrink-0 items-center gap-2 border-b border-line bg-panel pr-3 pl-[max(var(--traffic-lights),12px)]"
    >
      <CommandButton id="file.close" />
      <CommandButton id="go.up" />
      <Crumbs />
      <ChartSwitch />
      <div className="mx-1 h-5 w-px bg-line" />
      <CommandButton id="file.rescan" />
      <CommandButton id="file.choose" label="フォルダを選ぶ" />
    </header>
  );
}

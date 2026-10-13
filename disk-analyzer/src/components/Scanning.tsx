import { LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { bytes, count, duration } from "../lib/format";
import { useStore } from "../store";

/** While a scan runs (docs/SPEC.md §3): how far it has got, and a way to stop it. */
export function Scanning() {
  const scanning = useStore((s) => s.scanning);
  const hasResult = useStore((s) => s.result !== null);
  const [now, setNow] = useState(() => Date.now());
  const [stopping, setStopping] = useState(false);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);
  if (!scanning) return null;
  const { counts, path, started } = scanning;
  const stop = () => {
    setStopping(true);
    void api.cancelScan();
  };
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-8">
      <div className="flex w-full max-w-lg flex-col items-center gap-5 text-center">
        <LoaderCircle size={44} strokeWidth={1.5} className="animate-spin text-accent" />
        <div>
          <div className="text-base font-semibold">スキャンしています…</div>
          <div className="mt-1 break-all text-xs text-dim">{path}</div>
        </div>
        <div className="grid w-full grid-cols-3 gap-2">
          {[
            ["見つけた容量", bytes(counts.bytes)],
            ["ファイル", count(counts.files)],
            ["フォルダ", count(counts.dirs)],
          ].map(([label, value]) => (
            <div key={label} className="rounded-lg bg-panel px-3 py-2">
              <div className="text-[11px] text-dim">{label}</div>
              <div className="text-lg font-semibold tabular-nums">{value}</div>
            </div>
          ))}
        </div>
        <div className="w-full truncate text-xs text-dim" title={counts.path} dir="rtl">
          {/* rtl: a long path is cut at its start, so the folder's own name stays visible. */}
          <bdi>{counts.path || " "}</bdi>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-dim tabular-nums">{duration(now - started)}</span>
          <button
            onClick={stop}
            disabled={stopping}
            className="rounded-md bg-raised px-4 py-1.5 hover:bg-white/10 disabled:opacity-50"
          >
            {stopping ? "中止しています…" : "中止"}
          </button>
        </div>
        {hasResult && <div className="text-xs text-dim">中止すると、前の結果に戻ります</div>}
      </div>
    </div>
  );
}

import { Film } from "lucide-react";
import { useCallback, useState } from "react";
import { cancelExport, exportVideo } from "../lib/actions";
import { baseName } from "../lib/api";
import { exportSizes, type Quality } from "../lib/exportJob";
import { timecode } from "../lib/format";
import { layout } from "../lib/timeline";
import { useStore } from "../store";
import { Modal } from "./Modal";

const QUALITIES: { id: Quality; label: string; note: string }[] = [
  { id: "high", label: "高画質", note: "ファイルは大きめ" },
  { id: "standard", label: "標準", note: "たいていはこれで十分" },
  { id: "small", label: "軽量", note: "メールやチャットで送るとき" },
];

const FPS = [24, 30, 60];

function Progress() {
  const x = useStore((s) => s.exporting)!;
  const ratio = x.total > 0 ? Math.min(1, x.done / x.total) : 0;
  const elapsed = (Date.now() - x.started) / 1000;
  const left = ratio > 0.02 ? (elapsed / ratio) * (1 - ratio) : null;
  return (
    <div>
      <div className="mb-1 flex items-center gap-2">
        <Film size={16} className="text-accent" />
        <span className="min-w-0 flex-1 truncate text-sm">{baseName(x.output)}</span>
        <span className="text-xs tabular-nums text-dim">{Math.floor(ratio * 100)}%</span>
      </div>
      <div className="mb-2 h-2 overflow-hidden rounded-full bg-bg">
        {ratio === 0 ? (
          <div className="h-full w-1/4 animate-indeterminate rounded-full bg-accent" />
        ) : (
          <div className="h-full rounded-full bg-accent transition-[width] duration-200 ease-linear" style={{ width: `${ratio * 100}%` }} />
        )}
      </div>
      <div className="mb-4 text-xs text-dim tabular-nums">
        {timecode(x.done, false)} / {timecode(x.total, false)}
        {left !== null && `・残り 約 ${left < 60 ? `${Math.ceil(left)} 秒` : `${Math.ceil(left / 60)} 分`}`}
      </div>
      <div className="flex justify-end">
        <button onClick={cancelExport} className="rounded-md border border-line px-3 py-1.5 text-sm hover:bg-white/5">
          中止
        </button>
      </div>
    </div>
  );
}

/** ⌘E: size, quality, frame rate, then where to save. */
export function ExportDialog() {
  const p = useStore((s) => s.project);
  const exporting = useStore((s) => s.exporting);
  const close = useCallback(() => {
    const s = useStore.getState();
    if (!s.exporting) s.openDialog(null);
  }, []);
  const sizes = exportSizes(p);
  const [size, setSize] = useState(0);
  const [quality, setQuality] = useState<Quality>("standard");
  const duration = layout(p).duration;

  const setFps = (fps: number) => useStore.getState().commit({ ...p, fps });

  return (
    <Modal title={exporting ? "書き出しています…" : "動画を書き出す"} onClose={close} width={440}>
      {exporting ? (
        <Progress />
      ) : (
        <div>
          <div className="mb-4 text-xs text-dim">
            MP4（H.264 / AAC）・長さ {timecode(duration)}
          </div>
          <div className="mb-4">
            <div className="mb-1.5 text-xs text-dim">大きさ</div>
            <div className="flex gap-2">
              {sizes.map((s, i) => (
                <button
                  key={s.label}
                  onClick={() => setSize(i)}
                  className={`flex-1 rounded-md border px-2 py-2 text-left ${size === i ? "border-accent bg-accent/10" : "border-line hover:bg-white/5"}`}
                >
                  <div className="text-sm">{s.label}</div>
                  <div className="text-[11px] text-dim">
                    {s.width}×{s.height}
                  </div>
                </button>
              ))}
            </div>
          </div>
          <div className="mb-4">
            <div className="mb-1.5 text-xs text-dim">画質</div>
            <div className="flex gap-2">
              {QUALITIES.map((q) => (
                <button
                  key={q.id}
                  onClick={() => setQuality(q.id)}
                  className={`flex-1 rounded-md border px-2 py-2 text-left ${quality === q.id ? "border-accent bg-accent/10" : "border-line hover:bg-white/5"}`}
                >
                  <div className="text-sm">{q.label}</div>
                  <div className="text-[11px] text-dim">{q.note}</div>
                </button>
              ))}
            </div>
          </div>
          <div className="mb-6">
            <div className="mb-1.5 text-xs text-dim">フレームレート</div>
            <div className="flex rounded-md bg-bg p-0.5">
              {FPS.map((f) => (
                <button
                  key={f}
                  onClick={() => setFps(f)}
                  className={`flex-1 rounded px-2 py-1 text-xs ${p.fps === f ? "bg-raised text-fg" : "text-dim hover:text-fg"}`}
                >
                  {f} fps
                </button>
              ))}
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={close} className="rounded-md border border-line px-3 py-1.5 text-sm hover:bg-white/5">
              キャンセル
            </button>
            <button
              onClick={() => void exportVideo(sizes[size].width, sizes[size].height, quality)}
              className="rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white hover:brightness-110"
            >
              保存先を選んで書き出す
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

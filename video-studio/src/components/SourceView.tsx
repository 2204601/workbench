import { ArrowDownToLine, ListEnd, Pause, Play, SkipBack, SkipForward, StepBack, StepForward } from "lucide-react";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { insertSourceRange } from "../lib/actions";
import { fileUrl } from "../lib/api";
import { seconds, timecode } from "../lib/format";
import type { Media } from "../lib/project";
import { span, usedRanges } from "../lib/source";
import * as source from "../lib/sourcePlayer";
import { useStore } from "../store";

/** The file's whole length: thumbnails, the parts the timeline uses, the marked part, the playhead. */
function RangeBar({ m }: { m: Media }) {
  const bar = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const time = useStore((s) => s.sourceTime);
  const range = useStore((s) => s.source);
  const clips = useStore((s) => s.project.clips);
  const thumbs = useStore((s) => s.media[m.id]?.prepared?.thumbs);
  const used = useMemo(() => usedRanges({ clips }, m.id), [clips, m.id]);
  const d = Math.max(m.duration, 0.001);
  const x = (t: number) => (t / d) * width;

  useLayoutEffect(() => {
    const el = bar.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  /** Click or drag on the bar: the playhead follows; on a marker, the marker does. */
  const drag = (e: React.PointerEvent, which?: "in" | "out") => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const el = bar.current!;
    const at = (clientX: number) => ((clientX - el.getBoundingClientRect().left) / el.clientWidth) * d;
    const move = (clientX: number) => {
      source.seek(at(clientX));
      if (which) source.markPoint(which);
    };
    source.pause();
    move(e.clientX);
    const onMove = (ev: PointerEvent) => move(ev.clientX);
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const h = 44;
  const tileW = thumbs ? (h * thumbs.width) / thumbs.height : 0;
  const tiles = tileW && width ? Math.ceil(width / tileW) : 0;
  const marked = range && (range.in !== null || range.out !== null) ? span(range, m.duration) : null;

  return (
    <div ref={bar} className="relative cursor-text overflow-hidden rounded-md bg-black/40" style={{ height: h }} onPointerDown={(e) => drag(e)}>
      {thumbs &&
        Array.from({ length: tiles }, (_, k) => {
          const t = ((k + 0.5) * tileW * d) / width;
          const idx = Math.min(thumbs.count - 1, Math.max(0, Math.floor(t / thumbs.step)));
          return (
            <div
              key={k}
              className="absolute top-0 opacity-60"
              style={{
                left: k * tileW,
                width: tileW,
                height: h,
                backgroundImage: `url("${fileUrl(thumbs.path)}")`,
                backgroundSize: `${thumbs.count * tileW}px ${h}px`,
                backgroundPosition: `${-idx * tileW}px 0`,
              }}
            />
          );
        })}
      {/* Parts already on the timeline. */}
      {used.map((u, i) => (
        <div
          key={i}
          className="pointer-events-none absolute top-0 h-1.5 rounded-b-sm bg-warn"
          style={{ left: x(u.start), width: Math.max(2, x(u.end) - x(u.start)) }}
          title="タイムラインで使っている部分"
        />
      ))}
      {marked && (
        <div
          className="pointer-events-none absolute inset-y-0 border-x-2 border-accent bg-accent/30"
          style={{ left: x(marked.start), width: Math.max(2, x(marked.end) - x(marked.start)) }}
        />
      )}
      {range?.in !== null && range?.in !== undefined && (
        <div
          className="absolute inset-y-0 -ml-1.5 w-3 cursor-ew-resize"
          style={{ left: x(range.in) }}
          onPointerDown={(e) => drag(e, "in")}
          title="開始点（ドラッグで動かす）"
        >
          <div className="absolute top-0 left-1 h-full w-1 rounded-sm bg-accent" />
        </div>
      )}
      {range?.out !== null && range?.out !== undefined && (
        <div
          className="absolute inset-y-0 -ml-1.5 w-3 cursor-ew-resize"
          style={{ left: x(range.out) }}
          onPointerDown={(e) => drag(e, "out")}
          title="終了点（ドラッグで動かす）"
        >
          <div className="absolute top-0 left-1 h-full w-1 rounded-sm bg-accent" />
        </div>
      )}
      <div className="pointer-events-none absolute inset-y-0 w-px bg-danger" style={{ left: x(time) }}>
        <div className="absolute -top-0.5 -left-[4px] h-0 w-0 border-x-[4px] border-t-[6px] border-x-transparent border-t-danger" />
      </div>
    </div>
  );
}

/** One media file on its own: mark the part to use and put it on the timeline. */
export function SourceView({ m }: { m: Media }) {
  const playing = useStore((s) => s.sourcePlaying);
  const time = useStore((s) => s.sourceTime);
  const range = useStore((s) => s.source);
  const info = useStore((s) => s.media[m.id]);
  const url = source.sourceUrl(m);
  const [failed, setFailed] = useState<string | null>(null);
  const marked = range && (range.in !== null || range.out !== null) ? span(range, m.duration) : null;
  const btn = "rounded-md p-1.5 text-dim hover:bg-white/10 hover:text-fg";
  const markBtn = "flex items-center gap-1.5 rounded-md border border-line px-2 py-1 text-xs hover:bg-white/5";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="relative flex min-h-0 flex-1 items-center justify-center bg-black/30 p-4">
        {url ? (
          <video
            key={url}
            ref={source.attachSourceVideo}
            src={url}
            playsInline
            preload="auto"
            className="max-h-full max-w-full bg-black shadow-xl shadow-black/40"
            onError={() => setFailed(url)}
            onClick={() => source.toggle()}
          />
        ) : (
          <div className="text-sm text-dim">ファイルが見つかりません: {m.name}</div>
        )}
        {url && failed === url && (
          <div className="absolute inset-0 flex items-center justify-center bg-panel/90 text-sm text-dim">
            {info?.status === "preparing"
              ? `プレビューを準備しています… ${info.ratio ? `${Math.floor(info.ratio * 100)}%` : ""}`
              : `再生できません: ${m.name}`}
          </div>
        )}
      </div>
      <div className="shrink-0 border-t border-line px-4 pt-3 pb-2">
        <RangeBar m={m} />
        <div className="mt-2 flex items-center gap-1">
          <span className="w-56 text-xs tabular-nums">
            {timecode(time)} <span className="text-dim">/ {timecode(m.duration)}</span>
          </span>
          <div className="flex flex-1 items-center justify-center gap-1">
            <button className={btn} onClick={() => source.seek(0)} title="先頭へ（Home）">
              <SkipBack size={16} />
            </button>
            <button className={btn} onClick={() => source.step(-1)} title="1 コマ戻る（←）">
              <StepBack size={16} />
            </button>
            <button
              className="mx-1 flex h-8 w-8 items-center justify-center rounded-full bg-fg text-bg hover:brightness-90"
              onClick={() => source.toggle()}
              title="再生 / 一時停止（スペース）"
            >
              {playing ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" className="ml-0.5" />}
            </button>
            <button className={btn} onClick={() => source.step(1)} title="1 コマ進む（→）">
              <StepForward size={16} />
            </button>
            <button className={btn} onClick={() => source.seek(m.duration)} title="最後へ（End）">
              <SkipForward size={16} />
            </button>
          </div>
          <span className="w-56 text-right text-xs whitespace-nowrap text-dim tabular-nums">
            {marked ? `${timecode(marked.start)} 〜 ${timecode(marked.end)}（${seconds(marked.end - marked.start)}）` : "全体"}
          </span>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button className={markBtn} onClick={() => source.markPoint("in")} title="開始点を決める（I）">
            <kbd className="rounded border border-line px-1 text-[10px]">I</kbd>
            ここから
          </button>
          <button className={markBtn} onClick={() => source.markPoint("out")} title="終了点を決める（O）">
            <kbd className="rounded border border-line px-1 text-[10px]">O</kbd>
            ここまで
          </button>
          {marked && (
            <button className="text-xs text-dim hover:text-fg" onClick={() => source.clearMarks()}>
              消す
            </button>
          )}
          <div className="flex-1" />
          <button className={markBtn} onClick={() => insertSourceRange("end")} title="範囲を最後に足す（.）">
            <ListEnd size={14} />
            最後に足す
          </button>
          <button
            className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1 text-xs font-medium text-white hover:brightness-110"
            onClick={() => insertSourceRange()}
            title="範囲を再生位置に入れる（,）"
          >
            <ArrowDownToLine size={14} />
            再生位置に入れる
          </button>
        </div>
      </div>
    </div>
  );
}

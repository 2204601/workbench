import { ArrowUpToLine, Trash2 } from "lucide-react";
import { useRef } from "react";
import type { Annot, AnnotKind } from "../lib/api";
import { runCommand } from "../lib/commands";
import { updateAnnot } from "../lib/edit";
import { readingSize } from "../lib/geometry";
import { TEXT_PADDING, textHeight, wrapText } from "../lib/text";
import { activeDoc, findAnnot, useStore, type Tool, type ToolStyle } from "../store";

const st = () => useStore.getState();

const PEN_COLORS = ["#e5383b", "#f77f00", "#ffd400", "#2a9d8f", "#1d7ff2", "#7b2cbf", "#111111", "#ffffff"];
const MARKER_COLORS = ["#ffd400", "#a3e635", "#4dd0ff", "#ff7eb6", "#ffa94d", "#c084fc"];
const FILLS = [null, "#ffffff", "#fff6bf", "#ffe3e3", "#e3f2ff", "#e6f7e9", "#111111"];
const SIZES = [8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 72];

/** What each kind lets the user change. */
const CONTROLS: Record<AnnotKind, { width?: [number, number]; fill?: boolean; size?: boolean; marker?: boolean }> = {
  highlight: { marker: true },
  underline: {},
  strikeout: {},
  ink: { width: [0.5, 12] },
  rect: { width: [0, 12], fill: true },
  ellipse: { width: [0, 12], fill: true },
  line: { width: [0.5, 12] },
  arrow: { width: [0.5, 12] },
  text: { width: [0, 4], fill: true, size: true },
  note: {},
  image: {},
};

const TOOL_KIND: Partial<Record<Tool, AnnotKind>> = {
  highlight: "highlight",
  underline: "underline",
  strikeout: "strikeout",
  text: "text",
  note: "note",
  ink: "ink",
  rect: "rect",
  ellipse: "ellipse",
  line: "line",
  arrow: "arrow",
};

/**
 * The look of the selected annotation, or of what the tool in hand makes
 * next. Shown under the toolbar when either applies.
 */
export function PropertiesBar() {
  const d = useStore(activeDoc);
  const tool = useStore((s) => s.tool);
  const styles = useStore((s) => s.styles);
  const sliding = useRef(false);
  if (!d || d.readOnly) return null;
  const sel = tool === "select" ? findAnnot(d, d.selectedAnnot) : null;
  const kind: AnnotKind | undefined = sel?.annot.kind ?? TOOL_KIND[tool];
  if (!kind) return null;
  const c = CONTROLS[kind];
  const cur: ToolStyle = sel
    ? { color: sel.annot.color, width: sel.annot.width, opacity: sel.annot.opacity, fill: sel.annot.fill, fontSize: sel.annot.fontSize }
    : styles[tool];

  /** Changes the annotation (undoably; a slider as one step) and the tool's default. */
  const change = (patch: Partial<ToolStyle>, continuous = false) => {
    const styleTool = sel ? (Object.entries(TOOL_KIND).find(([, k]) => k === kind)?.[0] as Tool | undefined) : tool;
    if (styleTool) st().setStyle(styleTool, patch);
    if (!sel) return;
    const a = sel.annot;
    const p: Partial<Annot> = { ...patch };
    // A bigger font or border makes a text box taller, as typing does.
    if (a.kind === "text" && a.rect && (patch.fontSize !== undefined || patch.width !== undefined)) {
      const size = patch.fontSize ?? a.fontSize;
      const border = patch.width ?? a.width;
      const [rw, rh] = readingSize(a.rect, a.rotation);
      const need = textHeight(wrapText(a.text, size, rw - 2 * (TEXT_PADDING + border)).length, size, border);
      if (need > rh) {
        const r = [...a.rect] as [number, number, number, number];
        const dh = need - rh;
        if (a.rotation === 90) r[2] += dh;
        else if (a.rotation === 180) r[3] += dh;
        else if (a.rotation === 270) r[0] -= dh;
        else r[1] -= dh;
        p.rect = r;
      }
    }
    if (continuous && sliding.current) st().amend((s) => updateAnnot(s, a.id, p));
    else {
      if (continuous) sliding.current = true;
      st().commit((s) => updateAnnot(s, a.id, p));
    }
  };
  const endSlide = () => (sliding.current = false);

  const colors = c.marker ? MARKER_COLORS : PEN_COLORS;
  return (
    <div className="flex h-10 shrink-0 items-center gap-3 overflow-x-auto border-b border-line bg-panel px-3 text-xs text-dim">
      <span className="shrink-0 text-fg">{sel ? "選択中の注釈" : "これから書くもの"}</span>
      {kind !== "image" && (
        <div className="flex shrink-0 items-center gap-1" role="group" aria-label={kind === "text" ? "文字の色" : "色"}>
          <span className="mr-0.5">{kind === "text" ? "文字" : "色"}</span>
          {colors.map((col) => (
            <button
              key={col}
              title={col}
              aria-label={col}
              onClick={() => change({ color: col })}
              className={`h-5 w-5 rounded-full border ${cur.color.toLowerCase() === col ? "ring-2 ring-accent ring-offset-1 ring-offset-panel" : ""}`}
              style={{ background: col, borderColor: "rgba(255,255,255,.25)" }}
            />
          ))}
          <label className="relative ml-0.5 h-5 w-5 cursor-pointer overflow-hidden rounded-full border border-white/25" title="ほかの色">
            <span className="absolute inset-0" style={{ background: "conic-gradient(red, yellow, lime, aqua, blue, magenta, red)" }} />
            <input type="color" value={cur.color} onChange={(e) => change({ color: e.target.value })} className="absolute inset-0 opacity-0" />
          </label>
        </div>
      )}
      {c.fill && (
        <div className="flex shrink-0 items-center gap-1" role="group" aria-label="塗り">
          <span className="mr-0.5">塗り</span>
          {FILLS.map((f) => (
            <button
              key={f ?? "none"}
              title={f ?? "なし"}
              aria-label={f ?? "塗りなし"}
              onClick={() => change({ fill: f })}
              className={`relative h-5 w-5 overflow-hidden rounded border border-white/25 ${cur.fill === f ? "ring-2 ring-accent ring-offset-1 ring-offset-panel" : ""}`}
              style={{ background: f ?? "transparent" }}
            >
              {!f && <span className="absolute top-1/2 left-[-2px] h-px w-[26px] -rotate-45 bg-danger" />}
            </button>
          ))}
        </div>
      )}
      {c.width && (
        <label className="flex shrink-0 items-center gap-1.5">
          {kind === "text" ? "枠線" : "太さ"}
          <input
            type="range"
            min={c.width[0]}
            max={c.width[1]}
            step={0.5}
            value={cur.width}
            onChange={(e) => change({ width: Number(e.target.value) }, true)}
            onPointerUp={endSlide}
            onBlur={endSlide}
            className="w-24 accent-accent"
          />
          <span className="w-9 text-fg tabular-nums">{cur.width} pt</span>
        </label>
      )}
      {c.size && (
        <label className="flex shrink-0 items-center gap-1.5">
          大きさ
          <select
            value={cur.fontSize}
            onChange={(e) => change({ fontSize: Number(e.target.value) })}
            className="h-6 rounded border border-line bg-bg px-1 text-fg outline-none"
          >
            {[...new Set([...SIZES, cur.fontSize])].sort((a, b) => a - b).map((n) => (
              <option key={n} value={n}>
                {n} pt
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="flex shrink-0 items-center gap-1.5">
        不透明度
        <input
          type="range"
          min={0.1}
          max={1}
          step={0.05}
          value={cur.opacity}
          onChange={(e) => change({ opacity: Number(e.target.value) }, true)}
          onPointerUp={endSlide}
          onBlur={endSlide}
          className="w-20 accent-accent"
        />
        <span className="w-8 text-fg tabular-nums">{Math.round(cur.opacity * 100)}%</span>
      </label>
      {sel && (
        <>
          <div className="flex-1" />
          <button onClick={() => runCommand("annot.front")} className="flex h-6 shrink-0 items-center gap-1 rounded px-1.5 text-fg hover:bg-white/10">
            <ArrowUpToLine size={13} />
            最前面へ
          </button>
          <button
            onClick={() => runCommand("annot.delete")}
            className="flex h-6 shrink-0 items-center gap-1 rounded px-1.5 text-fg hover:bg-danger/80 hover:text-white"
          >
            <Trash2 size={13} />
            削除
          </button>
        </>
      )}
    </div>
  );
}

import { ArrowUpToLine, Copy, Trash2, X } from "lucide-react";
import { useRef } from "react";
import type { Annot, AnnotKind } from "../lib/api";
import { command, plainTitle, runCommand } from "../lib/commands";
import { updateAnnot } from "../lib/edit";
import { bytes, formatPdfDate } from "../lib/format";
import { readingSize } from "../lib/geometry";
import { KIND_LABEL } from "../lib/hints";
import { pageBox } from "../lib/layout";
import { TEXT_PADDING, textHeight, wrapText } from "../lib/text";
import { findAnnot, useStore, type Doc, type Tool, type ToolStyle } from "../store";
import { CommandButton } from "./CommandButton";

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
  image: "image",
  fill: "text",
  date: "text",
  check: "ink",
  cross: "ink",
  dot: "ellipse",
  dash: "line",
};

/** Tools that go back to 選択 after one use, unless 続けて置く is on (UX §6). */
const ONE_SHOT: Tool[] = ["text", "rect", "ellipse", "line", "arrow", "image", "fill", "check", "cross", "dot", "dash", "date"];

/**
 * 詳細 (docs/UX.md §7), on the right: the selected annotation's look and
 * comment, or what the tool in hand will make, or the selected pages, or
 * the document itself. Every control has its word above it.
 */
export function DetailsPanel({ d }: { d: Doc }) {
  const tool = useStore((s) => s.tool);
  const sel = tool === "select" ? findAnnot(d, d.selectedAnnot) : null;
  const toolKind = tool !== "select" && tool !== "hand" ? TOOL_KIND[tool] : undefined;
  let title: string;
  let body: React.ReactNode;
  if (d.readOnly) {
    title = "文書の情報";
    body = <DocInfo d={d} />;
  } else if (sel) {
    title = `選んだもの：${KIND_LABEL[sel.annot.kind]}`;
    body = <AnnotControls sel={sel} tool={tool} />;
  } else if (tool === "eraser") {
    title = "消しゴム";
    body = (
      <p className="rounded-md bg-raised p-2.5 text-xs leading-relaxed text-dim">
        ペンで書いた線の上をなぞると、その線が消えます。マーカーや文字は、クリックで選んで Delete で消します。
      </p>
    );
  } else if (toolKind) {
    title = `これから置くもの：${KIND_LABEL[toolKind]}`;
    body = <AnnotControls sel={null} tool={tool} />;
  } else if (d.selectedPages.length) {
    title = `選んだページ：${d.selectedPages.length} ページ`;
    body = <PageControls />;
  } else {
    title = "文書の情報";
    body = <DocInfo d={d} />;
  }
  return (
    <aside className="flex w-60 shrink-0 flex-col border-l border-line bg-panel" aria-label="詳細">
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-line pr-1 pl-3">
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{title}</span>
        <button onClick={() => st().setDetails(false)} className="rounded p-1 text-dim hover:bg-hover hover:text-fg" aria-label="詳細を閉じる" title="詳細を閉じる">
          <X size={15} />
        </button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-3">{body}</div>
    </aside>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="text-xs text-dim">{label}</div>
      {children}
    </div>
  );
}

function AnnotControls({ sel, tool }: { sel: { uid: string; annot: Annot } | null; tool: Tool }) {
  const styles = useStore((s) => s.styles);
  const sticky = useStore((s) => s.sticky);
  const sliding = useRef(false);
  const kind: AnnotKind = sel?.annot.kind ?? TOOL_KIND[tool]!;
  // The marks and the date are placed as they are; only their colour varies.
  const simple = !sel && (tool === "check" || tool === "cross" || tool === "dot" || tool === "dash");
  const c = simple ? { marker: false } : CONTROLS[kind];
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
  const touched = useRef(false);
  return (
    <>
      {kind !== "image" && (
        <Field label={kind === "text" ? "文字の色" : "色"}>
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="色">
            {colors.map((col) => (
              <button
                key={col}
                title={col}
                aria-label={col}
                aria-pressed={cur.color.toLowerCase() === col}
                onClick={() => change({ color: col })}
                className={`h-6 w-6 rounded-full border border-line ${cur.color.toLowerCase() === col ? "ring-2 ring-accent ring-offset-2 ring-offset-panel" : ""}`}
                style={{ background: col }}
              />
            ))}
            <label className="relative h-6 w-6 cursor-pointer overflow-hidden rounded-full border border-line" title="ほかの色">
              <span className="absolute inset-0" style={{ background: "conic-gradient(red, yellow, lime, aqua, blue, magenta, red)" }} />
              <input type="color" value={cur.color} aria-label="ほかの色" onChange={(e) => change({ color: e.target.value })} className="absolute inset-0 opacity-0" />
            </label>
          </div>
        </Field>
      )}
      {c.fill && (
        <Field label="塗り（中の色）">
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="塗り">
            {FILLS.map((f) => (
              <button
                key={f ?? "none"}
                title={f ?? "塗りなし"}
                aria-label={f ?? "塗りなし"}
                aria-pressed={cur.fill === f}
                onClick={() => change({ fill: f })}
                className={`relative h-6 w-6 overflow-hidden rounded border border-line ${cur.fill === f ? "ring-2 ring-accent ring-offset-2 ring-offset-panel" : ""}`}
                style={{ background: f ?? "transparent" }}
              >
                {!f && <span className="absolute top-1/2 left-[-3px] h-px w-[32px] -rotate-45 bg-danger" />}
              </button>
            ))}
          </div>
        </Field>
      )}
      {c.width && (
        <Field label={kind === "text" ? "枠線の太さ" : "太さ"}>
          <div className="flex items-center gap-2">
            <input
              type="range"
              min={c.width[0]}
              max={c.width[1]}
              step={0.5}
              value={cur.width}
              aria-label="太さ"
              onChange={(e) => change({ width: Number(e.target.value) }, true)}
              onPointerUp={endSlide}
              onBlur={endSlide}
              className="min-w-0 flex-1 accent-accent"
            />
            <span className="w-12 shrink-0 text-right text-sm tabular-nums">{cur.width} pt</span>
          </div>
        </Field>
      )}
      {c.size && (
        <Field label="文字の大きさ">
          <select
            value={cur.fontSize}
            aria-label="文字の大きさ"
            onChange={(e) => change({ fontSize: Number(e.target.value) })}
            className="h-8 rounded-md border border-line bg-bg px-2 text-sm outline-none focus:border-accent"
          >
            {[...new Set([...SIZES, cur.fontSize])]
              .sort((a, b) => a - b)
              .map((n) => (
                <option key={n} value={n}>
                  {n} pt
                </option>
              ))}
          </select>
        </Field>
      )}
      <Field label="濃さ">
        <div className="flex items-center gap-2">
          <span className="text-xs text-dim">薄い</span>
          <input
            type="range"
            min={0.1}
            max={1}
            step={0.05}
            value={cur.opacity}
            aria-label="濃さ"
            onChange={(e) => change({ opacity: Number(e.target.value) }, true)}
            onPointerUp={endSlide}
            onBlur={endSlide}
            className="min-w-0 flex-1 accent-accent"
          />
          <span className="text-xs text-dim">濃い</span>
          <span className="w-10 shrink-0 text-right text-sm tabular-nums">{Math.round(cur.opacity * 100)}%</span>
        </div>
      </Field>
      {!sel && ONE_SHOT.includes(tool) && (
        <label className="flex cursor-pointer items-start gap-2">
          <input type="checkbox" checked={sticky} onChange={(e) => st().setSticky(e.target.checked)} className="mt-0.5 accent-accent" />
          <span>
            <span className="block text-sm">続けて置く</span>
            <span className="block text-xs text-dim">置いたあとも、この道具のままにします</span>
          </span>
        </label>
      )}
      {sel && sel.annot.kind !== "text" && (
        <Field label="コメント">
          <textarea
            value={sel.annot.contents}
            placeholder="メモを書けます（Acrobat でも見えます）"
            rows={3}
            onKeyDown={(e) => e.stopPropagation()}
            onFocus={() => (touched.current = false)}
            onChange={(e) => {
              const contents = e.target.value;
              if (!touched.current) st().checkpoint();
              touched.current = true;
              st().amend((s) => updateAnnot(s, sel.annot.id, { contents }));
            }}
            className="block w-full resize-y rounded-md border border-line bg-bg px-2 py-1.5 text-sm outline-none placeholder:text-dim focus:border-accent"
          />
        </Field>
      )}
      {sel && (sel.annot.author || sel.annot.modified) && (
        <div className="text-xs text-dim">
          {sel.annot.author}
          {sel.annot.modified && <span className="ml-2">{formatPdfDate(sel.annot.modified)}</span>}
        </div>
      )}
      {sel && (
        <div className="mt-auto flex flex-col gap-1 border-t border-line pt-3">
          <ActionButton id="annot.duplicate" icon={<Copy size={15} />} />
          <ActionButton id="annot.front" icon={<ArrowUpToLine size={15} />} />
          <ActionButton id="annot.delete" icon={<Trash2 size={15} />} danger />
        </div>
      )}
    </>
  );
}

/** A full-width button for a command, with its name. */
function ActionButton({ id, icon, danger }: { id: string; icon: React.ReactNode; danger?: boolean }) {
  const c = command(id);
  return (
    <button
      onClick={() => runCommand(id)}
      className={`flex h-8 items-center gap-2 rounded-md px-2 text-sm ${danger ? "hover:bg-danger hover:text-white" : "hover:bg-hover"}`}
    >
      {icon}
      {plainTitle(c)}
    </button>
  );
}

function PageControls() {
  return (
    <>
      <p className="text-xs leading-relaxed text-dim">左の一覧で選んだページに対して行います。⌘ / Ctrl を押しながらクリックすると、ページを足して選べます。</p>
      <div className="flex flex-col gap-1">
        <CommandButton id="page.rotateRight" />
        <CommandButton id="page.rotateLeft" />
        <CommandButton id="page.extract" />
        <CommandButton id="page.delete" />
      </div>
    </>
  );
}

/** Paper sizes people know, within 2 mm (either way round). */
const PAPERS: [string, number, number][] = [
  ["A3", 297, 420],
  ["A4", 210, 297],
  ["A5", 148, 210],
  ["B4", 257, 364],
  ["B5", 182, 257],
  ["レター", 216, 279],
  ["リーガル", 216, 356],
];

function paperName(wPt: number, hPt: number): string {
  const w = (wPt * 25.4) / 72;
  const h = (hPt * 25.4) / 72;
  const [a, b] = [Math.min(w, h), Math.max(w, h)];
  const landscape = w > h;
  for (const [name, pw, ph] of PAPERS) {
    if (Math.abs(a - pw) <= 2 && Math.abs(b - ph) <= 2) return `${name}（${landscape ? "横" : "縦"}）`;
  }
  return `${Math.round(w)} × ${Math.round(h)} mm`;
}

function DocInfo({ d }: { d: Doc }) {
  const page = d.pages[d.page];
  let paper = "";
  if (page) {
    const { view, rotation } = pageBox(page);
    const w = view[2] - view[0];
    const h = view[3] - view[1];
    paper = rotation % 180 === 0 ? paperName(w, h) : paperName(h, w);
  }
  const rows: [string, string][] = [
    ["ファイル", d.name],
    ["ページ数", `${d.pages.length} ページ`],
    ["いまのページの用紙", paper],
    ["ファイルの大きさ", d.size ? bytes(d.size) : ""],
    ["状態", d.readOnly ? `表示のみ（${d.readOnly}）` : d.signed ? "電子署名あり（保存すると無効になります）" : d.dirty ? "変更あり（保存していません）" : "保存済み"],
  ];
  return (
    <>
      {!d.readOnly && (
        <p className="rounded-md bg-raised p-2.5 text-xs leading-relaxed text-dim">
          ページの上のものをクリックすると、ここで色や大きさを変えられます。道具を選ぶと、これから置くものの設定が出ます。
        </p>
      )}
      <dl className="flex flex-col gap-2.5">
        {rows
          .filter(([, v]) => v)
          .map(([k, v]) => (
            <div key={k}>
              <dt className="text-xs text-dim">{k}</dt>
              <dd className="text-sm break-words">{v}</dd>
            </div>
          ))}
      </dl>
    </>
  );
}

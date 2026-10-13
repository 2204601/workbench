import { useVirtualizer } from "@tanstack/react-virtual";
import { ChevronRight } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { deleteTargetPages } from "../lib/actions";
import type { Annot } from "../lib/api";
import { updateAnnot } from "../lib/edit";
import { formatPdfDate } from "../lib/format";
import { KIND_LABEL } from "../lib/hints";
import { isMac } from "../lib/keys";
import { goToDestination } from "../lib/links";
import { getSource } from "../lib/pdfjs";
import { useStore, type Doc } from "../store";
import { CommandButton } from "./CommandButton";
import { useContextMenu } from "./ContextMenu";
import { Thumb, thumbSize } from "./Thumb";
import { pickPage, usePageDrag } from "./usePageDrag";

const st = () => useStore.getState();
const WIDTH = 132;

const PAGE_MENU = ["page.rotateLeft", "page.rotateRight", "-", "page.insertBlank", "page.insertFile", "-", "page.extract", "-", "page.delete"];

/** The left list (docs/UX.md §4): pages, 書き込み, bookmarks. */
export function Sidebar({ d }: { d: Doc }) {
  const panel = useStore((s) => s.panel);
  const setPanel = useStore((s) => s.setPanel);
  const tabs = [
    { id: "pages" as const, label: "ページ" },
    { id: "comments" as const, label: "書き込み" },
    { id: "outline" as const, label: "しおり" },
  ];
  return (
    <aside className="flex w-52 shrink-0 flex-col border-r border-line bg-panel" aria-label="一覧">
      <div className="flex shrink-0 gap-0.5 border-b border-line p-1" role="tablist">
        {tabs.map(({ id, label }) => (
          <button
            key={id}
            role="tab"
            aria-selected={panel === id}
            title={label}
            onClick={() => setPanel(id)}
            className={`flex h-8 flex-1 items-center justify-center gap-1 rounded-md text-sm whitespace-nowrap ${
              panel === id ? "bg-raised text-fg" : "text-dim hover:bg-hover hover:text-fg"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      {panel === "pages" && <PageList d={d} />}
      {panel === "comments" && <Comments d={d} />}
      {panel === "outline" && <Outline d={d} />}
    </aside>
  );
}

function PageList({ d }: { d: Doc }) {
  const scroller = useRef<HTMLDivElement>(null);
  const { drag, onPointerDown, wasDrag } = usePageDrag(scroller, "y");
  const heights = useMemo(() => d.pages.map((p) => thumbSize(p, WIDTH)[1] + 30), [d.pages]);
  const v = useVirtualizer({
    count: d.pages.length,
    getScrollElement: () => scroller.current,
    estimateSize: (i) => heights[i] ?? 210,
    overscan: 4,
  });

  // The page in view stays in view here too.
  useEffect(() => {
    v.scrollToIndex(d.page, { align: "auto" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d.page]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if ((e.key === "Delete" || e.key === "Backspace") && d.selectedPages.length && !d.readOnly) {
      e.preventDefault();
      e.stopPropagation();
      deleteTargetPages();
    } else if ((e.key === "a" || e.key === "A") && (isMac ? e.metaKey : e.ctrlKey)) {
      e.preventDefault();
      e.stopPropagation();
      st().patchDoc({ selectedPages: d.pages.map((p) => p.uid) });
    }
  };

  return (
    <>
      {/* The same things as the right-click menu, as buttons with words (UX §2). */}
      {!d.readOnly && (
        <div className="flex shrink-0 justify-center gap-0.5 border-b border-line p-1">
          <CommandButton id="page.rotateRight" label="回転" />
          <CommandButton id="page.delete" label="削除" />
          <CommandButton id="page.insertFile" label="足す" />
        </div>
      )}
    <div
      ref={scroller}
      data-virtual-list
      className="relative min-h-0 flex-1 overflow-y-auto outline-none"
      tabIndex={0}
      onKeyDown={onKeyDown}
    >
      <div style={{ height: v.getTotalSize(), position: "relative" }}>
        {v.getVirtualItems().map((row) => {
          const p = d.pages[row.index];
          const picked = d.selectedPages.includes(p.uid);
          const current = row.index === d.page;
          return (
            <div
              key={p.uid}
              data-thumb-index={row.index}
              className="absolute left-0 flex w-full flex-col items-center gap-1 pt-3"
              style={{ top: row.start, height: row.size }}
              onPointerDown={(e) => onPointerDown(e, p.uid)}
              onClick={(e) => {
                if (wasDrag()) return;
                pickPage(p.uid, e, isMac);
                st().patchDoc((x) => ({ scrollTo: { page: row.index, seq: (x.scrollTo?.seq ?? 0) + 1 } }));
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                if (!d.selectedPages.includes(p.uid)) st().patchDoc({ selectedPages: [p.uid] });
                useContextMenu.getState().open(e, PAGE_MENU);
              }}
            >
              <div
                className={`rounded-[3px] p-[3px] ${picked ? "bg-accent" : current ? "bg-line" : "bg-transparent"}`}
              >
                <Thumb item={p} width={WIDTH} />
              </div>
              <span className={`text-xs tabular-nums ${current ? "text-fg" : "text-dim"}`}>{row.index + 1}</span>
            </div>
          );
        })}
        {drag && <DropLine to={drag.to} heights={heights} />}
      </div>
      {drag && <DragLabel n={drag.uids.length} x={drag.x} y={drag.y} />}
    </div>
    </>
  );
}

function DropLine({ to, heights }: { to: number; heights: number[] }) {
  const top = heights.slice(0, to).reduce((a, b) => a + b, 0) + 4;
  return <div className="pointer-events-none absolute left-3 right-3 h-0.5 rounded bg-accent" style={{ top }} />;
}

export function DragLabel({ n, x, y }: { n: number; x: number; y: number }) {
  return (
    <div
      className="pointer-events-none fixed z-50 rounded-md bg-accent px-2 py-1 text-xs font-medium text-white shadow-lg"
      style={{ left: x + 12, top: y + 8 }}
    >
      {n} ページを移動
    </div>
  );
}

/** Every annotation, page by page; the selected one's comment can be edited. */
function Comments({ d }: { d: Doc }) {
  const rows = d.pages.flatMap((p, i) => (d.annots[p.uid] ?? []).map((a) => ({ page: i, a })));
  if (!rows.length) {
    return (
      <div className="p-4 text-center text-xs leading-relaxed text-dim">
        まだ書き込みがありません。上の「書き込み」タブのマーカーや付箋で書くと、ここに並びます。
      </div>
    );
  }
  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
      {rows.map(({ page, a }, i) => (
        <div key={a.id}>
          {(i === 0 || rows[i - 1].page !== page) && <div className="px-1.5 pt-2 pb-1 text-xs text-dim">{page + 1} ページ</div>}
          <CommentRow a={a} page={page} selected={d.selectedAnnot === a.id} readOnly={!!d.readOnly} />
        </div>
      ))}
    </div>
  );
}

function CommentRow({ a, page, selected, readOnly }: { a: Annot; page: number; selected: boolean; readOnly: boolean }) {
  const touched = useRef(false);
  const preview = a.kind === "text" ? a.text : a.contents;
  return (
    <div
      onClick={() => {
        st().setTool("select");
        st().patchDoc((x) => ({ selectedAnnot: a.id, scrollTo: { page, seq: (x.scrollTo?.seq ?? 0) + 1 } }));
      }}
      className={`mb-1 cursor-pointer rounded-md border px-2 py-1.5 ${selected ? "border-accent bg-raised" : "border-transparent hover:bg-raised"}`}
    >
      <div className="flex items-center gap-1.5 text-xs text-dim">
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: a.color }} />
        <span className="text-fg">{KIND_LABEL[a.kind]}</span>
        <span className="min-w-0 flex-1 truncate">{a.author}</span>
      </div>
      {selected && a.kind !== "text" ? (
        <textarea
          value={a.contents}
          readOnly={readOnly}
          placeholder="コメントを入力"
          rows={3}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
          onFocus={() => (touched.current = false)}
          onChange={(e) => {
            const contents = e.target.value;
            if (!touched.current) st().checkpoint();
            touched.current = true;
            st().amend((s) => updateAnnot(s, a.id, { contents }));
          }}
          className="mt-1 block w-full resize-y rounded border border-line bg-bg px-1.5 py-1 text-xs outline-none focus:border-accent"
        />
      ) : (
        preview && <div className="mt-0.5 line-clamp-3 text-xs break-words whitespace-pre-wrap">{preview}</div>
      )}
      {a.modified && <div className="mt-0.5 text-xs text-dim">{formatPdfDate(a.modified)}</div>}
    </div>
  );
}

interface OutlineItem {
  title: string;
  dest: unknown;
  items: OutlineItem[];
}

/** The bookmarks of the tab's first file (pdf.js's outline). */
function Outline({ d }: { d: Doc }) {
  const source = d.sources[0];
  const [items, setItems] = useState<OutlineItem[] | null>(null);
  useEffect(() => {
    let gone = false;
    setItems(null);
    getSource(source)
      ?.pdf.getOutline()
      .then((o) => !gone && setItems((o as OutlineItem[] | null) ?? []))
      .catch(() => !gone && setItems([]));
    return () => {
      gone = true;
    };
  }, [source]);
  if (items === null) return <div className="p-4 text-center text-xs text-dim">読み込んでいます…</div>;
  if (!items.length) return <div className="p-4 text-center text-xs text-dim">しおりはありません</div>;
  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-1.5 text-sm">
      {items.map((it, i) => (
        <OutlineNode key={i} it={it} source={source} depth={0} />
      ))}
    </div>
  );
}

function OutlineNode({ it, source, depth }: { it: OutlineItem; source: number; depth: number }) {
  const [open, setOpen] = useState(depth === 0 && it.items.length < 12);
  return (
    <div>
      <div className="flex items-start rounded hover:bg-raised" style={{ paddingLeft: depth * 12 }}>
        <button
          className={`mt-1 shrink-0 p-0.5 text-dim ${it.items.length ? "" : "invisible"}`}
          onClick={() => setOpen(!open)}
          aria-label={open ? "閉じる" : "開く"}
        >
          <ChevronRight size={12} className={open ? "rotate-90" : ""} />
        </button>
        <button className="min-w-0 flex-1 py-1 pr-1 text-left leading-snug break-words" onClick={() => void goToDestination(source, it.dest)}>
          {it.title}
        </button>
      </div>
      {open && it.items.map((c, i) => <OutlineNode key={i} it={c} source={source} depth={depth + 1} />)}
    </div>
  );
}

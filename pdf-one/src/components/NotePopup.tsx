import { Trash2 } from "lucide-react";
import { useRef } from "react";
import type { Annot } from "../lib/api";
import { removeAnnot, updateAnnot } from "../lib/edit";
import { rectToScreen, type Matrix } from "../lib/geometry";
import { formatPdfDate } from "../lib/format";
import { useStore } from "../store";

const st = () => useStore.getState();

/** A sticky note's comment, next to it while it is selected. */
export function NotePopup({ annot, matrix, readOnly }: { annot: Annot; matrix: Matrix; readOnly: boolean }) {
  const touched = useRef(false);
  if (!annot.rect) return null;
  const [, y1, x2] = rectToScreen(matrix, annot.rect);
  return (
    <div
      className="absolute z-10 w-60 animate-fade-in rounded-lg border border-line bg-panel text-fg shadow-xl"
      style={{ left: x2 + 8, top: y1 }}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <div className="flex items-center gap-2 border-b border-line px-2.5 py-1.5 text-xs text-dim">
        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: annot.color }} />
        <span className="min-w-0 flex-1 truncate">{annot.author || "コメント"}</span>
        <span className="shrink-0">{formatPdfDate(annot.modified)}</span>
        {!readOnly && (
          <button
            title="削除"
            aria-label="付箋を削除"
            className="rounded p-0.5 hover:bg-hover hover:text-danger"
            onClick={() => {
              st().commit((s) => removeAnnot(s, annot.id));
              st().patchDoc({ selectedAnnot: null });
            }}
          >
            <Trash2 size={13} />
          </button>
        )}
      </div>
      <textarea
        autoFocus={!annot.contents}
        readOnly={readOnly}
        value={annot.contents}
        placeholder="コメントを入力"
        rows={4}
        onFocus={() => (touched.current = false)}
        onChange={(e) => {
          const contents = e.target.value;
          if (!touched.current) st().checkpoint();
          touched.current = true;
          st().amend((s) => updateAnnot(s, annot.id, { contents }));
        }}
        className="block w-full resize-y bg-transparent px-2.5 py-2 text-sm leading-relaxed outline-none placeholder:text-dim"
      />
    </div>
  );
}

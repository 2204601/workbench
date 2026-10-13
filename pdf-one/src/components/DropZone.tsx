import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { FileDown } from "lucide-react";
import { useEffect, useState } from "react";
import { insertPaths, openPaths } from "../lib/actions";
import { api } from "../lib/api";
import { addAnnot } from "../lib/edit";
import { CSS_PER_PT, rectToPdf, viewportTransform } from "../lib/geometry";
import { pageBox } from "../lib/layout";
import { warn } from "../lib/log";
import { activeDoc, newAnnotId, useStore } from "../store";

const st = () => useStore.getState();
const isPdf = (p: string) => /\.pdf$/i.test(p);
const isImage = (p: string) => /\.(png|jpe?g)$/i.test(p);

/** Puts dropped pictures on the page under the pointer. */
async function dropImages(paths: string[], x: number, y: number) {
  const d = activeDoc(st());
  const el = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-page-uid]");
  const page = d?.pages.find((p) => p.uid === el?.dataset.pageUid);
  if (!d || d.readOnly || !el || !page) {
    st().toast("画像はページの上にドロップしてください", true);
    return;
  }
  const r = el.getBoundingClientRect();
  const { view, rotation } = pageBox(page);
  const px = d.scale * CSS_PER_PT;
  const m = viewportTransform(view, px, rotation);
  let off = 0;
  for (const path of paths) {
    try {
      const img = await api.addImage(path);
      const long = 85 * px;
      const ratio = img.height / (img.width || 1);
      const w = ratio > 1 ? long / ratio : long;
      const h = w * ratio;
      const cx = x - r.left + off;
      const cy = y - r.top + off;
      const id = newAnnotId();
      st().commit((s) =>
        addAnnot(s, page.uid, {
          id,
          kind: "image",
          color: "#000000",
          opacity: 1,
          width: 0,
          fill: null,
          rect: rectToPdf(m, [cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2]),
          quads: [],
          paths: [],
          line: null,
          text: "",
          lines: [],
          fontSize: 12,
          rotation,
          image: img.id,
          contents: "",
          author: st().author,
          modified: "",
        }),
      );
      st().setTool("select");
      st().patchDoc({ selectedAnnot: id });
      off += 16;
    } catch (e) {
      st().toast(String(e), true);
    }
  }
}

/**
 * Files dropped from Finder / Explorer (Tauri's drop events, Platform UI §6):
 * PDFs open in tabs, or go in as pages where pages are listed (the sidebar,
 * the page organizer); pictures go on the page they are dropped on.
 */
export function useFileDrop(): boolean {
  const [over, setOver] = useState(false);
  useEffect(() => {
    if (!isTauri()) return;
    let stop: (() => void) | undefined;
    let gone = false;
    getCurrentWebview()
      .onDragDropEvent((e) => {
        const p = e.payload;
        if (p.type === "enter") setOver(p.paths.some(isPdf));
        else if (p.type === "leave") setOver(false);
        else if (p.type === "drop") {
          setOver(false);
          const ratio = window.devicePixelRatio || 1;
          const x = p.position.x / ratio;
          const y = p.position.y / ratio;
          const pdfs = p.paths.filter(isPdf);
          const images = p.paths.filter(isImage);
          if (images.length) void dropImages(images, x, y);
          if (!pdfs.length) {
            if (!images.length) st().toast("PDF か画像（PNG・JPEG）をドロップしてください", true);
            return;
          }
          const target = document.elementFromPoint(x, y);
          const thumb = target?.closest<HTMLElement>("[data-thumb-index]");
          const list = target?.closest("aside, [data-organizer]");
          const d = activeDoc(st());
          if (d && !d.readOnly && (thumb || list)) {
            void insertPaths(pdfs, thumb ? Number(thumb.dataset.thumbIndex) + 1 : d.pages.length);
          } else {
            void openPaths(pdfs);
          }
        }
      })
      .then((un) => (gone ? un() : (stop = un)))
      .catch((e) => warn("drop", e));
    return () => {
      gone = true;
      stop?.();
    };
  }, []);
  return over;
}

export function DropOverlay() {
  return (
    <div className="pointer-events-none fixed inset-0 z-40 flex animate-fade-in items-center justify-center bg-accent/10 p-6">
      <div className="flex h-full w-full flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-accent text-accent">
        <FileDown size={40} strokeWidth={1.5} />
        <div className="text-base">ドロップして開く</div>
        <div className="text-xs text-dim">左のページ一覧や「すべてのページ」にドロップすると、ページとして足します</div>
      </div>
    </div>
  );
}

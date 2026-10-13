import { memo, useEffect, useRef, useState } from "react";
import { viewSize } from "../lib/geometry";
import { pageBox } from "../lib/layout";
import { cancelThumbnail, thumbnail } from "../lib/thumbs";
import type { PageItem } from "../store";

/** The size a page's thumbnail takes, `width` wide at most. */
export function thumbSize(p: PageItem, width: number, height = width * 1.42): [number, number] {
  const { view, rotation } = pageBox(p);
  const [w, h] = viewSize(view, 1, rotation);
  const k = Math.min(width / w, height / h);
  return [Math.round(w * k), Math.round(h * k)];
}

/** A page as a small picture, drawn when it scrolls into view. */
export const Thumb = memo(function Thumb({ item, width, height }: { item: PageItem; width: number; height?: number }) {
  const [w, h] = thumbSize(item, width, height);
  const el = useRef<HTMLDivElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  const { rotation } = pageBox(item);

  useEffect(() => {
    if (item.source === null || !el.current) return;
    const source = item.source;
    let gone = false;
    let started = false;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting) || started) return;
        started = true;
        void thumbnail(source, item.index, rotation, w).then((u) => !gone && setUrl(u));
      },
      { rootMargin: "300px" },
    );
    io.observe(el.current);
    return () => {
      gone = true;
      io.disconnect();
      cancelThumbnail(source, item.index, rotation, w);
    };
  }, [item.source, item.index, rotation, w]);

  return (
    <div ref={el} className="relative bg-white shadow shadow-black/40" style={{ width: w, height: h }}>
      {url && <img src={url} alt="" draggable={false} className="block h-full w-full select-none" />}
    </div>
  );
});

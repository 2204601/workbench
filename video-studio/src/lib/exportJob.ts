/**
 * The project as src-tauri/src/render.rs `ExportJob`: video clips by path,
 * pictures and overlays as PNGs drawn here (the same drawing as the
 * preview), at the size of the export.
 */
import type { ExportJob } from "./api";
import { loadImage } from "./images";
import { renderOverlay } from "./overlayRender";
import type { Project } from "./project";
import { layout } from "./timeline";

export type Quality = ExportJob["quality"];

/** Sizes offered: the project's, or smaller. */
export function exportSizes(p: Project): { label: string; width: number; height: number }[] {
  const even = (n: number) => Math.round(n / 2) * 2;
  const short = Math.min(p.width, p.height);
  return [1080, 720]
    .filter((s) => s <= short)
    .map((s) => ({ label: `${s}p`, width: even((p.width * s) / short), height: even((p.height * s) / short) }));
}

export async function buildJob(p: Project, width: number, height: number, quality: Quality): Promise<ExportJob> {
  const k = width / p.width;
  const duration = layout(p).duration;
  const clips: ExportJob["clips"] = [];
  for (const c of p.clips) {
    const m = p.media.find((x) => x.id === c.mediaId);
    if (!m) throw new Error("素材が見つからないクリップがあります");
    const common = { duration: c.end - c.start, volume: c.volume, transition: c.transition };
    if (m.kind === "video") {
      clips.push({ ...common, source: { kind: "video", path: m.path, start: c.start, hasAudio: m.hasAudio, fit: c.fit } });
      continue;
    }
    const img = await loadImage(m);
    if (!img) throw new Error(`画像を読めませんでした: ${m.name}`);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, width, height);
    const s = c.fit === "cover" ? Math.max(width / img.width, height / img.height) : Math.min(width / img.width, height / img.height);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, (width - img.width * s) / 2, (height - img.height * s) / 2, img.width * s, img.height * s);
    clips.push({ ...common, source: { kind: "image", png: canvas.toDataURL("image/png") } });
  }
  const overlays: ExportJob["overlays"] = p.overlays
    .filter((o) => o.start < duration && o.end > o.start)
    .map((o) => {
      const b = renderOverlay(o, p.width, p.height, k);
      return {
        png: b.canvas.toDataURL("image/png"),
        x: o.x * width,
        y: o.y * height,
        start: o.start,
        end: Math.min(o.end, duration),
        animIn: o.animIn,
        animOut: o.animOut,
      };
    });
  return { width, height, fps: p.fps, quality, clips, overlays };
}

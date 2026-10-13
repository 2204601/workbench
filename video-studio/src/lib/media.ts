/**
 * Adding files: each is probed (what it holds; Rust also lets the page play
 * it), then prepared in the background (thumbnails, waveform, and a preview
 * copy when the window can't play it).
 */
import { listen } from "@tauri-apps/api/event";
import { isTauri } from "@tauri-apps/api/core";
import { api, baseName, type MediaProgress } from "./api";
import { warn } from "./log";
import { setOnFallback } from "./player";
import { newId, type Media, type Project } from "./project";
import { useStore } from "../store";

const st = () => useStore.getState();

/** Extensions offered in the file dialog; anything ffmpeg reads works on a drop too. */
export const MEDIA_EXTENSIONS = ["mp4", "mov", "m4v", "mkv", "webm", "avi", "mts", "m2ts", "3gp", "wmv", "jpg", "jpeg", "png", "webp", "gif", "heic", "bmp"];

/** Probes `paths`; returns the media (the ones already in the project are reused). */
export async function probeFiles(p: Project, paths: string[]): Promise<Media[]> {
  const out: Media[] = [];
  const failed: string[] = [];
  for (const path of paths) {
    const have = p.media.find((m) => m.path === path);
    if (have) {
      out.push(have);
      continue;
    }
    try {
      const probe = await api.probeMedia(path);
      out.push({
        id: newId("m"),
        path,
        name: baseName(path),
        kind: probe.kind === "image" ? "image" : "video",
        duration: probe.duration,
        width: probe.width,
        height: probe.height,
        fps: probe.fps,
        hasAudio: probe.hasAudio,
      });
    } catch (e) {
      failed.push(`${baseName(path)}: ${e}`);
    }
  }
  if (failed.length) {
    st().notify({ title: `${failed.length} 個のファイルを追加できませんでした`, detail: failed.slice(0, 3).join("\n"), kind: "error" });
  }
  return out;
}

/** Makes the thumbnails etc. of `m` (once; `forceProxy` when playing the original failed). */
export async function prepare(m: Media, forceProxy = false) {
  const s = st();
  if (s.media[m.id]?.status === "preparing" && !forceProxy) return;
  s.setMedia(m.id, { ...s.media[m.id], status: "preparing", ratio: undefined });
  try {
    const prepared = await api.prepareMedia(m.id, m.path, forceProxy);
    st().setMedia(m.id, { status: "ready", prepared });
  } catch (e) {
    warn(`prepare ${m.name}`, e);
    st().setMedia(m.id, { status: "error", error: String(e) });
    st().notify({ title: `「${m.name}」のプレビューを作れませんでした`, detail: String(e), kind: "error" });
  }
}

/**
 * Opened projects: checks that each file is still there (and lets the page
 * play it again), then prepares it.
 */
export async function reattach(p: Project) {
  const missing: string[] = [];
  await Promise.all(
    p.media.map(async (m) => {
      try {
        await api.probeMedia(m.path);
        void prepare(m);
      } catch {
        missing.push(m.name);
        st().setMedia(m.id, { status: "missing" });
      }
    }),
  );
  if (missing.length) {
    st().notify({ title: `${missing.length} 個の素材が見つかりません`, detail: missing.slice(0, 5).join("、"), kind: "error" });
  }
}

/** Progress of preview copies; a fallback when the window can't play a file. */
export function listenMedia(): () => void {
  setOnFallback((m) => void prepare(m, true));
  if (!isTauri()) return () => {};
  const off = listen<MediaProgress>("media-progress", (e) => {
    const info = st().media[e.payload.id];
    if (info?.status === "preparing") st().setMedia(e.payload.id, { ...info, ratio: e.payload.ratio });
  });
  return () => void off.then((f) => f());
}

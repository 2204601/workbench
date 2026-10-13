// Typed wrappers around the Rust commands in src-tauri/src/commands.rs.
// Components call these, never `invoke` directly; the browser mock
// (src/dev/mockBackend.ts) answers the same names.
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import type { AnimKind, Fit, TransitionKind } from "./project";

/** settings.json (src-tauri/src/settings.rs). */
export interface AppSettings {
  autoUpdate: boolean;
}

/** src-tauri/src/ffmpeg.rs `Probe`. */
export interface Probe {
  kind: "video" | "image" | "audio";
  duration: number;
  width: number;
  height: number;
  fps: number;
  hasAudio: boolean;
  format: string;
  videoCodec: string;
  pixelFormat: string;
}

/** src-tauri/src/media.rs `Thumbs`: thumbnails side by side in one picture. */
export interface Thumbs {
  path: string;
  count: number;
  step: number;
  width: number;
  height: number;
}

export interface Prepared {
  proxy: string | null;
  thumbs: Thumbs | null;
  wave: string | null;
}

/** src-tauri/src/render.rs `ExportJob`. */
export interface ExportJob {
  width: number;
  height: number;
  fps: number;
  quality: "high" | "standard" | "small";
  clips: {
    source:
      | { kind: "video"; path: string; start: number; hasAudio: boolean; fit: Fit }
      | { kind: "image"; png: string };
    duration: number;
    volume: number;
    transition: { kind: TransitionKind; duration: number } | null;
  }[];
  overlays: {
    png: string;
    x: number;
    y: number;
    start: number;
    end: number;
    animIn: AnimKind;
    animOut: AnimKind;
  }[];
}

/** `export-progress` events. */
export interface ExportProgress {
  done: number;
  total: number;
}

/** `media-progress` events: a preview copy being made. */
export interface MediaProgress {
  id: string;
  ratio: number;
}

export const api = {
  getAppSettings: () => invoke<AppSettings>("get_app_settings"),
  setAppSettings: (settings: AppSettings) => invoke<AppSettings>("set_app_settings", { settings }),
  systemProxy: (url: string) => invoke<string | null>("system_proxy", { url }),
  revealLog: () => invoke<void>("reveal_log"),

  probeMedia: (path: string) => invoke<Probe>("probe_media", { path }),
  prepareMedia: (id: string, path: string, forceProxy: boolean) => invoke<Prepared>("prepare_media", { id, path, forceProxy }),
  readImage: (path: string) => invoke<ArrayBuffer>("read_image", { path }),
  exportVideo: (job: ExportJob, output: string) => invoke<{ path: string; elapsedMs: number }>("export_video", { job, output }),
  cancelExport: () => invoke<void>("cancel_export"),
  saveProject: (path: string, text: string) => invoke<void>("save_project", { path, text }),
  loadProject: (path: string) => invoke<string>("load_project", { path }),
  revealPath: (path: string) => invoke<void>("reveal_path", { path }),
  ffmpegVersion: () => invoke<string>("ffmpeg_version"),
};

/** A URL the page can load a file by. The browser mock's "paths" are blob URLs already. */
export const fileUrl = (path: string) => (/^(blob|data|https?):/.test(path) ? path : convertFileSrc(path));

/** The file name of a path, either separator. The browser mock's blob URLs carry it after "#". */
export function baseName(path: string): string {
  const hash = path.indexOf("#");
  if (path.startsWith("blob:") && hash >= 0) return decodeURIComponent(path.slice(hash + 1));
  return path.split(/[\\/]/).pop() ?? path;
}

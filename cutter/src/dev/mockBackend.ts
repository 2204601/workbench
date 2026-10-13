// Dev-only stand-in for the Rust backend, used when the UI is opened in a
// normal browser (`npm run dev`) instead of inside Tauri (Platform playbook:
// ブラウザで UI を作る). Answers the same commands as src/lib/api.ts with the
// same types; change both in the same PR.
//
// Files are picked with the browser's file input and become blob URLs (with
// the file name after "#"), which the preview plays directly. There are no
// thumbnails or waveforms, and no export: those need ffmpeg.
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import type { AppSettings, Probe } from "../lib/api";

let settings: AppSettings = { autoUpdate: true };

const IMAGE = /\.(jpe?g|png|webp|gif|bmp|heic)$/i;

function nameOf(url: string) {
  const i = url.indexOf("#");
  return i >= 0 ? decodeURIComponent(url.slice(i + 1)) : url;
}

async function probe(url: string): Promise<Probe> {
  const base = { format: "mock", videoCodec: "h264", pixelFormat: "yuv420p", fps: 30 };
  if (IMAGE.test(nameOf(url))) {
    const img = new Image();
    img.src = url;
    await img.decode();
    return { ...base, kind: "image", duration: 0, width: img.naturalWidth, height: img.naturalHeight, hasAudio: false };
  }
  const v = document.createElement("video");
  v.preload = "metadata";
  v.src = url;
  await new Promise<void>((ok, fail) => {
    v.onloadedmetadata = () => ok();
    v.onerror = () => fail("動画・画像として読めないファイルです");
  });
  return { ...base, kind: "video", duration: v.duration, width: v.videoWidth, height: v.videoHeight, hasAudio: true };
}

/** The browser's file picker, as the dialog plugin's `open`. */
function pick(multiple: boolean, accept: string): Promise<string[] | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = multiple;
    input.accept = accept;
    input.onchange = () => {
      const files = [...(input.files ?? [])];
      resolve(files.length ? files.map((f) => `${URL.createObjectURL(f)}#${encodeURIComponent(f.name)}`) : null);
    };
    input.oncancel = () => resolve(null);
    input.click();
  });
}

const projects = new Map<string, string>();

async function handle(cmd: string, a: Record<string, unknown>): Promise<unknown> {
  switch (cmd) {
    case "get_app_settings":
      return settings;
    case "set_app_settings":
      settings = a.settings as AppSettings;
      return settings;
    case "system_proxy":
      return null;
    case "reveal_log":
    case "reveal_path":
    case "cancel_export":
      return null;
    case "ffmpeg_version":
      return "ffmpeg (mock)";
    case "probe_media":
      return probe(a.path as string);
    case "prepare_media":
      await new Promise((r) => setTimeout(r, 300));
      return { proxy: null, thumbs: null, wave: null };
    case "export_video":
      // Kept for a look from the console (and the end-to-end check in docs/ARCHITECTURE.md).
      (window as unknown as { lastExportJob: unknown }).lastExportJob = a.job;
      throw "ブラウザ版では書き出せません（ffmpeg が要ります）。npm run tauri dev で試してください";
    case "save_project":
      projects.set(a.path as string, a.text as string);
      return null;
    case "load_project": {
      const text = projects.get(a.path as string);
      if (text === undefined) throw "開けませんでした: このブラウザで保存したプロジェクトがありません";
      return text;
    }
    case "plugin:dialog|open": {
      const o = (a.options ?? {}) as { multiple?: boolean; filters?: { extensions: string[] }[] };
      const exts = o.filters?.flatMap((f) => f.extensions) ?? [];
      if (exts.includes("cutter")) return [...projects.keys()].pop() ?? null;
      const files = await pick(!!o.multiple, "video/*,image/*");
      return o.multiple ? files : (files?.[0] ?? null);
    }
    case "plugin:dialog|save": {
      const o = (a.options ?? {}) as { defaultPath?: string };
      return o.defaultPath ?? "無題.cutter";
    }
    case "plugin:dialog|ask":
    case "plugin:dialog|confirm":
      return window.confirm(String((a as { message?: string }).message ?? ""));
    default:
      if (cmd.startsWith("plugin:")) return null;
      throw `mock: unknown command ${cmd}`;
  }
}

export function installMockBackend() {
  mockWindows("main");
  mockIPC((cmd, payload) => handle(cmd, (payload ?? {}) as Record<string, unknown>), { shouldMockEvents: true });
}

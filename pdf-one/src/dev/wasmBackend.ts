// A trial: the app in a normal browser with its real PDF code — the Rust of
// src-tauri/src/pdf/ built as WebAssembly (wasm/, docs/WASM.md) — instead of
// the made-up sample of mockBackend.ts. Opened with `?backend=wasm` during
// `npm run dev`, after `npm run build:wasm`.
//
// The PDF commands are answered by the engine; files are picked with the
// browser's file chooser and saved as downloads. Everything else (settings,
// drafts…) is the mock's.
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import type { ImageInfo, OpenedPdf, PageSpec, Stamp } from "../lib/api";
import { mockCommand } from "./mockBackend";

/** wasm/src/lib.rs, as wasm-bindgen exports it. */
interface Engine {
  default: (init?: { module_or_path: string }) => Promise<unknown>;
  setFont(bytes: Uint8Array, family: string): boolean;
  open(bytes: Uint8Array): string;
  takeView(id: number): Uint8Array;
  close(id: number): void;
  textLines(id: number, index: number): string;
  compose(request: string): Uint8Array;
  addImage(bytes: Uint8Array): string;
  imageBytes(id: number): Uint8Array;
}

/** Served by Vite from wasm/pkg/ (not in git: `npm run build:wasm`). */
const ENGINE = "/wasm/pkg/pdf_one_wasm.js";
/**
 * A Japanese font for the text written into PDFs: the browser can't read the
 * OS's fonts as the app does. Not in git (licence, size): put a TrueType or
 * OpenType (CFF) file there, e.g. IPAexGothic or Noto Sans JP (not variable).
 */
const FONT = "/fonts/jp.ttf";
/** The CSS family the same font is registered under, so the screen matches the file. */
const FAMILY = "PDF One Text";

let engine: Engine;
let fontFamily: string | null = null;

/** Picked files, by the made-up path the app is given for them. */
const files = new Map<string, File>();
let picked = 0;
const stamps = new Map<string, Stamp & { img: ImageInfo }>();

function pick(accept: string, multiple: boolean): Promise<string[] | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.multiple = multiple;
    input.addEventListener("change", () => {
      const paths = Array.from(input.files ?? [], (f) => {
        const path = `/ブラウザ/${++picked}/${f.name}`;
        files.set(path, f);
        return path;
      });
      resolve(paths.length ? paths : null);
    });
    input.addEventListener("cancel", () => resolve(null));
    input.click();
  });
}

async function read(path: string): Promise<Uint8Array> {
  const f = files.get(path);
  if (!f) throw "ブラウザ版では、ここで選んだファイルしか開けません";
  return new Uint8Array(await f.arrayBuffer());
}

function download(bytes: Uint8Array, path: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/pdf" }));
  a.download = path.split("/").pop() || "document.pdf";
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}

/** The engine throws strings, as the Tauri commands do. */
function call<T>(f: () => T): T {
  try {
    return f();
  } catch (e) {
    throw typeof e === "string" ? e : String(e);
  }
}

async function command(cmd: string, args?: unknown): Promise<unknown> {
  const a = (args ?? {}) as Record<string, unknown>;
  switch (cmd) {
    case "text_font_family":
      return fontFamily;
    case "plugin:dialog|open": {
      const o = (a.options ?? {}) as { directory?: boolean; multiple?: boolean; filters?: { extensions: string[] }[] };
      if (o.directory) return "/ブラウザ";
      const exts = o.filters?.flatMap((f) => f.extensions) ?? [];
      const paths = await pick(exts.map((e) => `.${e}`).join(","), !!o.multiple);
      return paths && (o.multiple ? paths : paths[0]);
    }
    case "open_pdf": {
      const path = String(a.path);
      const file = await read(path);
      const r = JSON.parse(call(() => engine.open(file)));
      const opened: OpenedPdf = { id: r.id, path, name: path.split("/").pop() ?? path, size: file.length, readOnly: r.readOnly, signed: r.signed, annots: r.annots };
      return opened;
    }
    case "pdf_view_bytes":
      return call(() => engine.takeView(Number(a.id)));
    case "close_pdf":
      engine.close(Number(a.id));
      return null;
    case "text_lines":
      return JSON.parse(call(() => engine.textLines(Number(a.id), Number(a.index))));
    case "compose_pdf":
      return call(() => engine.compose(JSON.stringify(a.request)));
    case "save_pdf": {
      const r = a.request as { path: string; pages: PageSpec[] };
      const started = performance.now();
      const bytes = call(() => engine.compose(JSON.stringify(a.request)));
      console.info(`保存（WASM）: ${r.path}、${bytes.length} バイト、${Math.round(performance.now() - started)} ms`);
      download(bytes, r.path);
      return { path: r.path, size: bytes.length, backup: null };
    }
    case "add_image": {
      const bytes = await read(String(a.path));
      return JSON.parse(call(() => engine.addImage(bytes)));
    }
    case "add_image_bytes":
      return JSON.parse(call(() => engine.addImage(args as Uint8Array)));
    case "image_bytes":
      return call(() => engine.imageBytes(Number(a.id)));
    case "list_stamps":
      return [...stamps.values()].map(({ id, name }) => ({ id, name }));
    case "add_stamp":
    case "add_stamp_bytes": {
      const bytes = cmd === "add_stamp" ? await read(String(a.path)) : (args as Uint8Array);
      const img: ImageInfo = JSON.parse(call(() => engine.addImage(bytes)));
      const name = cmd === "add_stamp" ? String(a.path).split("/").pop()!.replace(/\.[^.]+$/, "") : "署名";
      const id = `${String(stamps.size + 1).padStart(4, "0")}_${name}`;
      stamps.set(id, { id, name, img });
      return { id, name };
    }
    case "remove_stamp":
      stamps.delete(String(a.id));
      return null;
    case "use_stamp": {
      const s = stamps.get(String(a.id));
      if (!s) throw "スタンプが見つかりません";
      return s.img;
    }
    default:
      return mockCommand(cmd, args);
  }
}

async function loadFont() {
  const res = await fetch(FONT);
  if (!res.ok || !(res.headers.get("content-type") ?? "").match(/font|octet/)) {
    console.warn(`${FONT} がありません。書き込む文字は Helvetica になり、日本語は出ません`);
    return;
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (!engine.setFont(bytes.slice(), FAMILY)) {
    console.warn(`${FONT} は使えないフォントです（日本語が無い、埋め込みが禁止、可変フォントなど）`);
    return;
  }
  const face = new FontFace(FAMILY, bytes);
  document.fonts.add(await face.load());
  fontFamily = FAMILY;
}

export async function installWasmBackend() {
  const started = performance.now();
  engine = (await import(/* @vite-ignore */ ENGINE)) as Engine;
  await engine.default({ module_or_path: ENGINE.replace(/\.js$/, "_bg.wasm") });
  await loadFont();
  console.info(`WASM の準備: ${Math.round(performance.now() - started)} ms（フォント: ${fontFamily ?? "なし"}）`);
  mockWindows("main");
  mockIPC(command);
}

// Operations that go through Rust and then report back (commands.ts calls
// these; so do the start screen and the drop handler).
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { api, type Counts } from "./api";
import { bytes, count, duration } from "./format";
import { isMac } from "./keys";
import { warn } from "./log";
import { notifyIfAway } from "./osNotify";
import { useStore } from "../store";

const st = () => useStore.getState();

export const revealLabel = isMac ? "Finder で表示" : "エクスプローラーで表示";

const ZERO: Counts = { files: 0, dirs: 0, bytes: 0, path: "" };

/** Reads `path` and everything under it, then shows it (docs/SPEC.md §3). */
export async function scan(path: string) {
  if (st().scanning) return;
  const started = Date.now();
  st().setScanning({ path, counts: { ...ZERO, path }, started });
  let stop: (() => void) | undefined;
  try {
    stop = await listen<Counts>("scan-progress", (e) => {
      const s = st().scanning;
      if (s) st().setScanning({ ...s, counts: e.payload });
    });
  } catch (e) {
    warn("scan-progress", e);
  }
  try {
    const r = await api.scanFolder(path);
    st().setScanning(null);
    if (r.cancelled) {
      st().notify({ title: "スキャンを中止しました", detail: st().result ? "前の結果を表示しています" : undefined });
      return;
    }
    st().setResult(r);
    await st().go(0);
    notifyIfAway(started, "スキャンが終わりました", `${bytes(r.bytes)}・${count(r.files)} ファイル（${duration(r.elapsedMs)}）`);
    if (r.unreadable > 0) {
      st().notify({
        title: `読めないフォルダが ${count(r.unreadable)} 個ありました`,
        detail: "その中の容量は数えていません。アクセスの許可が無いフォルダなどです。",
        kind: "info",
        action: { label: "ログを表示", onClick: () => void api.revealLog().catch(() => {}) },
      });
    }
  } catch (e) {
    st().setScanning(null);
    st().notify({ title: "スキャンできませんでした", detail: String(e), kind: "error" });
  } finally {
    stop?.();
  }
}

/** ⌘O: a folder from the OS dialog. */
export async function chooseFolder() {
  try {
    const picked = await open({ directory: true, multiple: false, title: "スキャンするフォルダを選ぶ" });
    if (typeof picked === "string") await scan(picked);
  } catch (e) {
    st().toast(String(e), true);
  }
}

/** ⌘R: the same folder again, shown from its top. */
export async function rescan() {
  const r = st().result;
  if (r) await scan(r.path);
}

/** Back to the start screen; the tree is let go. */
export async function closeScan() {
  st().setResult(null);
  try {
    await api.closeScan();
  } catch (e) {
    warn("close scan", e);
  }
  void st().loadPlaces();
}

export function goUp() {
  const p = st().folder?.parent;
  if (p !== null && p !== undefined) void st().go(p);
}

/** The item picked, else the folder on screen. */
const target = () => st().selected ?? st().folder?.id ?? null;

export async function reveal(id = target()) {
  if (id === null) return;
  try {
    await api.revealItem(id);
  } catch (e) {
    st().toast(String(e), true);
  }
}

export async function copyPath(id = target()) {
  if (id === null) return;
  try {
    const path = await api.itemPath(id);
    await navigator.clipboard.writeText(path);
    st().notify({ title: "パスをコピーしました", detail: path, kind: "success", duration: 2500 });
  } catch (e) {
    st().toast(`パスをコピーできませんでした: ${e}`, true);
  }
}

/** A click on an item: a folder opens, anything else is picked. */
export function activate(id: number | null, dir: boolean) {
  if (id === null) return;
  if (dir) void st().go(id);
  else st().select(id);
}

/** Moves the pick through the list (↑ ↓). */
export function moveSelection(step: 1 | -1) {
  const items = st().folder?.items ?? [];
  if (!items.length) return;
  const i = items.findIndex((x) => x.id === st().selected);
  const next = i < 0 ? (step > 0 ? 0 : items.length - 1) : Math.max(0, Math.min(items.length - 1, i + step));
  st().select(items[next].id);
  document.querySelector(`[data-row="${items[next].id}"]`)?.scrollIntoView({ block: "nearest" });
}

/** Enter: into the picked folder. */
export function openSelected() {
  const it = st().folder?.items.find((x) => x.id === st().selected);
  if (it?.dir) void st().go(it.id);
}

/**
 * What the commands, buttons and drags do. Edits go through the store's
 * `commit` (one undo step each); the timeline functions do the arithmetic.
 */
import { isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ask, open, save } from "@tauri-apps/plugin-dialog";
import { api, baseName, type ExportProgress } from "./api";
import { buildJob, type Quality } from "./exportJob";
import { warn } from "./log";
import { MEDIA_EXTENSIONS, prepare, probeFiles, reattach } from "./media";
import { notifyIfAway } from "./osNotify";
import { currentLayout, pause, resetPlayer, seek } from "./player";
import type { TextPreset } from "./presets";
import { transitionLabel } from "./transitions";
import {
  ASPECTS,
  DEFAULT_TEXT,
  DEFAULT_TRANSITION,
  IMAGE_SECONDS,
  OVERLAY_SECONDS,
  emptyProject,
  newId,
  parseProject,
  serializeProject,
  type Aspect,
  type Clip,
  type Media,
  type Overlay,
  type TransitionKind,
} from "./project";
import {
  clipAt,
  clipOf,
  insertClips,
  insertIndexAt,
  layout,
  removeClips,
  snapToFrame,
  split,
  updateClip,
  updateOverlay,
} from "./timeline";
import { dirty, useStore } from "../store";

const st = () => useStore.getState();
const proj = () => st().project;

// ---------------------------------------------------------------- media

/** Adds files: to the media list, and onto the end of the timeline. */
export async function addFiles(paths: string[]) {
  if (!paths.length) return;
  const before = proj();
  const media = await probeFiles(before, paths);
  if (!media.length) return;
  let p = proj();
  const fresh = media.filter((m) => !p.media.some((x) => x.id === m.id));
  // The first video sets the frame's shape: a phone video makes a tall project.
  if (!p.clips.length) {
    const first = media.find((m) => m.kind === "video") ?? media[0];
    const aspect: Aspect = first.width > first.height ? "16:9" : first.width < first.height ? "9:16" : "1:1";
    p = { ...p, ...{ width: ASPECTS[aspect].width, height: ASPECTS[aspect].height } };
  }
  p = { ...p, media: [...p.media, ...fresh] };
  const clips = media.map((m) => clipOf(m, newId("c"), IMAGE_SECONDS));
  p = insertClips(p, p.clips.length, clips);
  st().commit(p);
  st().select({ kind: "clip", id: clips[0].id });
  for (const m of fresh) void prepare(m);
  st().notify({ title: `${media.length} 個の素材をタイムラインの最後に並べました`, kind: "success", duration: 3000 });
}

export async function importDialog() {
  const picked = await open({
    multiple: true,
    title: "動画・写真を追加",
    filters: [{ name: "動画・写真", extensions: [...MEDIA_EXTENSIONS, ...MEDIA_EXTENSIONS.map((e) => e.toUpperCase())] }],
  });
  if (!picked) return;
  await addFiles(Array.isArray(picked) ? picked : [picked]);
}

/** A media file onto the timeline at `index` (default: where the playhead is). */
export function addMediaToTimeline(m: Media, index?: number) {
  const p = proj();
  const at = index ?? insertIndexAt(layout(p), st().time);
  const c = clipOf(m, newId("c"), IMAGE_SECONDS);
  st().commit(insertClips(p, at, [c]));
  st().select({ kind: "clip", id: c.id });
}

export function removeMedia(m: Media) {
  const p = proj();
  if (p.clips.some((c) => c.mediaId === m.id)) {
    st().toast("タイムラインで使っている素材です。先にクリップを消してください", true);
    return;
  }
  st().commit({ ...p, media: p.media.filter((x) => x.id !== m.id) });
}

export function setAspect(a: Aspect) {
  const p = proj();
  if (p.width === ASPECTS[a].width && p.height === ASPECTS[a].height) return;
  st().commit({ ...p, width: ASPECTS[a].width, height: ASPECTS[a].height });
}

// ---------------------------------------------------------------- edits

export function splitAtPlayhead() {
  const next = split(proj(), st().time, [newId("c"), newId("c")]);
  if (!next) {
    st().toast("ここでは分割できません（クリップの端に近すぎます）", true);
    return;
  }
  st().commit(next);
  // The piece after the cut, ready to delete or move.
  const placed = clipAt(layout(next), snapToFrame(st().time, next.fps));
  if (placed) st().select({ kind: "clip", id: placed.clip.id });
}

export function deleteSelection() {
  const sel = st().selection;
  if (!sel) return;
  const p = proj();
  if (sel.kind === "clip") {
    const i = p.clips.findIndex((c) => c.id === sel.id);
    const next = removeClips(p, new Set([sel.id]));
    st().commit(next);
    const neighbour = next.clips[Math.min(i, next.clips.length - 1)];
    st().select(neighbour ? { kind: "clip", id: neighbour.id } : null);
    const d = layout(next).duration;
    if (st().time > d) seek(d);
  } else if (sel.kind === "overlay") {
    st().commit({ ...p, overlays: p.overlays.filter((o) => o.id !== sel.id) });
    st().select(null);
  } else {
    st().commit(updateClip(p, sel.id, { transition: null }));
  }
}

/** Copied clips or overlays, for paste. Within the app only. */
let clipboard: { clips: Clip[] } | { overlays: Overlay[] } | null = null;

export const canCopy = () => {
  const sel = st().selection;
  return sel?.kind === "clip" || sel?.kind === "overlay";
};
export const canPaste = () => clipboard !== null;

export function copySelection(): boolean {
  const sel = st().selection;
  const p = proj();
  if (sel?.kind === "clip") {
    const c = p.clips.find((x) => x.id === sel.id);
    if (c) clipboard = { clips: [c] };
  } else if (sel?.kind === "overlay") {
    const o = p.overlays.find((x) => x.id === sel.id);
    if (o) clipboard = { overlays: [o] };
  } else {
    return false;
  }
  return true;
}

export function cutSelection(): boolean {
  if (!copySelection()) return false;
  deleteSelection();
  return true;
}

/** Clips go after the picked clip (or at the playhead); overlays start at the playhead. */
export function paste(): boolean {
  if (!clipboard) return false;
  const p = proj();
  if ("clips" in clipboard) {
    const sel = st().selection;
    const after = sel?.kind === "clip" ? p.clips.findIndex((c) => c.id === sel.id) + 1 : 0;
    const at = after > 0 ? after : insertIndexAt(layout(p), st().time);
    const clips = clipboard.clips.map((c) => ({ ...c, id: newId("c"), transition: null }));
    st().commit(insertClips(p, at, clips));
    st().select({ kind: "clip", id: clips[0].id });
  } else {
    const t = st().time;
    const overlays = clipboard.overlays.map((o) => ({ ...o, id: newId("o"), start: t, end: t + (o.end - o.start) }));
    st().commit({ ...p, overlays: [...p.overlays, ...overlays] });
    st().select({ kind: "overlay", id: overlays[0].id });
  }
  return true;
}

export function duplicateSelection() {
  const sel = st().selection;
  const p = proj();
  if (sel?.kind === "clip") {
    const i = p.clips.findIndex((c) => c.id === sel.id);
    const c = { ...p.clips[i], id: newId("c"), transition: null };
    st().commit(insertClips(p, i + 1, [c]));
    st().select({ kind: "clip", id: c.id });
  } else if (sel?.kind === "overlay") {
    const o = p.overlays.find((x) => x.id === sel.id)!;
    const copy = { ...o, id: newId("o"), start: o.end, end: o.end + (o.end - o.start) };
    st().commit({ ...p, overlays: [...p.overlays, copy] });
    st().select({ kind: "overlay", id: copy.id });
  }
}

function addOverlay(o: Omit<Overlay, "id" | "start" | "end">) {
  const p = proj();
  const d = layout(p).duration;
  // At the playhead; at the end of the video, the last seconds.
  const start = Math.max(0, Math.min(st().time, d > OVERLAY_SECONDS ? d - OVERLAY_SECONDS : 0));
  const full = { ...o, id: newId("o"), start, end: start + OVERLAY_SECONDS };
  st().commit({ ...p, overlays: [...p.overlays, full] });
  st().select({ kind: "overlay", id: full.id });
  if (st().time < start || st().time >= full.end) seek(start);
  return full;
}

export function addText(preset: TextPreset) {
  addOverlay({
    kind: "text",
    x: 0.5,
    y: preset.y,
    scale: 1,
    rotation: 0,
    animIn: preset.animIn,
    animOut: preset.animOut,
    text: preset.text,
    style: { ...preset.style },
    stamp: "",
    color: "#ff4d4d",
  });
  // The inspector's text box, to type at once.
  requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>("[data-overlay-text]")?.select());
}

export function addStamp(stamp: string, color: string) {
  addOverlay({
    kind: "stamp",
    x: 0.5,
    y: 0.5,
    scale: 1,
    rotation: 0,
    animIn: "pop",
    animOut: "fade",
    text: "",
    style: { ...DEFAULT_TEXT },
    stamp,
    color,
  });
}

export const changeOverlay = (id: string, change: Partial<Overlay>) => st().commit(updateOverlay(proj(), id, change));
export const changeClip = (id: string, change: Partial<Clip>) => st().commit(updateClip(proj(), id, change));

/** The clip whose incoming transition the transition tab changes. */
export function transitionTarget(): string | null {
  const sel = st().selection;
  const p = proj();
  if (sel?.kind === "transition") return sel.id;
  if (sel?.kind === "clip") {
    // A picked clip: the cut after it.
    const i = p.clips.findIndex((c) => c.id === sel.id);
    return p.clips[i + 1]?.id ?? null;
  }
  return null;
}

export function setTransition(clipId: string, kind: TransitionKind | null) {
  const p = proj();
  const c = p.clips.find((x) => x.id === clipId);
  if (!c || p.clips[0]?.id === clipId) return;
  st().commit(updateClip(p, clipId, { transition: kind ? { kind, duration: c.transition?.duration ?? DEFAULT_TRANSITION.duration } : null }));
  st().select({ kind: "transition", id: clipId });
  // Show it: the playhead just before it.
  const it = layout(proj()).items.find((x) => x.clip.id === clipId);
  if (it && kind) seek(Math.max(0, it.start - 0.3));
}

export function setTransitionEverywhere(kind: TransitionKind) {
  const p = proj();
  const clips = p.clips.map((c, i) => (i === 0 ? c : { ...c, transition: { kind, duration: c.transition?.duration ?? DEFAULT_TRANSITION.duration } }));
  st().commit({ ...p, clips });
  st().notify({
    title: `すべてのつなぎ目（${Math.max(0, clips.length - 1)} か所）を「${transitionLabel(kind)}」にしました`,
    kind: "success",
    duration: 3000,
  });
}

// ---------------------------------------------------------------- playhead

/** The next / previous cut or clip edge. */
export function jumpEdit(dir: 1 | -1) {
  const l = currentLayout();
  const t = st().time;
  const edges = [0, l.duration, ...l.items.map((i) => i.start)].sort((a, b) => a - b);
  const next = dir > 0 ? edges.find((e) => e > t + 1e-6) : [...edges].reverse().find((e) => e < t - 1e-6);
  if (next !== undefined) seek(next);
}

export function stepFrames(n: number) {
  const fps = proj().fps;
  seek(snapToFrame(st().time, fps) + n / fps);
}

// ---------------------------------------------------------------- files

const PROJECT_FILTER = [{ name: "Video Studio プロジェクト", extensions: ["cutter"] }];

/** False when the user keeps the unsaved changes. */
async function confirmDiscard(): Promise<boolean> {
  if (!dirty(st())) return true;
  return ask("保存していない変更があります。保存せずに続けますか？", {
    title: "Video Studio",
    kind: "warning",
    okLabel: "保存せずに続ける",
    cancelLabel: "キャンセル",
  });
}

export async function newProject() {
  if (!(await confirmDiscard())) return;
  resetPlayer();
  st().load(emptyProject(), null);
}

export async function openProject(path?: string) {
  if (!(await confirmDiscard())) return;
  const file = path ?? (await open({ title: "プロジェクトを開く", filters: PROJECT_FILTER }));
  if (!file || Array.isArray(file)) return;
  try {
    const p = parseProject(await api.loadProject(file));
    resetPlayer();
    st().load(p, file);
    await reattach(p);
  } catch (e) {
    st().notify({ title: "開けませんでした", detail: String(e), kind: "error" });
  }
}

export async function saveProject(as = false): Promise<boolean> {
  let path = st().path;
  if (as || !path) {
    const picked = await save({ title: "プロジェクトを保存", filters: PROJECT_FILTER, defaultPath: path ?? "無題.cutter" });
    if (!picked) return false;
    path = picked.endsWith(".cutter") ? picked : `${picked}.cutter`;
  }
  const p = proj();
  try {
    await api.saveProject(path, serializeProject(p));
    // What was saved: edits made while saving stay unsaved.
    useStore.setState({ saved: p, path });
    st().notify({ title: "保存しました", detail: baseName(path), kind: "success", duration: 2500 });
    return true;
  } catch (e) {
    st().notify({ title: "保存できませんでした", detail: String(e), kind: "error" });
    return false;
  }
}

/** The window's close button: asks first when there are unsaved changes. */
export function guardClose(): () => void {
  if (!isTauri()) return () => {};
  const win = getCurrentWindow();
  const off = win.onCloseRequested(async (e) => {
    if (!dirty(st())) return;
    e.preventDefault();
    if (await confirmDiscard()) await win.destroy();
  });
  return () => void off.then((f) => f());
}

// ---------------------------------------------------------------- export

export async function exportVideo(width: number, height: number, quality: Quality) {
  const p = proj();
  if (!p.clips.length) return;
  const stem = st().path ? baseName(st().path!).replace(/\.cutter$/, "") : "動画";
  const output = await save({ title: "動画を書き出す", filters: [{ name: "MP4 動画", extensions: ["mp4"] }], defaultPath: `${stem}.mp4` });
  if (!output) return;
  const out = output.toLowerCase().endsWith(".mp4") ? output : `${output}.mp4`;
  pause();
  const started = Date.now();
  st().setExporting({ output: out, done: 0, total: layout(p).duration, started });
  const off = isTauri()
    ? await listen<ExportProgress>("export-progress", (e) => {
        const x = st().exporting;
        if (x) st().setExporting({ ...x, done: e.payload.done, total: e.payload.total });
      })
    : () => {};
  try {
    const job = await buildJob(p, width, height, quality);
    const res = await api.exportVideo(job, out);
    st().openDialog(null);
    st().notify({
      title: "書き出しました",
      detail: `${baseName(res.path)}（${Math.round(res.elapsedMs / 1000)} 秒）`,
      kind: "success",
      action: { label: isMacLabel("Finder で表示", "エクスプローラーで表示"), onClick: () => void api.revealPath(res.path) },
    });
    notifyIfAway(started, "書き出しました", baseName(res.path));
  } catch (e) {
    const msg = String(e);
    if (msg.includes("中止しました")) st().toast("書き出しを中止しました");
    else {
      warn("export", e);
      st().notify({ title: "書き出せませんでした", detail: msg, kind: "error" });
      notifyIfAway(started, "書き出せませんでした", msg);
    }
  } finally {
    off();
    st().setExporting(null);
  }
}

export const cancelExport = () => void api.cancelExport().catch(() => {});

const isMacLabel = (mac: string, other: string) => (navigator.userAgent.includes("Mac") ? mac : other);

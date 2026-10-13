// Operations that go through Rust or the OS dialogs and then report back
// (commands.ts calls these; so do the toolbar, the start screen and the drop
// handler).
import { message, open, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { api, type Annot, type FormEntry, type OpenedPdf, type PageSpec } from "./api";
import { insertPages, movePages, removePages, rotatePages, type Snap } from "./edit";
import { readingSize } from "./geometry";
import { isMac } from "./keys";
import { warn } from "./log";
import { notifyIfAway } from "./osNotify";
import { getSource, loadSource, releaseSource, type Source } from "./pdfjs";
import { TEXT_PADDING, wrapText } from "./text";
import { activeDoc, newUid, useStore, type Doc, type PageItem } from "../store";

const st = () => useStore.getState();
const doc = () => activeDoc(st());

export const revealLabel = isMac ? "Finder で表示" : "エクスプローラーで表示";

const PDF_FILTER = [{ name: "PDF", extensions: ["pdf", "PDF"] }];
const IMAGE_FILTER = [{ name: "画像（PNG・JPEG）", extensions: ["png", "jpg", "jpeg", "PNG", "JPG", "JPEG"] }];

export const baseName = (p: string) => p.split(/[\\/]/).pop() ?? p;
const dirName = (p: string) => p.slice(0, Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\")));
const sep = (p: string) => (p.includes("\\") ? "\\" : "/");
const stem = (p: string) => baseName(p).replace(/\.pdf$/i, "");

/** The pages of an opened file as tab pages, with their annotations. */
function pagesOf(src: Source, opened: OpenedPdf): Snap {
  const pages: PageItem[] = src.pages.map((_, index) => ({ uid: newUid(), source: src.id, index, rotate: 0, size: null }));
  const annots: Record<string, Annot[]> = {};
  for (const { page, annot } of opened.annots) {
    const uid = pages[page]?.uid;
    if (uid) (annots[uid] ??= []).push(annot);
  }
  return { pages, annots };
}

/** Opens a file in Rust and pdf.js. On failure, nothing stays open. */
async function openSource(path: string): Promise<{ src: Source; opened: OpenedPdf }> {
  const opened = await api.openPdf(path);
  try {
    return { src: await loadSource(opened), opened };
  } catch (e) {
    void api.closePdf(opened.id).catch(() => {});
    const name = (e as { name?: string })?.name;
    if (name === "PasswordException") throw new Error("パスワードが必要です");
    throw new Error(`PDF を表示できませんでした: ${(e as Error)?.message ?? e}`);
  }
}

/** Opens files in tabs; a file already open just comes to the front. */
export async function openPaths(paths: string[]) {
  for (const path of paths) {
    const existing = st().docs.find((d) => d.openedPath === path || d.savePath === path);
    if (existing) {
      st().setActive(existing.key);
      continue;
    }
    const started = Date.now();
    st().setBusy(`${baseName(path)} を開いています…`);
    try {
      const { src, opened } = await openSource(path);
      const snap = pagesOf(src, opened);
      st().addDoc({
        key: `d${src.id}`,
        name: opened.name,
        savePath: null,
        openedPath: path,
        sources: [src.id],
        ...snap,
        past: [],
        future: [],
        dirty: false,
        readOnly: opened.readOnly,
        signed: opened.signed,
        zoom: { mode: "fit-width" },
        scale: 1,
        page: 0,
        selectedAnnot: null,
        selectedPages: [],
        scrollTo: null,
      });
      notifyIfAway(started, "PDF を開きました", opened.name);
      if (opened.readOnly) st().notify({ title: "表示だけできます", detail: opened.readOnly, kind: "info" });
      else if (opened.signed)
        st().notify({ title: "電子署名のある PDF です", detail: "保存すると、署名は無効になります。", kind: "info" });
    } catch (e) {
      st().notify({ title: `${baseName(path)} を開けませんでした`, detail: String((e as Error)?.message ?? e), kind: "error" });
    } finally {
      st().setBusy(null);
    }
  }
}

/** ⌘O */
export async function chooseAndOpen() {
  try {
    const picked = await open({ multiple: true, filters: PDF_FILTER, title: "PDF を開く" });
    if (picked) await openPaths(Array.isArray(picked) ? picked : [picked]);
  } catch (e) {
    st().toast(String(e), true);
  }
}

/** Files the OS asked to open (double-click, "Open with"). */
export async function openRequested() {
  try {
    const paths = await api.takeOpenRequests();
    if (paths.length) await openPaths(paths);
  } catch (e) {
    warn("open requests", e);
  }
}

// ---------------------------------------------------------------- saving

/** The file a text box's lines and the forms' values are written from. */
function buildPages(d: Doc, uids?: Set<string>): PageSpec[] {
  return d.pages
    .filter((p) => !uids || uids.has(p.uid))
    .map((p) => ({
      source: p.source,
      index: p.index,
      rotate: p.rotate,
      size: p.size,
      annots: (d.annots[p.uid] ?? []).map((a) => {
        if (a.kind !== "text" || !a.rect) return a;
        const [w] = readingSize(a.rect, a.rotation);
        return { ...a, lines: wrapText(a.text, a.fontSize, w - 2 * (TEXT_PADDING + a.width)) };
      }),
    }));
}

/** Values typed into form fields (pdf.js keeps them per document). */
function formValues(d: Doc): FormEntry[] {
  const out: FormEntry[] = [];
  for (const id of d.sources) {
    const s = getSource(id);
    const map = s?.pdf.annotationStorage.serializable.map;
    if (!map) continue;
    for (const [key, v] of map as Map<string, { value?: unknown }>) {
      const value = v?.value;
      if (typeof value === "boolean" || typeof value === "string") out.push({ source: id, id: key, value });
      else if (Array.isArray(value) && value.every((x) => typeof x === "string")) out.push({ source: id, id: key, value });
    }
  }
  return out;
}

/** The name the first save offers: next to the original, "_編集" added. */
const suggested = (d: Doc) => d.savePath ?? `${dirName(d.openedPath)}${sep(d.openedPath)}${stem(d.openedPath)}_編集.pdf`;

async function askPath(title: string, defaultPath: string): Promise<string | null> {
  const p = await saveDialog({ title, defaultPath, filters: PDF_FILTER });
  if (!p) return null;
  return /\.pdf$/i.test(p) ? p : `${p}.pdf`;
}

/**
 * ⌘S writes where the tab was last saved; the first time (and ⌘⇧S) asks
 * where, offering a new name, so the original stays unless the user picks
 * it. Whatever is overwritten is kept in the backups (Rust).
 */
export async function save(as = false, key?: string): Promise<boolean> {
  const d = key ? st().docs.find((x) => x.key === key) : doc();
  if (!d) return false;
  if (d.readOnly) {
    st().notify({ title: "この PDF は保存できません", detail: d.readOnly, kind: "error" });
    return false;
  }
  let path = d.savePath;
  if (as || !path) {
    path = await askPath(as ? "名前を付けて保存" : "保存", suggested(d)).catch(() => null);
    if (!path) return false;
  }
  if (d.signed) {
    const ok = await message("この PDF には電子署名があります。保存すると署名は無効になります。保存しますか？", {
      title: "電子署名",
      kind: "warning",
      buttons: { ok: "保存", cancel: "キャンセル" },
    });
    if (ok !== "保存" && ok !== "Ok") return false;
  }
  const started = Date.now();
  st().setBusy("保存しています…");
  try {
    const r = await api.savePdf({ path, pages: buildPages(d), forms: formValues(d) });
    st().patchDoc({ savePath: r.path, name: baseName(r.path), dirty: false, signed: false }, d.key);
    st().notify({
      title: "保存しました",
      detail: r.backup ? `${r.path}\n上書きする前の版はバックアップに残しました。` : r.path,
      kind: "success",
      action: { label: revealLabel, onClick: () => void api.revealFile(r.path).catch(() => {}) },
    });
    notifyIfAway(started, "保存しました", baseName(r.path));
    return true;
  } catch (e) {
    st().notify({ title: "保存できませんでした", detail: String(e), kind: "error" });
    return false;
  } finally {
    st().setBusy(null);
  }
}

/** Pages picked in the sidebar or the organizer, else the page in view. */
export function targetPages(d: Doc): string[] {
  if (d.selectedPages.length) return d.pages.filter((p) => d.selectedPages.includes(p.uid)).map((p) => p.uid);
  const p = d.pages[d.page];
  return p ? [p.uid] : [];
}

/** Writes some pages (with their annotations) to a new file. */
export async function extractPages() {
  const d = doc();
  if (!d || d.readOnly) return;
  const uids = targetPages(d);
  if (!uids.length) return;
  const nums = uids.map((u) => d.pages.findIndex((p) => p.uid === u) + 1);
  const label = nums.length === 1 ? `p${nums[0]}` : `p${nums[0]}-${nums[nums.length - 1]}`;
  const path = await askPath("ページを書き出す", `${dirName(d.openedPath)}${sep(d.openedPath)}${stem(d.name)}_${label}.pdf`).catch(
    () => null,
  );
  if (!path) return;
  st().setBusy("書き出しています…");
  try {
    const r = await api.savePdf({ path, pages: buildPages(d, new Set(uids)), forms: formValues(d) });
    st().notify({
      title: `${uids.length} ページを書き出しました`,
      detail: r.path,
      kind: "success",
      action: { label: revealLabel, onClick: () => void api.revealFile(r.path).catch(() => {}) },
    });
  } catch (e) {
    st().notify({ title: "書き出せませんでした", detail: String(e), kind: "error" });
  } finally {
    st().setBusy(null);
  }
}

/** Splits the tab into files of `every` pages each, in a folder. */
export async function splitDocument(every: number) {
  const d = doc();
  if (!d || d.readOnly || every < 1) return;
  const folder = await open({ directory: true, title: "分割したファイルを保存するフォルダ" }).catch(() => null);
  if (typeof folder !== "string") return;
  const started = Date.now();
  const forms = formValues(d);
  let made = 0;
  try {
    for (let i = 0; i < d.pages.length; i += every) {
      const chunk = d.pages.slice(i, i + every);
      const a = i + 1;
      const b = i + chunk.length;
      st().setBusy(`分割しています…（${a}〜${b} / ${d.pages.length} ページ）`);
      const name = a === b ? `${stem(d.name)}_p${a}.pdf` : `${stem(d.name)}_p${a}-${b}.pdf`;
      await api.savePdf({ path: `${folder}${sep(folder)}${name}`, pages: buildPages(d, new Set(chunk.map((p) => p.uid))), forms });
      made++;
    }
    st().notify({
      title: `${made} 個のファイルに分けました`,
      detail: folder,
      kind: "success",
      action: { label: revealLabel, onClick: () => void api.revealFile(folder).catch(() => {}) },
    });
    notifyIfAway(started, "分割が終わりました", `${made} 個のファイル`);
  } catch (e) {
    st().notify({ title: "分割できませんでした", detail: `${made} 個まで書き出しました。${e}`, kind: "error" });
  } finally {
    st().setBusy(null);
  }
}

// ---------------------------------------------------------------- tabs

const SAVE = "保存";
const DONT = "保存しない";
const CANCEL = "キャンセル";

/** Asks about unsaved changes; false = the user cancelled. */
async function settle(d: Doc): Promise<boolean> {
  if (!d.dirty || d.readOnly) return true;
  st().setActive(d.key);
  const r = await message(`「${d.name}」の変更を保存しますか？\n保存しないと、変更は失われます。`, {
    title: "保存していない変更",
    kind: "warning",
    buttons: { yes: SAVE, no: DONT, cancel: CANCEL },
  });
  if (r === SAVE || r === "Yes") return save(false, d.key);
  return r === DONT || r === "No";
}

/** Closes a tab, letting go of the files only it used. */
export async function closeDoc(key = st().active) {
  const d = st().docs.find((x) => x.key === key);
  if (!d || !(await settle(d))) return;
  st().removeDoc(d.key);
  const still = new Set(st().docs.flatMap((x) => x.sources));
  for (const s of d.sources) if (!still.has(s)) void releaseSource(s);
}

/** Before the window closes: every tab's changes saved or let go. */
export async function settleAll(): Promise<boolean> {
  for (const d of st().docs) if (!(await settle(d))) return false;
  return true;
}

// ---------------------------------------------------------------- pages

export function rotateTarget(delta: number) {
  const d = doc();
  if (!d) return;
  const uids = targetPages(d);
  st().commit((s) => rotatePages(s, uids, delta));
}

export function deleteTargetPages() {
  const d = doc();
  if (!d) return;
  const uids = targetPages(d);
  if (uids.length >= d.pages.length) {
    st().toast("すべてのページは削除できません", true);
    return;
  }
  st().commit((s) => removePages(s, uids));
  st().patchDoc({ selectedPages: [] });
  st().notify({ title: `${uids.length} ページを削除しました`, action: { label: "元に戻す", onClick: () => st().undo() } });
}

/** A blank page after the page in view, the size it is shown at. */
export function insertBlankPage() {
  const d = doc();
  if (!d) return;
  const at = Math.min(d.page + 1, d.pages.length);
  const ref = d.pages[d.page];
  let size: [number, number] = [595.276, 841.89];
  if (ref) {
    const info = ref.source !== null ? getSource(ref.source)?.pages[ref.index] : null;
    const [w, h] = info ? [info.view[2] - info.view[0], info.view[3] - info.view[1]] : (ref.size ?? size);
    const turned = ((info?.rotate ?? 0) + ref.rotate) % 180 !== 0;
    size = turned ? [h, w] : [w, h];
  }
  const page: PageItem = { uid: newUid(), source: null, index: 0, rotate: 0, size };
  st().commit((s) => insertPages(s, at, [page]));
  st().patchDoc((x) => ({ scrollTo: { page: at, seq: (x.scrollTo?.seq ?? 0) + 1 } }));
}

/** Pages of other PDF files, after the page in view (or at `at`). */
export async function insertFromFiles(at?: number) {
  const d = doc();
  if (!d || d.readOnly) return;
  const picked = await open({ multiple: true, filters: PDF_FILTER, title: "挿入する PDF" }).catch(() => null);
  if (!picked) return;
  const paths = Array.isArray(picked) ? picked : [picked];
  await insertPaths(paths, at ?? d.page + 1);
}

export async function insertPaths(paths: string[], at: number) {
  const d = doc();
  if (!d || d.readOnly) return;
  let pos = at;
  for (const path of paths) {
    st().setBusy(`${baseName(path)} を読み込んでいます…`);
    try {
      const { src, opened } = await openSource(path);
      if (opened.readOnly) {
        void releaseSource(src.id);
        st().notify({ title: `${opened.name} は挿入できません`, detail: opened.readOnly, kind: "error" });
        continue;
      }
      const snap = pagesOf(src, opened);
      st().commit((s) => insertPages(s, pos, snap.pages, snap.annots), d.key);
      st().patchDoc((x) => ({ sources: [...x.sources, src.id] }), d.key);
      st().notify({ title: `${opened.name} の ${snap.pages.length} ページを挿入しました`, kind: "success" });
      pos += snap.pages.length;
    } catch (e) {
      st().notify({ title: `${baseName(path)} を挿入できませんでした`, detail: String((e as Error)?.message ?? e), kind: "error" });
    } finally {
      st().setBusy(null);
    }
  }
}

export function movePagesTo(uids: string[], to: number) {
  st().commit((s) => movePages(s, uids, to));
}

// ---------------------------------------------------------------- pictures

/** A picture from a file, for the image tool to put down. */
export async function chooseImage() {
  const picked = await open({ multiple: false, filters: IMAGE_FILTER, title: "画像を選ぶ" }).catch(() => null);
  if (typeof picked !== "string") return;
  try {
    const img = await api.addImage(picked);
    placePicture(img);
  } catch (e) {
    st().toast(String(e), true);
  }
}

export function placePicture(img: { id: number; width: number; height: number }) {
  st().setTool("image");
  st().setPendingImage(img);
  st().openDialog(null);
  st().notify({ title: "置く場所をクリックしてください", detail: "ドラッグすると大きさも決められます。", duration: 3500 });
}

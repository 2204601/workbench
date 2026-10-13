/**
 * 下書きの自動保存 (docs/SPEC.md「保存」): every half minute, each tab with
 * unsaved changes is written to the app's data folder (Rust: files.rs
 * `write_draft`), pictures included. The original file is never touched.
 * On the next launch, drafts that are still there are offered back
 * (RecoverDialog); a save or a "保存しない" takes the tab's draft away.
 */
import { api, type Annot, type FormEntry } from "./api";
import { baseName, formValues, openSource } from "./actions";
import { warn } from "./log";
import { getSource } from "./pdfjs";
import { newUid, useStore, type Doc, type PageItem } from "../store";

const st = () => useStore.getState();

/** How often drafts are written. */
export const INTERVAL = 30_000;

/** What a draft holds: the tab as the store has it, with file paths for its sources. */
interface DraftState {
  version: 1;
  name: string;
  openedPath: string;
  savePath: string | null;
  sources: { id: number; path: string }[];
  pages: PageItem[];
  annots: Record<string, Annot[]>;
  forms: FormEntry[];
  viewRotate: number;
}

/** What was last written for each tab, to skip unchanged ones. */
const written = new Map<string, string>();

function stateOf(d: Doc): DraftState {
  return {
    version: 1,
    name: d.name,
    openedPath: d.openedPath,
    savePath: d.savePath,
    sources: d.sources.map((id) => ({ id, path: getSource(id)?.path ?? "" })).filter((s) => s.path),
    pages: d.pages,
    annots: d.annots,
    forms: formValues(d),
    viewRotate: d.viewRotate,
  };
}

/** Writes the drafts of the tabs that changed since last time. */
export async function writeDrafts() {
  for (const d of st().docs) {
    if (!d.dirty || d.readOnly) continue;
    const json = JSON.stringify(stateOf(d));
    if (written.get(d.key) === json) continue;
    const images = [...new Set(Object.values(d.annots).flat().flatMap((a) => (a.image === null ? [] : [a.image])))];
    try {
      const id = await api.writeDraft({ path: d.openedPath, json, images });
      written.set(d.key, json);
      if (st().docs.some((x) => x.key === d.key)) st().patchDoc({ draftId: id }, d.key);
    } catch (e) {
      warn("draft", e);
    }
  }
}

/** Starts the timer; returns what stops it. */
export function startDrafts(): () => void {
  const t = setInterval(() => void writeDrafts(), INTERVAL);
  return () => clearInterval(t);
}

/** The tab's draft is no longer needed (saved, or let go). */
export async function dropDraft(key: string) {
  written.delete(key);
  const d = st().docs.find((x) => x.key === key);
  const id = d?.draftId;
  if (!id) return;
  st().patchDoc({ draftId: null }, key);
  await api.removeDraft(id).catch((e) => warn("draft", e));
}

/**
 * Brings a draft back as a tab: opens its files again, puts the pictures
 * back in the store, and sets the form values. Unsaved until saved.
 */
export async function restoreDraft(draft: { id: string; path: string; json: string; images: [number, string][] }): Promise<boolean> {
  let state: DraftState;
  try {
    state = JSON.parse(draft.json) as DraftState;
    if (state.version !== 1 || !Array.isArray(state.pages)) throw new Error("形式が違います");
  } catch (e) {
    st().notify({ title: "下書きを読めませんでした", detail: String((e as Error)?.message ?? e), kind: "error" });
    return false;
  }
  st().setBusy(`${baseName(draft.path)} の下書きを戻しています…`);
  const sourceIds = new Map<number, number>();
  const opened: { src: Awaited<ReturnType<typeof openSource>>["src"]; size: number; signed: boolean }[] = [];
  try {
    for (const s of state.sources) {
      const r = await openSource(s.path);
      if (r.opened.readOnly) throw new Error(`${r.opened.name}：${r.opened.readOnly}`);
      sourceIds.set(s.id, r.src.id);
      opened.push({ src: r.src, size: r.opened.size, signed: r.opened.signed });
    }
    const imageIds = new Map<number, number>();
    for (const [old, path] of draft.images) {
      try {
        imageIds.set(old, (await api.addImage(path)).id);
      } catch (e) {
        warn("draft image", e);
      }
    }
    const uids = new Map<string, string>();
    const pages: PageItem[] = state.pages.map((p) => {
      const uid = newUid();
      uids.set(p.uid, uid);
      return { ...p, uid, source: p.source === null ? null : (sourceIds.get(p.source) ?? null) };
    });
    if (pages.some((p) => p.source === null && !p.size)) throw new Error("ページの情報が足りません");
    const annots: Record<string, Annot[]> = {};
    let lost = 0;
    for (const [uid, list] of Object.entries(state.annots)) {
      const to = uids.get(uid);
      if (!to) continue;
      annots[to] = list.flatMap((a) => {
        if (a.image === null) return [a];
        const image = imageIds.get(a.image);
        if (image === undefined) {
          lost++;
          return [];
        }
        return [{ ...a, image }];
      });
    }
    for (const f of state.forms) {
      const id = sourceIds.get(f.source);
      const pdf = id === undefined ? undefined : getSource(id)?.pdf;
      pdf?.annotationStorage.setValue(f.id, { value: f.value });
    }
    const first = opened[0];
    if (!first) throw new Error("元のファイルがありません");
    const key = `d${first.src.id}`;
    st().addDoc({
      key,
      name: state.name,
      savePath: state.savePath,
      openedPath: state.openedPath,
      size: first.size,
      savedAt: null,
      draftId: draft.id,
      sources: opened.map((o) => o.src.id),
      pages,
      annots,
      past: [],
      future: [],
      dirty: true,
      readOnly: null,
      signed: opened.some((o) => o.signed),
      zoom: { mode: "fit-width" },
      scale: 1,
      fitPage: 0,
      page: 0,
      pageOffset: 0,
      selectedAnnot: null,
      selectedPages: [],
      scrollTo: null,
      viewRotate: state.viewRotate ?? 0,
    });
    written.set(key, draft.json);
    st().notify({
      title: "下書きを戻しました",
      detail: `保存するまでファイルは変わりません。${lost ? `画像 ${lost} 個は戻せませんでした。` : ""}`,
      kind: "success",
      duration: 7000,
    });
    return true;
  } catch (e) {
    st().notify({ title: "下書きを戻せませんでした", detail: String((e as Error)?.message ?? e), kind: "error" });
    return false;
  } finally {
    st().setBusy(null);
  }
}

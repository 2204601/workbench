// Operations that go through dialogs or long tasks: reading folders and files.
import { listen } from "@tauri-apps/api/event";
import { ask, open } from "@tauri-apps/plugin-dialog";
import { api, type Outcome, type ScanSummary } from "./api";
import { count } from "./format";
import { warn } from "./log";
import { notifyIfAway } from "./osNotify";
import { useStore } from "../store";

const st = () => useStore.getState();

/** Reads folders / files into the list. `replace` starts a new list; null decides by what was dropped. */
export async function addPaths(paths: string[], replace: boolean | null) {
  if (!paths.length || st().task) return;
  const since = Date.now();
  st().setTask({ label: "読み込んでいます…", done: 0, total: null });
  const stop = await listen<{ done: number }>("scan-progress", (e) =>
    st().setTask({ label: "読み込んでいます…", done: e.payload.done, total: null }),
  ).catch(() => () => {});
  let summary: ScanSummary;
  try {
    summary = await api.addPaths(paths, replace);
  } catch (e) {
    st().toast(String(e), true);
    return;
  } finally {
    stop();
    st().setTask(null);
  }
  if (summary.cancelled) {
    st().notify({ title: "読み込みを中止しました", detail: "一覧は読み込む前のままです" });
    return;
  }
  // A new list numbers its files from 1 again: earlier ticks and selection don't apply.
  if (summary.replaced)
    useStore.setState({ unchecked: new Set(), selected: new Set(), focus: null, anchor: null, paused: false });
  await st().refresh();
  reportScan(summary, since);
}

function reportScan(s: ScanSummary, since: number) {
  const notes = [
    s.duplicates ? `${count(s.duplicates)} 件は一覧にあります` : "",
    s.excluded ? `隠しファイルなど ${count(s.excluded)} 件を除きました` : "",
  ].filter(Boolean);
  if (s.failed.length) {
    for (const f of s.failed) warn("not read", f);
    st().notify({
      title: `${count(s.failed.length)} 件を読み込めませんでした`,
      detail: s.failed.slice(0, 3).join("\n") + (s.failed.length > 3 ? "\n…（詳しくはログ）" : ""),
      kind: "error",
    });
  }
  if (s.added || !s.failed.length) {
    st().notify({
      title: s.added ? `${count(s.added)} 件を読み込みました` : "読み込むファイルがありませんでした",
      detail: notes.join(" / ") || undefined,
      kind: s.added ? "success" : "info",
    });
  }
  notifyIfAway(since, "読み込みが終わりました", `${count(s.added)} 件`);
}

/** ⌘O: a folder's files make a new list. */
export async function openFolder() {
  const dir = await open({ directory: true, multiple: false, title: "名前を変えるファイルの入ったフォルダ" });
  if (typeof dir === "string") await addPaths([dir], true);
}

/** ⌘⇧O: files added to the list. */
export async function addFiles() {
  const files = await open({ directory: false, multiple: true, title: "一覧に足すファイル" });
  if (files?.length) await addPaths(files, false);
}

/**
 * Dropped from Finder / Explorer: with a folder among them, a new list
 * (like ⌘O); files only are added to it (like ⌘⇧O).
 */
export const dropPaths = (paths: string[]) => addPaths(paths, null);

export async function clearList() {
  try {
    await api.clearFiles();
    st().clearList();
  } catch (e) {
    st().toast(String(e), true);
  }
}

// ---------------------------------------------------------------- rename

/** Progress of a run or an undo, from `run-progress` events. */
async function withProgress<T>(label: string, total: number | null, work: () => Promise<T>): Promise<T> {
  st().setTask({ label, done: 0, total });
  const stop = await listen<{ done: number; total: number | null }>("run-progress", (e) =>
    st().setTask({ label, done: e.payload.done, total: e.payload.total }),
  ).catch(() => () => {});
  try {
    return await work();
  } finally {
    stop();
    st().setTask(null);
  }
}

/**
 * After a run or an undo: the list and the journal. After a run the rule
 * rests (the list shows the new names); after an undo it previews again.
 */
async function afterChange(paused = true) {
  useStore.setState({ paused });
  await Promise.all([st().refresh(), st().loadJournal()]);
}

function leftInTemp(paths: string[]) {
  if (!paths.length) return;
  st().notify({
    title: `${count(paths.length)} 件が一時的な名前のまま残りました`,
    detail: paths.slice(0, 3).join("\n") + "\n名前を手で戻してください（詳しくはログ）",
    kind: "error",
    duration: 20_000,
  });
}

function report(o: Outcome, since: number) {
  if (o.kind === "stopped") {
    useStore.setState({ stopped: o });
    return;
  }
  leftInTemp(o.leftInTemp);
  st().notify({
    title: `${count(o.renamed)} 件の名前を変更しました`,
    kind: "success",
    duration: 10_000,
    action: { label: "元に戻す", onClick: () => void undoLast(false) },
  });
  notifyIfAway(since, "名前の変更が終わりました", `${count(o.renamed)} 件`);
}

/** ⌘Enter (docs/SPEC.md §7): confirm, run, report. */
export async function runRename() {
  const s = st();
  const { changed, errors, folders } = s.listing.summary;
  if (s.task || errors > 0 || changed === 0) return;
  const network = folders.some((f) => f.network);
  const ok = await ask(
    `${count(changed)} 件の名前を変更します。` +
      (network ? "\n\nネットワーク上のフォルダです。ほかの人のショートカットや Excel のリンクが切れることがあります。" : "") +
      "\n\n直前の 1 回は「元に戻す」で戻せます。",
    { title: "名前を変更", kind: network ? "warning" : "info", okLabel: "変更する", cancelLabel: "キャンセル" },
  );
  if (!ok) return;
  const since = Date.now();
  try {
    const o = await withProgress("名前を変更しています…", changed, () => api.runRename(st().query()));
    report(o, since);
  } catch (e) {
    st().toast(String(e), true);
  }
  await afterChange();
}

/** The choices after a stop: go on skipping the file, stop here, or undo. */
export async function resumeRename() {
  useStore.setState({ stopped: null });
  const since = Date.now();
  try {
    const o = await withProgress("名前を変更しています…", null, () => api.resumeRename(true));
    report(o, since);
  } catch (e) {
    st().toast(String(e), true);
  }
  await afterChange();
}

export async function finishRename() {
  const renamed = st().stopped?.renamed ?? 0;
  useStore.setState({ stopped: null });
  try {
    leftInTemp(await api.finishRename());
    st().notify({
      title: `${count(renamed)} 件を変更して終えました`,
      detail: "残りは元の名前のままです。変更した分は「元に戻す」で戻せます",
      action: { label: "元に戻す", onClick: () => void undoLast(false) },
    });
  } catch (e) {
    st().toast(String(e), true);
  }
  await afterChange();
}

/** ⌘Z / the toast's 元に戻す (docs/SPEC.md §8). `confirm` from the menu and keys. */
export async function undoLast(confirm: boolean) {
  useStore.setState({ stopped: null });
  const j = st().journal;
  if (confirm) {
    const ok = await ask(`直前の変更（${count(j?.renamed ?? 0)} 件）を元に戻しますか？`, {
      title: "元に戻す",
      kind: "info",
      okLabel: "元に戻す",
      cancelLabel: "キャンセル",
    });
    if (!ok) return;
  }
  try {
    const r = await withProgress("元に戻しています…", j?.renamed ?? null, () => api.undoRename());
    if (r.failed.length) useStore.setState({ notUndone: r.failed });
    st().notify({
      title: r.cancelled ? `${count(r.restored)} 件を戻したところで中止しました` : `${count(r.restored)} 件を元に戻しました`,
      detail: r.failed.length ? `${count(r.failed.length)} 件は戻せませんでした` : undefined,
      kind: r.failed.length ? "error" : "success",
    });
  } catch (e) {
    st().toast(String(e), true);
  }
  await afterChange(false);
}

let launchChecked = false;

/** At launch: a run the app didn't finish (closed or crashed) — undo it or keep it. */
export async function checkInterrupted() {
  // Once: React runs effects twice in development.
  if (launchChecked) return;
  launchChecked = true;
  await st().loadJournal();
  const j = st().journal;
  if (!j?.interrupted) return;
  const ok = await ask(
    `前回の名前の変更が途中で終わっています（${count(j.renamed)} 件を変更済み）。\n\n元に戻しますか？「このままにする」では、変更した分はそのまま残ります。`,
    { title: "前回の変更", kind: "warning", okLabel: "元に戻す", cancelLabel: "このままにする" },
  );
  if (ok) await undoLast(false);
  else {
    try {
      leftInTemp(await api.finishRename());
    } catch (e) {
      st().toast(String(e), true);
    }
    await st().loadJournal();
  }
}

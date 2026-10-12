// Dev-only in-memory stand-in for the Rust backend, used when the UI is
// opened in a normal browser (`npm run dev`) instead of inside Tauri
// (Platform playbook: ブラウザで UI を作る). Answers the same commands as
// src/lib/api.ts with the same types, closely enough for UI work; change
// both in the same PR. The rules themselves are only computed in Rust.
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import type { AppSettings, JournalStatus, Listing, Outcome, Query, Row, Rule, ScanSummary, UndoReport } from "../lib/api";

let settings: AppSettings = { autoUpdate: true };

interface MockFile {
  id: number;
  dir: string;
  name: string;
  size: number;
  modified: number;
  created: number;
}

let files: MockFile[] = [];
let nextId = 0;
const network = new Set<string>();

const NAMES = ["IMG_", "DSC", "現場写真 ", "見積書_", "Report ", "ｶﾀﾛｸﾞ", "議事録（", "ＡＢＣ商事_"];
const EXTS = ["JPG", "jpg", "png", "pdf", "xlsx", "docx", "txt", "HEIC"];

/** A folder of made-up files; the "NAS" one counts as a network share. */
function fakeFolder(dir: string, n: number) {
  const out: MockFile[] = [];
  const day = 86_400_000;
  const now = Date.now();
  for (let i = 1; i <= n; i++) {
    const stem = NAMES[i % NAMES.length];
    const ext = EXTS[(i * 7) % EXTS.length];
    const name = stem.endsWith("（") ? `${stem}${i}）.${ext}` : `${stem}${String(i).padStart(4, "0")}.${ext}`;
    out.push({
      id: ++nextId,
      dir,
      name,
      size: 1000 + ((i * 7919) % 5_000_000),
      modified: now - ((i * 37) % 400) * day,
      created: now - ((i * 53) % 900) * day,
    });
  }
  if (dir.startsWith("\\\\")) network.add(dir);
  return out;
}

const extKey = (name: string) => {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(i + 1).toLowerCase() : "";
};

const collator = new Intl.Collator("ja", { numeric: true, sensitivity: "base" });

/**
 * A rough stand-in for src-tauri/src/rules, enough to see the list change
 * while working on the UI: plain replace, insert, trim, {name} and {n} in
 * templates, case. The real rules and checks are only in Rust.
 */
function roughRule(rule: Rule | null, part: string, index: number): string {
  if (!rule) return part;
  switch (rule.kind) {
    case "replace":
      return rule.regex ? part : part.split(rule.find).join(rule.with);
    case "insert":
      return rule.atEnd ? part + rule.text : rule.text + part;
    case "trim":
      return [...part].slice(rule.start, Math.max(rule.start, [...part].length - rule.end)).join("");
    case "template":
      return rule.template
        .replace(/\{name\}/g, part)
        .replace(/\{n(?::(\d+))?\}/g, (_, d) => String(rule.start + rule.step * index).padStart(Number(d ?? 0), "0"))
        .replace(/\{[mc]date:[^}]*\}/g, "20261011");
    case "normalize":
      return rule.case === "upper" ? part.toUpperCase() : rule.case === "lower" ? part.toLowerCase() : part;
  }
}

function list(q: Query): Listing {
  const needle = q.contains.toLowerCase();
  const unchecked = new Set(q.unchecked);
  const shown = files.filter(
    (f) => (!q.exts.length || q.exts.includes(extKey(f.name))) && (!needle || f.name.toLowerCase().includes(needle)),
  );
  const key = (f: MockFile) => (q.sort === "name" ? 0 : q.sort === "size" ? f.size : q.sort === "created" ? f.created : f.modified);
  shown.sort((a, b) => {
    const ord = key(a) - key(b) || collator.compare(a.name, b.name);
    return q.desc ? -ord : ord;
  });
  let index = 0;
  const rows: Row[] = shown.map((f) => {
    const checked = !unchecked.has(f.id);
    const dot = f.name.lastIndexOf(".");
    const [stem, ext] = q.includeExt || dot <= 0 ? [f.name, ""] : [f.name.slice(0, dot), f.name.slice(dot)];
    const newName = checked && q.rule ? roughRule(q.rule, stem, index++) + ext : f.name;
    return {
      id: f.id,
      dir: f.dir,
      name: f.name,
      newName,
      status: newName === f.name ? "same" : /[\\/:*?"<>|]/.test(newName) ? "error" : "change",
      message: /[\\/:*?"<>|]/.test(newName) ? "Windows で使えない文字があります" : null,
      checked,
      size: f.size,
      modified: f.modified,
      created: f.created,
    };
  });
  const exts = new Map<string, number>();
  const folders = new Map<string, number>();
  for (const f of files) {
    exts.set(extKey(f.name), (exts.get(extKey(f.name)) ?? 0) + 1);
    folders.set(f.dir, (folders.get(f.dir) ?? 0) + 1);
  }
  const ruleError = q.rule?.kind === "replace" && q.rule.regex ? "（モックでは正規表現を試せません）" : null;
  return {
    ruleError,
    rows,
    summary: {
      total: files.length,
      shown: rows.length,
      changed: rows.filter((r) => r.status === "change").length,
      warnings: 0,
      errors: rows.filter((r) => r.status === "error").length,
      exts: [...exts].sort(([a], [b]) => a.localeCompare(b)).map(([ext, count]) => ({ ext, count })),
      folders: [...folders].map(([path, count]) => ({ path, network: network.has(path), count })),
    },
  };
}

function addPaths(paths: string[], replace: boolean | null): ScanSummary {
  const hasFolder = paths.some((p) => !/\.[a-z]+$/i.test(p));
  const fresh = replace ?? hasFolder;
  if (fresh) files = [];
  let added = 0;
  for (const p of paths) {
    const made = /\.[a-z]+$/i.test(p)
      ? [{ id: ++nextId, dir: p.replace(/[\\/][^\\/]+$/, ""), name: p.split(/[\\/]/).pop()!, size: 1234, modified: Date.now(), created: Date.now() }]
      : fakeFolder(p, p.startsWith("\\\\") ? 1200 : 240);
    files.push(...made);
    added += made.length;
  }
  return { added, duplicates: 0, excluded: 2, failed: [], cancelled: false, replaced: fresh };
}

/** The last run: file id → [old name, new name]. */
let journal: { renames: [number, string, string][]; undone: boolean } | null = null;

function runRename(q: Query): Outcome {
  const l = list(q);
  if (l.summary.errors) throw "問題のある行があります。解消してから実行してください";
  const renames: [number, string, string][] = l.rows
    .filter((r) => r.checked && (r.status === "change" || r.status === "warn"))
    .map((r) => [r.id, r.name, r.newName]);
  for (const [id, , to] of renames) files.find((f) => f.id === id)!.name = to;
  journal = { renames, undone: false };
  // Try the stop dialog in the browser: a name with "ERR" stops the run.
  const bad = renames.find(([, , to]) => to.includes("ERR"));
  if (bad)
    return {
      kind: "stopped",
      renamed: renames.length - 1,
      remaining: 1,
      failure: { name: bad[1], newName: bad[2], folder: "\\\\nas01\\共有", reason: "ほかの人が開いている可能性があります" },
      leftInTemp: [],
    };
  return { kind: "completed", renamed: renames.length, leftInTemp: [] };
}

function undo(): UndoReport {
  if (!journal || journal.undone) throw "元に戻せる変更がありません";
  for (const [id, from] of journal.renames) files.find((f) => f.id === id)!.name = from;
  journal.undone = true;
  return { restored: journal.renames.length, failed: [], cancelled: false };
}

function journalStatus(): JournalStatus {
  const can = !!journal && !journal.undone;
  return { canUndo: can, interrupted: false, renamed: can ? journal!.renames.length : 0, halfway: 0, started: Date.now() };
}

async function handle(cmd: string, payload: unknown): Promise<unknown> {
  const args = (payload ?? {}) as Record<string, unknown>;
  switch (cmd) {
    case "get_app_settings":
      return settings;
    case "set_app_settings":
      settings = args.settings as AppSettings;
      return settings;
    case "system_proxy":
      return null;
    case "reveal_log":
      console.info("[mock] reveal log");
      return null;
    case "add_paths":
      // Long enough to see the progress card.
      await new Promise((r) => setTimeout(r, 400));
      return addPaths(args.paths as string[], args.replace as boolean | null);
    case "clear_files":
      files = [];
      return null;
    case "list_files":
      return list(args.query as Query);
    case "cancel_task":
      return null;
    case "run_rename":
      await new Promise((r) => setTimeout(r, 500));
      return runRename(args.query as Query);
    case "resume_rename":
      return { kind: "completed", renamed: journal?.renames.length ?? 0, leftInTemp: [] } satisfies Outcome;
    case "finish_rename":
      return [];
    case "undo_rename":
      await new Promise((r) => setTimeout(r, 300));
      return undo();
    case "journal_status":
      return journalStatus();
    // ask / message: the browser's own confirm, answering with the OK button's label.
    case "plugin:dialog|message": {
      const a = args as { message?: string; buttons?: { OkCancelCustom?: [string, string] } | string };
      const ok = typeof a.buttons === "object" && a.buttons.OkCancelCustom ? a.buttons.OkCancelCustom[0] : "Yes";
      return window.confirm(String(a.message ?? "")) ? ok : "No";
    }
    // The OS dialogs: a folder on the "NAS", or two files.
    case "plugin:dialog|open": {
      const opts = (args.options ?? {}) as { directory?: boolean };
      return opts.directory ? "\\\\nas01\\共有\\2026年度\\現場写真" : ["/Users/demo/Desktop/メモ.txt", "/Users/demo/Desktop/IMG_9999.JPG"];
    }
    default:
      if (cmd.startsWith("plugin:")) return null;
      throw new Error(`[mock] ${cmd} は未対応です`);
  }
}

export function installMockBackend() {
  mockWindows("main");
  mockIPC((cmd, payload) => handle(cmd, payload), { shouldMockEvents: true });
  console.info("[mock] in-memory backend installed");
}

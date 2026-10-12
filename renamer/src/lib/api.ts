// Typed wrappers around the Rust commands in src-tauri/src/commands.rs.
// Components call these, never `invoke` directly; the browser mock
// (src/dev/mockBackend.ts) answers the same names.
import { invoke } from "@tauri-apps/api/core";

/** settings.json (src-tauri/src/settings.rs). */
export interface AppSettings {
  autoUpdate: boolean;
}

/** Reading folders / files (src-tauri/src/scan.rs). */
export interface ScanSummary {
  added: number;
  duplicates: number;
  /** Hidden or system files left out. */
  excluded: number;
  /** "path: reason" for what couldn't be read. */
  failed: string[];
  cancelled: boolean;
  /** The list was started anew (its ids begin again). */
  replaced: boolean;
}

export type SortBy = "name" | "modified" | "created" | "size";

/** 整形 (src-tauri/src/rules/normalize.rs `Options`). */
export interface NormalizeOptions {
  width: boolean;
  kana: boolean;
  case: "keep" | "upper" | "lower" | "capitalize";
  spaces: boolean;
  /** "" keeps spaces. */
  spaceTo: string;
  forbidden: "keep" | "fullwidth" | "underscore";
  nfc: boolean;
}

/** A rule as Rust takes it (src-tauri/src/rules/mod.rs `Rule`). */
export type Rule =
  | { kind: "replace"; find: string; with: string; regex: boolean; caseSensitive: boolean; firstOnly: boolean }
  | { kind: "insert"; text: string; atEnd: boolean }
  | { kind: "trim"; start: number; end: number }
  | { kind: "template"; template: string; start: number; step: number }
  | ({ kind: "normalize" } & NormalizeOptions);

/** What the list shows (src-tauri/src/preview.rs `Query`). */
export interface Query {
  /** Extensions to show, lower case without the dot ("" = none); empty shows all. */
  exts: string[];
  contains: string;
  sort: SortBy;
  desc: boolean;
  /** Rows the user unticked: they keep their names. */
  unchecked: number[];
  /** null: every name stays. */
  rule: Rule | null;
  /** The rule applies to the extension too. */
  includeExt: boolean;
}

export type Status = "same" | "change" | "warn" | "error";

export interface Row {
  id: number;
  dir: string;
  name: string;
  newName: string;
  status: Status;
  message: string | null;
  checked: boolean;
  size: number;
  /** ms */
  modified: number;
  created: number | null;
}

export interface Summary {
  total: number;
  shown: number;
  changed: number;
  warnings: number;
  errors: number;
  exts: { ext: string; count: number }[];
  folders: { path: string; network: boolean; count: number }[];
}

export interface Listing {
  rows: Row[];
  summary: Summary;
  /** The rule can't be used; the rows are those without it. */
  ruleError: string | null;
}

/** A file that couldn't be renamed or renamed back (src-tauri/src/execute.rs). */
export interface Failure {
  name: string;
  newName: string;
  folder: string;
  reason: string;
}

export type Outcome =
  | { kind: "completed"; renamed: number; leftInTemp: string[] }
  /** Waiting for the user: failure null means they stopped it. */
  | { kind: "stopped"; renamed: number; remaining: number; failure: Failure | null; leftInTemp: string[] };

export interface UndoReport {
  restored: number;
  failed: Failure[];
  cancelled: boolean;
}

/** What the last run left (src-tauri/src/commands.rs). */
export interface JournalStatus {
  canUndo: boolean;
  /** The app closed or crashed during it. */
  interrupted: boolean;
  renamed: number;
  halfway: number;
  started: number;
}

export const api = {
  getAppSettings: () => invoke<AppSettings>("get_app_settings"),
  setAppSettings: (settings: AppSettings) => invoke<AppSettings>("set_app_settings", { settings }),
  systemProxy: (url: string) => invoke<string | null>("system_proxy", { url }),
  revealLog: () => invoke<void>("reveal_log"),

  /** `replace` null (a drop): a new list when a folder is among `paths`. */
  addPaths: (paths: string[], replace: boolean | null, includeHidden = false) =>
    invoke<ScanSummary>("add_paths", { paths, replace, includeHidden }),
  clearFiles: () => invoke<void>("clear_files"),
  listFiles: (query: Query) => invoke<Listing>("list_files", { query }),
  cancelTask: () => invoke<void>("cancel_task"),

  runRename: (query: Query) => invoke<Outcome>("run_rename", { query }),
  resumeRename: (skip: boolean) => invoke<Outcome>("resume_rename", { skip }),
  finishRename: () => invoke<string[]>("finish_rename"),
  undoRename: () => invoke<UndoReport>("undo_rename"),
  journalStatus: () => invoke<JournalStatus>("journal_status"),
};

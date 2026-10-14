// Typed wrappers around the Rust commands in src-tauri/src/commands.rs.
// Components call these, never `invoke` directly; the browser mock
// (src/dev/mockBackend.ts) answers the same names.
import { invoke } from "@tauri-apps/api/core";

/** settings.json (src-tauri/src/settings.rs). */
export interface AppSettings {
  autoUpdate: boolean;
  /** The name written on annotations; empty = the OS user name. */
  author: string;
  /** Newest first. */
  recent: string[];
  /** First-run tips already shown (src/components/Tips.tsx). */
  seenTips: string[];
}

export type AnnotKind =
  | "highlight"
  | "underline"
  | "strikeout"
  | "ink"
  | "rect"
  | "ellipse"
  | "line"
  | "arrow"
  | "text"
  | "note"
  | "image"
  | "seal"
  // A line of the page's own text that was fixed (docs/SPEC.md §文字を直す).
  | "edit";

/**
 * An annotation (src-tauri/src/pdf/mod.rs `Annot`). Coordinates are in the
 * page's PDF space: points, origin bottom left, before the page's rotation.
 */
export interface Annot {
  id: string;
  kind: AnnotKind;
  /** "#rrggbb": stroke, marker or text. */
  color: string;
  opacity: number;
  /** Line width in points; for text boxes the border (0 = none). */
  width: number;
  fill: string | null;
  /** [x1, y1, x2, y2], x1 < x2, y1 < y2. */
  rect: [number, number, number, number] | null;
  /** Text markup: per line, upper left, upper right, lower left, lower right. */
  quads: number[][];
  /** Ink strokes: x, y, x, y… */
  paths: number[][];
  /** Lines and arrows: x1, y1, x2, y2; the arrow head is at the end. */
  line: [number, number, number, number] | null;
  text: string;
  /** The text box's lines as wrapped on screen; filled in when saving. */
  lines: string[];
  fontSize: number;
  /** Text boxes and pictures: 0, 90, 180 or 270. */
  rotation: number;
  /** A picture in Rust's image store. */
  image: number | null;
  /** A seal the app draws: "round" (a date seal, three lines) or "box" (a word). Its words are `text`, one per line. */
  seal: "round" | "box" | null;
  /**
   * An `edit`'s old line: the page-content operators that drew it (a
   * `TextLine`'s `ops`). Then `text` is what it says now, `lines[0]` what it
   * said, `rect` the old line's box, `fill` the page's colour behind it
   * (to hide the old text on screen), `fontSize` and `color` as drawn now.
   */
  runs: number[];
  /** The comment. */
  contents: string;
  author: string;
  /** PDF date (D:YYYYMMDDHHmmSS…). */
  modified: string;
}

/** A line of the page's own text (src-tauri/src/pdf/textedit.rs `Line`). */
export interface TextLine {
  ops: number[];
  text: string;
  /** [x1, y1, x2, y2] around the line, in the page's PDF space. */
  rect: [number, number, number, number];
  size: number;
  color: string;
  font: string;
  editable: boolean;
  /** Why it can't be fixed (Japanese, for the user). */
  why: string;
}

export interface PageAnnot {
  /** The page's index in its document. */
  page: number;
  annot: Annot;
}

export interface OpenedPdf {
  id: number;
  path: string;
  name: string;
  size: number;
  /** Why it can only be viewed; null when it can be edited. */
  readOnly: string | null;
  /** Has a digital signature, which saving breaks. */
  signed: boolean;
  annots: PageAnnot[];
}

/** A page of the file to write (src-tauri/src/pdf/compose.rs `PageSpec`). */
export interface PageSpec {
  /** The opened document; null for a blank page. */
  source: number | null;
  index: number;
  /** Added to the page's own rotation. */
  rotate: number;
  /** A blank page's size in points. */
  size: [number, number] | null;
  annots: Annot[];
}

/** A form value typed in (pdf.js's annotation storage). */
export interface FormEntry {
  source: number;
  /** pdf.js's widget id ("12R"). */
  id: string;
  value: boolean | string | string[];
}

export interface Saved {
  path: string;
  size: number;
  /** The file it replaced, kept in the backups folder. */
  backup: string | null;
}

export interface ImageInfo {
  id: number;
  width: number;
  height: number;
}

/** A picture in the stamp library. */
export interface Stamp {
  id: string;
  name: string;
}

/** A tab's draft kept while editing (src-tauri/src/files.rs `Draft`). */
export interface Draft {
  id: string;
  /** The file the tab was opened from. */
  path: string;
  /** Milliseconds since 1970. */
  savedAt: number;
  /** The tab's state as src/lib/drafts.ts wrote it. */
  json: string;
  /** Image store id → the picture's file in the draft's folder. */
  images: [number, string][];
}

const bytes = (r: ArrayBuffer | Uint8Array | number[]) =>
  r instanceof Uint8Array ? r : r instanceof ArrayBuffer ? new Uint8Array(r) : new Uint8Array(r);

export const api = {
  getAppSettings: () => invoke<AppSettings>("get_app_settings"),
  setAppSettings: (settings: AppSettings) => invoke<AppSettings>("set_app_settings", { settings }),
  osUserName: () => invoke<string>("os_user_name"),
  textFontFamily: () => invoke<string | null>("text_font_family"),
  systemProxy: (url: string) => invoke<string | null>("system_proxy", { url }),
  revealLog: () => invoke<void>("reveal_log"),
  revealBackups: () => invoke<void>("reveal_backups"),
  revealFile: (path: string) => invoke<void>("reveal_file", { path }),
  takeOpenRequests: () => invoke<string[]>("take_open_requests"),

  openPdf: (path: string) => invoke<OpenedPdf>("open_pdf", { path }),
  /** What pdf.js shows for document `id`; can be fetched once. */
  pdfViewBytes: async (id: number) => bytes(await invoke<ArrayBuffer>("pdf_view_bytes", { id })),
  closePdf: (id: number) => invoke<void>("close_pdf", { id }),
  savePdf: (request: { path: string; pages: PageSpec[]; forms: FormEntry[] }) => invoke<Saved>("save_pdf", { request }),
  /** The file as it would be saved, as bytes (printing). */
  textLines: (id: number, index: number) => invoke<TextLine[]>("text_lines", { id, index }),
  composePdf: async (request: { pages: PageSpec[]; forms: FormEntry[] }) => bytes(await invoke<ArrayBuffer>("compose_pdf", { request })),

  addImage: (path: string) => invoke<ImageInfo>("add_image", { path }),
  addImageBytes: (data: Uint8Array) => invoke<ImageInfo>("add_image_bytes", data),
  imageBytes: async (id: number) => bytes(await invoke<ArrayBuffer>("image_bytes", { id })),
  listStamps: () => invoke<Stamp[]>("list_stamps"),
  addStamp: (path: string) => invoke<Stamp>("add_stamp", { path }),
  /** A picture drawn in the app (a signature), as PNG bytes, into the library. */
  addStampBytes: (data: Uint8Array) => invoke<Stamp>("add_stamp_bytes", data),

  writeDraft: (request: { path: string; json: string; images: number[] }) => invoke<string>("write_draft", { request }),
  listDrafts: () => invoke<Draft[]>("list_drafts"),
  removeDraft: (id: string) => invoke<void>("remove_draft", { id }),
  removeStamp: (id: string) => invoke<void>("remove_stamp", { id }),
  useStamp: (id: string) => invoke<ImageInfo>("use_stamp", { id }),
};

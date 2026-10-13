// Typed wrappers around the Rust commands in src-tauri/src/commands.rs.
// Components call these, never `invoke` directly; the browser mock
// (src/dev/mockBackend.ts) answers the same names.
import { invoke } from "@tauri-apps/api/core";

/** settings.json (src-tauri/src/settings.rs). */
export interface AppSettings {
  autoUpdate: boolean;
}

export interface Space {
  total: number;
  /** Free for this user. */
  free: number;
}

/** A drive or folder the start screen offers (src-tauri/src/places.rs). */
export interface Place {
  path: string;
  /** The volume's label; empty if it has none. */
  label: string;
  kind: "drive" | "removable" | "network" | "home";
  space: Space | null;
}

/** `scan-progress` events while a scan runs (src-tauri/src/scan.rs `Counts`). */
export interface Counts {
  files: number;
  dirs: number;
  bytes: number;
  /** The folder being read just now. */
  path: string;
}

export interface ScanSummary {
  path: string;
  network: boolean;
  files: number;
  dirs: number;
  bytes: number;
  /** The previous result stays. */
  cancelled: boolean;
  elapsedMs: number;
  /** Folders that couldn't be read, whole or in part, and "path: reason" for the first few. */
  unreadable: number;
  errors: string[];
  /** Files only in the cloud (OneDrive "online only"), counted as 0 bytes. */
  cloudFiles: number;
  cloudBytes: number;
  space: Space | null;
}

/** What a chart draws (src-tauri/src/view.rs `ViewNode`). */
export interface ViewNode {
  /** null: the gray item for the small ones folded together. */
  id: number | null;
  name: string;
  size: number;
  dir: boolean;
  files: number;
  children?: ViewNode[];
  /** How many items the folded item stands for. */
  folded: number;
}

/** A row of the list (src-tauri/src/view.rs `Item`). */
export interface Item {
  id: number;
  name: string;
  size: number;
  dir: boolean;
  files: number;
  unreadable: boolean;
}

export interface Folder {
  id: number;
  name: string;
  path: string;
  size: number;
  files: number;
  dirs: number;
  /** From the folder scanned down to this one. */
  crumbs: { id: number; name: string }[];
  /** Largest first. */
  items: Item[];
  /** Items past the limit, and their size together. */
  more: number;
  moreSize: number;
  parent: number | null;
}

export const api = {
  getAppSettings: () => invoke<AppSettings>("get_app_settings"),
  setAppSettings: (settings: AppSettings) => invoke<AppSettings>("set_app_settings", { settings }),
  systemProxy: (url: string) => invoke<string | null>("system_proxy", { url }),
  revealLog: () => invoke<void>("reveal_log"),

  listPlaces: () => invoke<Place[]>("list_places"),
  scanFolder: (path: string) => invoke<ScanSummary>("scan_folder", { path }),
  cancelScan: () => invoke<void>("cancel_scan"),
  closeScan: () => invoke<void>("close_scan"),
  /** Folds items under `minShare` of `id`'s size in every folder. */
  viewTree: (id: number, depth: number, minShare: number) => invoke<ViewNode>("view_tree", { id, depth, minShare }),
  folderInfo: (id: number, limit: number) => invoke<Folder>("folder_info", { id, limit }),
  itemPath: (id: number) => invoke<string>("item_path", { id }),
  revealItem: (id: number) => invoke<void>("reveal_item", { id }),
};

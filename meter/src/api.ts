/**
 * The Rust side (src-tauri/src/lib.rs, monitor.rs): typed wrappers, so
 * nothing else calls `invoke` or `listen` directly. In a plain browser
 * (`npm run dev`) the mock in dev/mockBackend.ts answers instead.
 */
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { mockBackend } from "./dev/mockBackend";

export type Sample = {
  at: number;
  cpu: number;
  cores: number[];
  memUsed: number;
  memTotal: number;
  swapUsed: number;
  swapTotal: number;
  diskRead: number;
  diskWrite: number;
  netDown: number;
  netUp: number;
};

export type Drive = { name: string; mount: string; total: number; available: number; removable: boolean };
export type AppUsage = { name: string; cpu: number; memory: number; count: number };
export type Processes = { byCpu: AppUsage[]; byMemory: AppUsage[] };
export type SystemInfo = {
  cpuBrand: string;
  logicalCores: number;
  physicalCores: number | null;
  os: string;
  host: string;
};

export type Snapshot = {
  info: SystemInfo;
  history: Sample[];
  drives: Drive[];
  processes: Processes;
  intervalSecs: number;
  version: string;
};

export type Update = { sample: Sample; processes: Processes; drives: Drive[] | null };

export interface Backend {
  snapshot(): Promise<Snapshot>;
  hidePopup(): Promise<void>;
  /** Each reading while the popup is open. */
  onSample(handler: (update: Update) => void): void;
  /** The popup was opened again from the tray. */
  onShown(handler: () => void): void;
}

const tauriBackend: Backend = {
  snapshot: () => invoke<Snapshot>("snapshot"),
  hidePopup: () => invoke<void>("hide_popup"),
  onSample: (handler) => void listen<Update>("sample", (e) => handler(e.payload)),
  onShown: (handler) => void listen("popup-shown", () => handler()),
};

export const api: Backend = isTauri() ? tauriBackend : mockBackend;

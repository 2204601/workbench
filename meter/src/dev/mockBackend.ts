/**
 * Made-up readings for working on the popup in a browser (`npm run dev`),
 * with the same types as the Rust side (api.ts). Keep it in step when
 * api.ts changes.
 */
import type { Backend, Drive, Processes, Sample, Snapshot, Update } from "../api";

const GB = 1024 ** 3;
const MB = 1024 ** 2;
const CORES = 8;

let t = Date.now() - 120_000;
let last: Sample | null = null;

function wander(prev: number, lo: number, hi: number, step: number) {
  return Math.min(hi, Math.max(lo, prev + (Math.random() - 0.5) * step));
}

function next(): Sample {
  t += 1000;
  const p = last;
  const cpu = wander(p?.cpu ?? 20, 2, 98, 18);
  const burst = Math.random() < 0.08;
  const sample: Sample = {
    at: t,
    cpu,
    cores: Array.from({ length: CORES }, (_, i) => wander(p?.cores[i] ?? cpu, 0, 100, 30)),
    memUsed: wander(p?.memUsed ?? 9.8 * GB, 6 * GB, 15 * GB, 0.3 * GB),
    memTotal: 16 * GB,
    swapUsed: 1.2 * GB,
    swapTotal: 4 * GB,
    diskRead: burst ? Math.random() * 80 * MB : Math.random() * 2 * MB,
    diskWrite: Math.random() * 0.8 * MB,
    netDown: wander(p?.netDown ?? 400_000, 0, 12 * MB, 1.5 * MB),
    netUp: wander(p?.netUp ?? 30_000, 0, 1 * MB, 120_000),
  };
  last = sample;
  return sample;
}

const history = Array.from({ length: 120 }, next);

const drives: Drive[] = [
  { name: "Windows (C:)", mount: "C:\\", total: 476 * GB, available: 120 * GB, removable: false },
  { name: "データ (D:)", mount: "D:\\", total: 931 * GB, available: 62 * GB, removable: false },
  { name: "USB (E:)", mount: "E:\\", total: 29 * GB, available: 21 * GB, removable: true },
];

function processes(): Processes {
  const apps = [
    { name: "chrome", count: 23, memory: 2.4 * GB },
    { name: "Teams", count: 6, memory: 1.1 * GB },
    { name: "EXCEL", count: 1, memory: 640 * MB },
    { name: "Code", count: 11, memory: 900 * MB },
    { name: "explorer", count: 1, memory: 180 * MB },
    { name: "MsMpEng", count: 1, memory: 310 * MB },
  ].map((a) => ({ ...a, cpu: Math.random() * 12 }));
  return {
    byCpu: [...apps].sort((a, b) => b.cpu - a.cpu).slice(0, 5),
    byMemory: [...apps].sort((a, b) => b.memory - a.memory).slice(0, 5),
  };
}

export const mockBackend: Backend = {
  async snapshot(): Promise<Snapshot> {
    return {
      info: {
        cpuBrand: "Intel(R) Core(TM) i7-1265U",
        logicalCores: CORES,
        physicalCores: 4,
        os: "Windows 11 Pro 24H2",
        host: "PC-0123",
      },
      history: [...history],
      drives,
      processes: { byCpu: [], byMemory: processes().byMemory },
      intervalSecs: 1,
      version: "0.1.0",
    };
  },
  async hidePopup() {},
  onSample(handler: (update: Update) => void) {
    setInterval(() => handler({ sample: next(), processes: processes(), drives: null }), 1000);
  },
  onShown() {},
};

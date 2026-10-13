// Dev-only in-memory stand-in for the Rust backend, used when the UI is
// opened in a normal browser (`npm run dev`) instead of inside Tauri
// (Platform playbook: ブラウザで UI を作る). Answers the same commands as
// src/lib/api.ts with the same types, closely enough for UI work; change
// both in the same PR. "Scanning" any folder gives the same made-up
// department share; view_tree / folder_info follow src-tauri/src/view.rs.
import { emit } from "@tauri-apps/api/event";
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import type { AppSettings, Counts, Folder, Item, Place, ScanSummary, ViewNode } from "../lib/api";

let settings: AppSettings = { autoUpdate: true };

const KB = 1024;
const MB = KB * 1024;
const GB = MB * 1024;

interface Spec {
  name: string;
  size?: number;
  children?: Spec[];
}

let seed = 20261013;
const rand = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
const f = (name: string, size: number): Spec => ({ name, size: Math.round(size) });
const d = (name: string, children: Spec[]): Spec => ({ name, children });
const files = (prefix: string, ext: string, n: number, min: number, max: number) =>
  Array.from({ length: n }, (_, i) => f(`${prefix}${String(i + 1).padStart(3, "0")}.${ext}`, min + (max - min) * rand() ** 2));

function sample(): Spec[] {
  seed = 20261013;
  return [
    d("動画", [
      d("2025_展示会", [f("撮影素材_未編集.mov", 4.4 * GB), f("ブース紹介_最終.mp4", 2.9 * GB), f("ブース紹介_v3.mp4", 2.8 * GB), f("ブース紹介_v2.mp4", 2.7 * GB), f("ブース紹介_v1.mp4", 2.6 * GB)]),
      d("2024_展示会", [f("ブース全景_4K.mp4", 3.8 * GB), f("設営タイムラプス.mov", 2.6 * GB), f("商談ダイジェスト.mp4", 2.1 * GB), f("会場インタビュー.mp4", 1.4 * GB)]),
      d("研修", [f("新人研修_1日目.mp4", 1.2 * GB), f("新人研修_2日目.mp4", 1.1 * GB), f("新人研修_3日目.mp4", 0.9 * GB), f("フォークリフト安全講習.mp4", 0.8 * GB), f("衛生管理研修.mp4", 0.6 * GB)]),
    ]),
    d("バックアップ", [f("旧PC_2021.zip", 6.2 * GB), f("共有ドライブ移行前.zip", 4.1 * GB), f("見積書_2019-2021.zip", 0.9 * GB), d("自動コピー", files("backup_", "bak", 24, 40 * MB, 180 * MB))]),
    d("写真", [
      d("商品撮影", [
        d("2025", [...files("DSC_", "jpg", 380, 4 * MB, 14 * MB), ...files("DSC_RAW_", "arw", 120, 24 * MB, 30 * MB)]),
        d("2024", files("IMG_2024_", "jpg", 610, 3 * MB, 12 * MB)),
        d("2023", files("IMG_2023_", "jpg", 420, 2 * MB, 9 * MB)),
      ]),
      d("店頭POP", files("POP_", "png", 160, 0.5 * MB, 6 * MB)),
      d("イベント", files("event_", "jpg", 240, 2 * MB, 7 * MB)),
    ]),
    d("会議資料", [
      d("取引先提案", files("提案書_", "pptx", 70, 3 * MB, 40 * MB)),
      d("2025", files("営業会議_2025_", "pptx", 40, 5 * MB, 80 * MB)),
      d("2024", files("営業会議_2024_", "pptx", 48, 5 * MB, 60 * MB)),
    ]),
    d("個人", [
      d("佐藤", [f("受信メール.pst", 2.8 * GB), ...files("メモ_", "docx", 30, 20 * KB, 2 * MB)]),
      d("高橋", [...files("作業_", "xlsx", 120, 100 * KB, 6 * MB), f("デスクトップ退避.zip", 0.7 * GB)]),
      d("田中", files("資料_", "pdf", 90, 200 * KB, 12 * MB)),
      d("山本", files("下書き_", "docx", 40, 20 * KB, 1 * MB)),
      d("退職者_保管", []),
    ]),
    d(
      "見積・請求",
      ["2025", "2024", "2023", "2022"].map((y) =>
        d(y, [...files(`見積_${y}_`, "xlsx", 380, 60 * KB, 900 * KB), ...files(`請求_${y}_`, "pdf", 300, 100 * KB, 1.4 * MB)]),
      ),
    ),
    d("テンプレート", files("様式_", "xlsx", 60, 30 * KB, 800 * KB)),
    f("Thumbs.db", 12 * MB),
    f("営業部_連絡先.xlsx", 240 * KB),
  ];
}

interface MockNode {
  name: string;
  size: number;
  files: number;
  dirs: number;
  parent: number | null;
  children: number[];
  dir: boolean;
}

let nodes: MockNode[] = [];
let root = "";

/** The spec laid out as Rust lays it out: children largest first. */
function build(name: string, children: Spec[]): MockNode[] {
  const nodes: MockNode[] = [];
  const add = (s: Spec, parent: number | null): number => {
    const id = nodes.length;
    const n: MockNode = { name: s.name, size: s.size ?? 0, files: s.children ? 0 : 1, dirs: 0, parent, children: [], dir: !!s.children };
    nodes.push(n);
    for (const c of s.children ?? []) {
      const kid = add(c, id);
      const k = nodes[kid];
      n.children.push(kid);
      n.size += k.size;
      n.files += k.files;
      n.dirs += k.dir ? 1 + k.dirs : 0;
    }
    n.children.sort((a, b) => nodes[b].size - nodes[a].size);
    return id;
  };
  add({ name, children }, null);
  return nodes;
}

function view(id: number, depth: number, minShare: number): ViewNode {
  const top = nodes[id];
  if (!top) throw "その項目はもうありません";
  const min = Math.max(1, Math.floor(top.size * Math.max(minShare, 0.0002)));
  const walk = (i: number, left: number): ViewNode => {
    const n = nodes[i];
    const out: ViewNode = { id: i, name: n.name, size: n.size, dir: n.dir, files: n.files, folded: 0 };
    if (n.dir && left > 0) {
      out.children = [];
      let folded = 0;
      let size = 0;
      let fileCount = 0;
      for (const c of n.children) {
        if (nodes[c].size >= min) out.children.push(walk(c, left - 1));
        else {
          folded++;
          size += nodes[c].size;
          fileCount += nodes[c].files;
        }
      }
      if (folded) out.children.push({ id: null, name: "", size, dir: false, files: fileCount, folded });
    }
    return out;
  };
  return walk(id, Math.min(depth, 6));
}

const sep = () => (root.includes("\\") ? "\\" : "/");

function chain(id: number): number[] {
  const out: number[] = [];
  for (let at: number | null = id; at !== null; at = nodes[at].parent) out.unshift(at);
  return out;
}

const pathOf = (id: number) => [root, ...chain(id).slice(1).map((i) => nodes[i].name)].join(sep()).replace(/([\\/])\1+/g, "$1");

function folder(id: number, limit: number): Folder {
  const n = nodes[id];
  if (!n) throw "その項目はもうありません";
  const item = (i: number): Item => ({ id: i, name: nodes[i].name, size: nodes[i].size, dir: nodes[i].dir, files: nodes[i].files, unreadable: nodes[i].name === "退職者_保管" });
  const rest = n.children.slice(limit);
  return {
    id,
    name: n.name,
    path: pathOf(id),
    size: n.size,
    files: n.files,
    dirs: n.dirs,
    crumbs: chain(id).map((i) => ({ id: i, name: nodes[i].name })),
    items: n.children.slice(0, limit).map(item),
    more: rest.length,
    moreSize: rest.reduce((s, i) => s + nodes[i].size, 0),
    parent: n.parent,
  };
}

let cancel = false;

/** About two seconds of "reading", with progress events like Rust's. */
async function scan(path: string): Promise<ScanSummary> {
  cancel = false;
  const next = build(path, sample());
  const total = next[0];
  const steps = 14;
  for (let i = 1; i <= steps; i++) {
    await new Promise((r) => setTimeout(r, 150));
    const t = i / steps;
    const at = next[Math.floor(t * (next.length - 1))];
    const counts: Counts = { files: Math.round(total.files * t), dirs: Math.round(total.dirs * t), bytes: Math.round(total.size * t), path: `${path}${sep()}${at.name}` };
    void emit("scan-progress", counts);
    if (cancel) {
      return { path, network: false, files: 0, dirs: 0, bytes: 0, cancelled: true, elapsedMs: i * 150, unreadable: 0, errors: [], cloudFiles: 0, cloudBytes: 0, space: null };
    }
  }
  nodes = next;
  root = path;
  return {
    path,
    network: path.startsWith("\\\\"),
    files: total.files,
    dirs: total.dirs + 1,
    bytes: total.size,
    cancelled: false,
    elapsedMs: steps * 150,
    unreadable: 1,
    errors: [`${path}${sep()}個人${sep()}退職者_保管: アクセスが許可されていません`],
    cloudFiles: 12,
    cloudBytes: 3.4 * GB,
    space: { total: 4 * 1024 * GB, free: 1.3 * 1024 * GB },
  };
}

const PLACES: Place[] = [
  { path: "C:\\", label: "Windows", kind: "drive", space: { total: 476 * GB, free: 82 * GB } },
  { path: "D:\\", label: "データ", kind: "drive", space: { total: 931 * GB, free: 512 * GB } },
  { path: "E:\\", label: "USB DISK", kind: "removable", space: { total: 58 * GB, free: 21 * GB } },
  { path: "Z:\\", label: "共有", kind: "network", space: { total: 4 * 1024 * GB, free: 1.3 * 1024 * GB } },
  { path: "C:\\Users\\demo", label: "", kind: "home", space: { total: 476 * GB, free: 82 * GB } },
];

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
    case "list_places":
      await new Promise((r) => setTimeout(r, 200));
      return PLACES;
    case "scan_folder":
      return scan(args.path as string);
    case "cancel_scan":
      cancel = true;
      return null;
    case "close_scan":
      nodes = [];
      return null;
    case "view_tree":
      if (!nodes.length) throw "スキャンした結果がありません";
      return view(args.id as number, args.depth as number, args.minShare as number);
    case "folder_info":
      if (!nodes.length) throw "スキャンした結果がありません";
      return folder(args.id as number, args.limit as number);
    case "item_path":
      return pathOf(args.id as number);
    case "reveal_item":
      console.info("[mock] reveal", pathOf(args.id as number));
      return null;
    case "plugin:dialog|open":
      return "\\\\fs01\\共有\\営業部";
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

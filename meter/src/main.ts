import { api, type AppUsage, type Drive, type Processes, type Sample, type Snapshot } from "./api";
import { Chart } from "./chart";
import { niceCeiling, percent, rate, size } from "./format";
import { logUncaughtErrors, warn } from "./log";

logUncaughtErrors();

/** How many readings the graphs show. */
const SLOTS = 60;
/** Readings kept here; the Rust side keeps 120 (monitor.rs). */
const KEEP = 120;

type Sort = "cpu" | "memory";

const state = {
  snapshot: null as Snapshot | null,
  history: [] as Sample[],
  drives: [] as Drive[],
  processes: { byCpu: [], byMemory: [] } as Processes,
  sort: "cpu" as Sort,
};

function $(selector: string, root: ParentNode = document) {
  const el = root.querySelector<HTMLElement>(selector);
  if (!el) throw new Error(`missing ${selector}`);
  return el;
}

function card(id: string) {
  return document.getElementById(id) as HTMLElement;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const percentChart = { slots: SLOTS, top: 100, format: (v: number) => percent(v) };
const rateChart = { slots: SLOTS, top: niceCeiling, format: rate };
const charts = {
  cpu: new Chart($("[data-chart]", card("cpu")), percentChart),
  memory: new Chart($("[data-chart]", card("memory")), percentChart),
  disk: new Chart($("[data-chart]", card("disk")), rateChart),
  network: new Chart($("[data-chart]", card("network")), rateChart),
};

/** Where a percentage turns amber and red, as on the tray icons (badge.rs). */
function level(p: number, warnAt: number, highAt: number) {
  return p >= highAt ? "high" : p >= warnAt ? "warn" : "ok";
}

/** A legend entry: the series' colour as a short line, then the value in text ink. */
function legendItem(color: string, label: string, value: string) {
  const item = el("span", "key");
  const swatch = el("i");
  swatch.style.background = `var(${color})`;
  item.append(swatch, el("span", "dim", label), el("b", undefined, value));
  return item;
}

function meter(p: number, warnAt: number, highAt: number) {
  const track = el("div", `meter ${level(p, warnAt, highAt)}`);
  const fill = el("div");
  fill.style.width = `${Math.min(100, Math.max(0, p))}%`;
  track.append(fill);
  return track;
}

function render() {
  const history = state.history;
  const latest = history[history.length - 1];
  if (!latest) return;
  const times = history.map((s) => s.at);
  const info = state.snapshot?.info;

  // CPU
  const cpu = card("cpu");
  $("[data-value]", cpu).textContent = percent(latest.cpu);
  $("[data-value]", cpu).dataset.level = level(latest.cpu, 60, 85);
  if (info) {
    const cores = info.physicalCores && info.physicalCores !== info.logicalCores
      ? `${info.physicalCores} コア / ${info.logicalCores} スレッド`
      : `${info.logicalCores} コア`;
    $("[data-sub]", cpu).textContent = [info.cpuBrand, cores].filter(Boolean).join(" · ");
  }
  charts.cpu.set([{ label: "CPU", color: "--series-1", values: history.map((s) => s.cpu) }], times);
  const coresBox = $("[data-cores]", cpu);
  coresBox.replaceChildren(
    ...latest.cores.map((p, i) => {
      const bar = el("div", "core");
      bar.title = `コア ${i + 1}：${percent(p)}`;
      const fill = el("div");
      fill.style.height = `${Math.max(2, Math.min(100, p))}%`;
      bar.append(fill);
      return bar;
    }),
  );

  // Memory
  const memory = card("memory");
  const memP = latest.memTotal ? (latest.memUsed / latest.memTotal) * 100 : 0;
  $("[data-value]", memory).textContent = percent(memP);
  $("[data-value]", memory).dataset.level = level(memP, 75, 90);
  const swap = latest.swapTotal ? ` · スワップ ${size(latest.swapUsed)}` : "";
  $("[data-sub]", memory).textContent = `${size(latest.memUsed)} / ${size(latest.memTotal)} 使用中${swap}`;
  charts.memory.set(
    [{ label: "メモリ", color: "--series-1", values: history.map((s) => (s.memTotal ? (s.memUsed / s.memTotal) * 100 : 0)) }],
    times,
  );

  // Disk
  const disk = card("disk");
  $("[data-legend]", disk).replaceChildren(
    legendItem("--series-1", "読み", rate(latest.diskRead)),
    legendItem("--series-2", "書き", rate(latest.diskWrite)),
  );
  charts.disk.set(
    [
      { label: "読み", color: "--series-1", values: history.map((s) => s.diskRead) },
      { label: "書き", color: "--series-2", values: history.map((s) => s.diskWrite) },
    ],
    times,
  );
  renderDrives($("[data-drives]", disk));

  // Network
  const network = card("network");
  $("[data-legend]", network).replaceChildren(
    legendItem("--series-1", "↓ 受信", rate(latest.netDown)),
    legendItem("--series-2", "↑ 送信", rate(latest.netUp)),
  );
  charts.network.set(
    [
      { label: "受信", color: "--series-1", values: history.map((s) => s.netDown) },
      { label: "送信", color: "--series-2", values: history.map((s) => s.netUp) },
    ],
    times,
  );

  renderApps();
}

function renderDrives(list: HTMLElement) {
  list.replaceChildren(
    ...state.drives.map((d) => {
      const used = d.total ? ((d.total - d.available) / d.total) * 100 : 0;
      const row = el("li");
      const line = el("div", "row");
      line.append(el("span", "name", d.name), el("span", "dim", `空き ${size(d.available)} / ${size(d.total)}`));
      row.title = d.mount;
      row.append(line, meter(used, 80, 90));
      return row;
    }),
  );
}

function renderApps() {
  const list = $("[data-apps]", card("apps"));
  const byCpu = state.sort === "cpu";
  const apps: AppUsage[] = byCpu ? state.processes.byCpu : state.processes.byMemory;
  if (apps.length === 0) {
    list.replaceChildren(el("li", "empty dim", byCpu ? "計測しています…" : "読み込んでいます…"));
    return;
  }
  const top = byCpu ? 100 : Math.max(...apps.map((a) => a.memory));
  list.replaceChildren(
    ...apps.map((a) => {
      const row = el("li");
      const name = el("span", "name", a.name);
      if (a.count > 1) name.append(el("span", "dim count", `${a.count}`));
      name.title = a.count > 1 ? `${a.name}（${a.count} 個のプロセス）` : a.name;
      const value = byCpu ? percent(a.cpu, true) : size(a.memory);
      const bar = el("div", "bar");
      const fill = el("div");
      fill.style.width = `${((byCpu ? a.cpu : a.memory) / top) * 100}%`;
      bar.append(fill);
      row.append(name, el("b", "num", value), bar);
      return row;
    }),
  );
}

function setSort(sort: Sort) {
  state.sort = sort;
  for (const tab of document.querySelectorAll<HTMLButtonElement>("[data-sort]")) {
    tab.setAttribute("aria-selected", String(tab.dataset.sort === sort));
  }
  renderApps();
}

async function load() {
  try {
    const snapshot = await api.snapshot();
    state.snapshot = snapshot;
    state.history = snapshot.history;
    state.drives = snapshot.drives;
    state.processes = snapshot.processes;
    const { info } = snapshot;
    $("#host").textContent = [info.host, info.os].filter(Boolean).join(" · ");
    const every = snapshot.intervalSecs === 1 ? "毎秒" : `${snapshot.intervalSecs} 秒ごとに`;
    $("#foot").textContent = `v${snapshot.version} · ${every}更新 · 設定はアイコンの右クリックから`;
    render();
  } catch (e) {
    warn("snapshot", e);
  }
}

api.onSample((update) => {
  state.history.push(update.sample);
  if (state.history.length > KEEP) state.history.splice(0, state.history.length - KEEP);
  state.processes = update.processes;
  if (update.drives) state.drives = update.drives;
  render();
});
api.onShown(load);

for (const tab of document.querySelectorAll<HTMLButtonElement>("[data-sort]")) {
  tab.addEventListener("click", () => setSort(tab.dataset.sort as Sort));
}
$("#close").addEventListener("click", () => void api.hidePopup());
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") void api.hidePopup();
});
// A right click would show the webview's own menu (Reload, Inspect…).
document.addEventListener("contextmenu", (e) => e.preventDefault());

void load();

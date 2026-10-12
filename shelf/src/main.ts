import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { startDrag } from "@crabnebula/tauri-plugin-drag";

type ShelfItem = {
  path: string;
  name: string;
  isDir: boolean;
  size: number | null;
  addedAt: number;
  /** Shared by files dropped together. */
  stack?: number;
  exists: boolean;
};

/** One line on the shelf: a single file, or the files dropped together. */
type Row = { kind: "item"; item: ShelfItem } | { kind: "stack"; id: number; members: ShelfItem[] };

type DragMode = "move" | "copy";

const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "avif", "ico"]);
const DRAG_THRESHOLD = 4;
const MODE_KEY = "shelf.dragMode";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const listEl = $<HTMLUListElement>("list");
const emptyEl = $("empty");
const overlayEl = $("drop-overlay");
const countEl = $("count");
const modeBtn = $<HTMLButtonElement>("mode");
const footerEl = $("footer");
const dragAllEl = $("drag-all");
const dragAllLabel = $("drag-all-label");

let items: ShelfItem[] = [];
const selected = new Set<string>();
let lastClicked: string | null = null;
/** Stacks opened up to show their files. */
const expanded = new Set<number>();
/** The clickable rows in display order, as path groups, for Shift + click. */
let clickable: string[][] = [];
let mode: DragMode = loadMode();
// True while one of our own items is being dragged out, so that dropping it
// back onto the shelf does not re-add it.
let draggingOut = false;

function loadMode(): DragMode {
  try {
    return localStorage.getItem(MODE_KEY) === "copy" ? "copy" : "move";
  } catch {
    return "move";
  }
}

function saveMode() {
  try {
    localStorage.setItem(MODE_KEY, mode);
  } catch {
    // Not persisting the toggle is fine.
  }
}

// ---------------------------------------------------------------------------
// State

function setItems(next: ShelfItem[]) {
  items = next;
  const paths = new Set(items.map((i) => i.path));
  for (const p of [...selected]) if (!paths.has(p)) selected.delete(p);
  render();
}

async function call(cmd: string, args?: Record<string, unknown>) {
  try {
    setItems(await invoke<ShelfItem[]>(cmd, args));
  } catch (e) {
    console.error(cmd, e);
  }
}

const refresh = () => call("list_items");
const addPaths = (paths: string[]) => call("add_paths", { paths });
const removePaths = (paths: string[]) => call("remove_items", { paths });
const pruneMissing = (paths: string[]) => call("prune_missing", { paths });

// ---------------------------------------------------------------------------
// Rendering

function extOf(name: string) {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(i + 1).toLowerCase() : "";
}

function formatSize(bytes: number) {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let n = bytes;
  let u = 0;
  while (n >= 1024 && u < units.length - 1) {
    n /= 1024;
    u++;
  }
  return `${n < 10 && u > 0 ? n.toFixed(1) : Math.round(n)} ${units[u]}`;
}

function parentDir(path: string) {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.length > 1 ? parts[parts.length - 2] : path;
}

function thumbFor(item: ShelfItem): HTMLElement {
  const box = document.createElement("div");
  box.className = "thumb";
  const ext = extOf(item.name);

  if (item.isDir) {
    box.classList.add("folder");
    box.innerHTML = `<svg viewBox="0 0 32 32"><path d="M3 8.5A2.5 2.5 0 0 1 5.5 6h6l3 3h12A2.5 2.5 0 0 1 29 11.5v12a2.5 2.5 0 0 1-2.5 2.5h-21A2.5 2.5 0 0 1 3 23.5z"/></svg>`;
    return box;
  }

  const badge = () => {
    box.classList.add("file");
    box.textContent = ext ? ext.slice(0, 4).toUpperCase() : "FILE";
  };

  if (item.exists && IMAGE_EXTS.has(ext)) {
    const img = document.createElement("img");
    img.src = convertFileSrc(item.path);
    img.alt = "";
    img.draggable = false;
    img.onerror = () => {
      img.remove();
      badge();
    };
    box.appendChild(img);
  } else {
    badge();
  }
  return box;
}

/** Groups the files of each stack into one row. Stacks keep their files together. */
function groupRows(list: ShelfItem[]): Row[] {
  const rows: Row[] = [];
  for (const item of list) {
    const last = rows[rows.length - 1];
    if (item.stack == null) rows.push({ kind: "item", item });
    else if (last?.kind === "stack" && last.id === item.stack) last.members.push(item);
    else rows.push({ kind: "stack", id: item.stack, members: [item] });
  }
  // A stack whose other files were taken out is just a file again.
  return rows.map((r) => (r.kind === "stack" && r.members.length === 1 ? { kind: "item", item: r.members[0] } : r));
}

function render() {
  const rows = groupRows(items);
  const stackIds = new Set(rows.flatMap((r) => (r.kind === "stack" ? [r.id] : [])));
  for (const id of [...expanded]) if (!stackIds.has(id)) expanded.delete(id);

  clickable = [];
  const lis: HTMLLIElement[] = [];
  for (const row of rows) {
    if (row.kind === "item") {
      lis.push(itemRow(row.item));
      continue;
    }
    lis.push(stackRow(row));
    if (expanded.has(row.id)) for (const member of row.members) lis.push(itemRow(member, true));
  }
  listEl.replaceChildren(...lis);

  const n = items.length;
  emptyEl.hidden = n > 0;
  footerEl.hidden = n === 0;
  countEl.textContent = n ? String(n) : "";
  dragAllLabel.textContent =
    selected.size > 0 ? `選択中の ${selected.size} 件をドラッグ` : `${n} 件まとめてドラッグ`;
  modeBtn.textContent = mode === "move" ? "移動" : "コピー";
  modeBtn.classList.toggle("copy", mode === "copy");
}

function rowText(name: string, meta: string) {
  const text = document.createElement("div");
  text.className = "text";
  const nameEl = document.createElement("div");
  nameEl.className = "name";
  nameEl.textContent = name;
  const sub = document.createElement("div");
  sub.className = "meta";
  sub.textContent = meta;
  text.append(nameEl, sub);
  return text;
}

function itemRow(item: ShelfItem, nested = false) {
  const li = document.createElement("li");
  li.className = "item";
  li.classList.toggle("nested", nested);
  li.classList.toggle("selected", selected.has(item.path));
  li.classList.toggle("missing", !item.exists);
  li.title = item.path;

  const meta = !item.exists
    ? "見つかりません"
    : item.isDir
      ? `フォルダ · ${parentDir(item.path)}`
      : `${formatSize(item.size ?? 0)} · ${parentDir(item.path)}`;

  const actions = document.createElement("div");
  actions.className = "row-actions";
  actions.append(
    rowButton("Finder / エクスプローラで表示", `<path d="M2.5 4.5h4l1.5 1.5h5.5v6.5h-11z"/>`, () =>
      invoke("reveal_item", { path: item.path }).catch(console.error),
    ),
    rowButton("棚から外す", `<path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/>`, () => removePaths([item.path])),
  );

  li.append(thumbFor(item), rowText(item.name, meta), actions);
  attachRowPointer(li, [item.path]);
  li.addEventListener("dblclick", () => {
    if (item.exists) invoke("open_item", { path: item.path }).catch(console.error);
  });
  return li;
}

function stackRow(row: Extract<Row, { kind: "stack" }>) {
  const { id, members } = row;
  const paths = members.map((m) => m.path);
  const present = members.filter((m) => m.exists);
  const open = expanded.has(id);

  const li = document.createElement("li");
  li.className = "item stack";
  li.classList.toggle("open", open);
  li.classList.toggle("selected", paths.every((p) => selected.has(p)));
  li.classList.toggle("missing", present.length === 0);
  li.title = paths.join("\n");

  const thumb = document.createElement("div");
  thumb.className = "thumb-stack";
  const count = document.createElement("span");
  count.className = "stack-count";
  count.textContent = String(members.length);
  thumb.append(thumbFor(members[0]), count);

  const folders = new Set(members.map((m) => parentDir(m.path)));
  const size = present.reduce((sum, m) => sum + (m.size ?? 0), 0);
  const missing = members.length - present.length;
  // The count leads, so a long first name cannot push it out of sight.
  const meta = [
    `ほか ${members.length - 1} 件`,
    missing ? `${missing} 件見つかりません` : formatSize(size),
    folders.size === 1 ? [...folders][0] : "複数のフォルダ",
  ].join(" · ");

  const toggle = () => {
    if (open) expanded.delete(id);
    else expanded.add(id);
    render();
  };
  const actions = document.createElement("div");
  actions.className = "row-actions";
  actions.append(
    rowButton("まとめを解除（1 件ずつに分ける）", `<path d="M3 5.5h4v4H3zM9 6.5h4v4H9z"/>`, () =>
      call("unstack_items", { paths }),
    ),
    rowButton("まとめて棚から外す", `<path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/>`, () => removePaths(paths)),
  );
  const chevron = rowButton(open ? "閉じる" : "中身を表示", `<path d="M6 4l4 4-4 4"/>`, toggle);
  chevron.classList.add("stack-toggle");

  li.append(thumb, rowText(members[0].name, meta), actions, chevron);
  attachRowPointer(li, paths);
  li.addEventListener("dblclick", (e) => {
    // Quick clicks on the › button already toggle on their own.
    if (!(e.target as HTMLElement).closest("button")) toggle();
  });
  return li;
}

function rowButton(title: string, svgPath: string, onClick: () => void) {
  const btn = document.createElement("button");
  btn.className = "icon-btn";
  btn.title = title;
  btn.innerHTML = `<svg viewBox="0 0 16 16">${svgPath}</svg>`;
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    onClick();
  });
  return btn;
}

// ---------------------------------------------------------------------------
// Selection + drag out

/** Click selection over rows; a stack row selects all of its files. */
function handleClick(paths: string[], e: PointerEvent) {
  const toggle = e.metaKey || e.ctrlKey;
  const all = paths.every((p) => selected.has(p));
  if (e.shiftKey && lastClicked) {
    const from = clickable.findIndex((g) => g.includes(lastClicked!));
    const to = clickable.findIndex((g) => g.includes(paths[0]));
    if (from >= 0 && to >= 0) {
      for (const g of clickable.slice(Math.min(from, to), Math.max(from, to) + 1)) {
        for (const p of g) selected.add(p);
      }
    }
  } else if (toggle) {
    for (const p of paths) {
      if (all) selected.delete(p);
      else selected.add(p);
    }
  } else {
    const only = all && selected.size === paths.length;
    selected.clear();
    if (!only) for (const p of paths) selected.add(p);
  }
  lastClicked = paths[0];
  render();
}

/**
 * Starts a native drag when the pointer moves past a small threshold, and
 * treats it as a click otherwise. `getPaths` is evaluated at drag start so a
 * drag picks up whatever is selected at that moment.
 */
function trackPointer(el: HTMLElement, getPaths: () => string[], onClick?: (e: PointerEvent) => void) {
  el.addEventListener("pointerdown", (down) => {
    if (down.button !== 0 || (down.target as HTMLElement).closest("button")) return;

    const onMove = (move: PointerEvent) => {
      if (Math.hypot(move.clientX - down.clientX, move.clientY - down.clientY) < DRAG_THRESHOLD) return;
      cleanup();
      const paths = getPaths();
      if (paths.length) void dragOut(paths, move.altKey);
    };
    const onUp = (up: PointerEvent) => {
      cleanup();
      onClick?.(up);
    };
    const cleanup = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  });
}

/** `paths`: the file, or the files of the stack, that the row stands for. */
function attachRowPointer(li: HTMLElement, paths: string[]) {
  clickable.push(paths);
  trackPointer(
    li,
    () => {
      // Dragging a selected row drags the whole selection; otherwise just it.
      const inSelection = paths.every((p) => selected.has(p));
      const group = items.filter((i) => (inSelection ? selected.has(i.path) : paths.includes(i.path)));
      return group.filter((i) => i.exists).map((i) => i.path);
    },
    (e) => handleClick(paths, e),
  );
}

trackPointer(dragAllEl, () => {
  const group = selected.size ? items.filter((i) => selected.has(i.path)) : items;
  return group.filter((i) => i.exists).map((i) => i.path);
});

async function dragOut(paths: string[], invert: boolean) {
  const effective: DragMode = invert ? (mode === "move" ? "copy" : "move") : mode;
  draggingOut = true;
  try {
    await startDrag(
      { item: paths, icon: dragIcon(paths), mode: effective },
      ({ result }) => {
        draggingOut = false;
        if (result !== "Dropped" || effective !== "move") return;
        // The drop target moves the files, possibly asynchronously (large
        // files, other volumes), so check a few times before giving up.
        for (const delay of [300, 1500, 5000]) setTimeout(() => pruneMissing(paths), delay);
      },
    );
  } catch (e) {
    draggingOut = false;
    console.error("drag failed", e);
  }
}

/** A small PNG drawn on the fly to follow the cursor during a drag. */
function dragIcon(paths: string[]): string {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;

  ctx.fillStyle = "#4a72f0";
  ctx.beginPath();
  ctx.roundRect(8, 4, 48, 56, 8);
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.font = "bold 13px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const first = items.find((i) => i.path === paths[0]);
  const label = first?.isDir ? "DIR" : (extOf(first?.name ?? "").slice(0, 4).toUpperCase() || "FILE");
  ctx.fillText(label, 32, 32);

  if (paths.length > 1) {
    ctx.fillStyle = "#e5484d";
    ctx.beginPath();
    ctx.arc(50, 12, 11, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.font = "bold 12px system-ui, sans-serif";
    ctx.fillText(paths.length > 99 ? "99+" : String(paths.length), 50, 12.5);
  }
  return canvas.toDataURL("image/png");
}

// ---------------------------------------------------------------------------
// Drop in

void getCurrentWebview().onDragDropEvent((event) => {
  const p = event.payload;
  if (draggingOut) return;
  if (p.type === "enter" || p.type === "over") {
    overlayEl.classList.add("active");
  } else if (p.type === "leave") {
    overlayEl.classList.remove("active");
  } else if (p.type === "drop") {
    overlayEl.classList.remove("active");
    if (p.paths.length) void addPaths(p.paths);
  }
});

// ---------------------------------------------------------------------------
// Chrome

modeBtn.addEventListener("click", () => {
  mode = mode === "move" ? "copy" : "move";
  saveMode();
  render();
});

$("clear").addEventListener("click", () => {
  if (items.length) void call("clear_items");
});

$("hide").addEventListener("click", () => void getCurrentWindow().hide());

listEl.addEventListener("pointerdown", (e) => {
  if (e.target === listEl && selected.size) {
    selected.clear();
    render();
  }
});

document.addEventListener("keydown", (e) => {
  if ((e.key === "Backspace" || e.key === "Delete") && selected.size) {
    void removePaths([...selected]);
  } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "a") {
    e.preventDefault();
    for (const i of items) selected.add(i.path);
    render();
  } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "v") {
    // Files copied in Finder / Explorer; the webview cannot see their paths.
    e.preventDefault();
    void call("add_clipboard_files");
  } else if (e.key === "Escape") {
    selected.clear();
    render();
  }
});

// Files may have been moved or deleted while we were in the background.
window.addEventListener("focus", () => void refresh());
// Files dropped on the edge strip land on the shelf without going through here.
void listen("shelf-changed", () => void refresh());

render();
void refresh();

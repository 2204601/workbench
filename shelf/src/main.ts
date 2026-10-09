import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { startDrag } from "@crabnebula/tauri-plugin-drag";

type ShelfItem = {
  path: string;
  name: string;
  isDir: boolean;
  size: number | null;
  addedAt: number;
  exists: boolean;
};

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

function render() {
  listEl.replaceChildren(
    ...items.map((item) => {
      const li = document.createElement("li");
      li.className = "item";
      li.classList.toggle("selected", selected.has(item.path));
      li.classList.toggle("missing", !item.exists);
      li.title = item.path;

      const meta = !item.exists
        ? "見つかりません"
        : item.isDir
          ? `フォルダ · ${parentDir(item.path)}`
          : `${formatSize(item.size ?? 0)} · ${parentDir(item.path)}`;

      const text = document.createElement("div");
      text.className = "text";
      const name = document.createElement("div");
      name.className = "name";
      name.textContent = item.name;
      const sub = document.createElement("div");
      sub.className = "meta";
      sub.textContent = meta;
      text.append(name, sub);

      const actions = document.createElement("div");
      actions.className = "row-actions";
      actions.append(
        rowButton("Finder / エクスプローラで表示", `<path d="M2.5 4.5h4l1.5 1.5h5.5v6.5h-11z"/>`, () =>
          invoke("reveal_item", { path: item.path }).catch(console.error),
        ),
        rowButton("棚から外す", `<path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/>`, () => removePaths([item.path])),
      );

      li.append(thumbFor(item), text, actions);
      attachItemPointer(li, item);
      li.addEventListener("dblclick", () => {
        if (item.exists) invoke("open_item", { path: item.path }).catch(console.error);
      });
      return li;
    }),
  );

  const n = items.length;
  emptyEl.hidden = n > 0;
  footerEl.hidden = n === 0;
  countEl.textContent = n ? String(n) : "";
  dragAllLabel.textContent =
    selected.size > 0 ? `選択中の ${selected.size} 件をドラッグ` : `${n} 件まとめてドラッグ`;
  modeBtn.textContent = mode === "move" ? "移動" : "コピー";
  modeBtn.classList.toggle("copy", mode === "copy");
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

function handleClick(item: ShelfItem, e: PointerEvent) {
  const toggle = e.metaKey || e.ctrlKey;
  if (e.shiftKey && lastClicked) {
    const a = items.findIndex((i) => i.path === lastClicked);
    const b = items.findIndex((i) => i.path === item.path);
    if (a >= 0 && b >= 0) {
      const [from, to] = a < b ? [a, b] : [b, a];
      for (const i of items.slice(from, to + 1)) selected.add(i.path);
    }
  } else if (toggle) {
    if (selected.has(item.path)) selected.delete(item.path);
    else selected.add(item.path);
  } else {
    const only = selected.size === 1 && selected.has(item.path);
    selected.clear();
    if (!only) selected.add(item.path);
  }
  lastClicked = item.path;
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

function attachItemPointer(li: HTMLElement, item: ShelfItem) {
  trackPointer(
    li,
    () => {
      // Dragging a selected item drags the whole selection; otherwise just it.
      const group = selected.has(item.path) ? items.filter((i) => selected.has(i.path)) : [item];
      return group.filter((i) => i.exists).map((i) => i.path);
    },
    (e) => handleClick(item, e),
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
  } else if (e.key === "Escape") {
    selected.clear();
    render();
  }
});

// Files may have been moved or deleted while we were in the background.
window.addEventListener("focus", () => void refresh());

render();
void refresh();

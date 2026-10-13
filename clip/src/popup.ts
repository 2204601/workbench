import { listen } from "@tauri-apps/api/event";
import { api, el, HistoryItem, matches, MOD, oneLine, relativeTime, Snippet, Status } from "./shared";

/** One choosable line of the list. */
type Row = { kind: "snippet"; snippet: Snippet } | { kind: "history"; item: HistoryItem };

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const queryEl = $<HTMLInputElement>("query");
const listEl = $<HTMLUListElement>("list");
const emptyEl = $("empty");
const previewEl = $("preview");
const hintsEl = $("hints");
const noticeEl = $("notice");

let snippets: Snippet[] = [];
let history: HistoryItem[] = [];
let status: Status | null = null;
let rows: Row[] = [];
let selected = 0;
let toastTimer: number | undefined;
/** Where the mouse last was, so a list scrolling under a still mouse doesn't move the selection. */
let lastMouse = { x: -1, y: -1 };

const keyOf = (row: Row) => (row.kind === "snippet" ? `s${row.snippet.id}` : `h${row.item.id}`);
const textOf = (row: Row) => (row.kind === "snippet" ? row.snippet.text : row.item.text);

async function load() {
  try {
    const entries = await api.entries();
    snippets = entries.snippets;
    history = entries.history;
    status = await api.status();
  } catch (e) {
    console.error("load", e);
  }
  render();
}

// ---------------------------------------------------------------------------
// Rendering

function filtered(): Row[] {
  const q = queryEl.value;
  return [
    ...snippets
      .filter((s) => s.text !== "" && matches(q, `${s.label}\n${s.text}`))
      .map((snippet): Row => ({ kind: "snippet", snippet })),
    ...history.filter((h) => matches(q, h.text)).map((item): Row => ({ kind: "history", item })),
  ];
}

/** Rebuilds the list. The selected entry stays selected if it is still there. */
function render(resetSelection = false) {
  const keep = !resetSelection && rows[selected] ? keyOf(rows[selected]) : null;
  rows = filtered();
  const kept = keep ? rows.findIndex((r) => keyOf(r) === keep) : -1;
  selected = kept >= 0 ? kept : 0;

  const items: HTMLElement[] = [];
  const firstHistory = rows.findIndex((r) => r.kind === "history");
  rows.forEach((row, i) => {
    if (i === 0 && row.kind === "snippet") items.push(el("li", "section", "スニペット"));
    if (i === firstHistory) items.push(el("li", "section", "履歴"));
    items.push(rowElement(row, i));
  });
  if (!queryEl.value && !snippets.some((s) => s.text !== "") && rows.length > 0) {
    // Point first-time users at snippets, the main use.
    items.unshift(el("li", "section", "スニペット"), registerPrompt());
  }
  listEl.replaceChildren(...items);
  renderEmpty();
  renderSelection();
  renderNotice();
}

function rowElement(row: Row, i: number) {
  const li = el("li", `row ${row.kind}`);
  li.dataset.index = String(i);

  const main = el("div", "row-main");
  if (row.kind === "snippet") {
    main.append(el("span", "row-label", row.snippet.label || "（名前なし）"));
    main.append(el("span", "row-text", oneLine(row.snippet.text)));
  } else {
    main.append(el("span", "row-text history-text", oneLine(row.item.text)));
  }
  li.append(main);

  if (row.kind === "history") {
    li.append(el("span", "row-time", relativeTime(row.item.copiedAt)));
    const pin = actionButton("スニペットにする", `<path d="M3.5 2.5h9v11L8 10.5l-4.5 3z"/>`, () => pinRow(i));
    const remove = actionButton("履歴から消す", `<path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/>`, () => removeRow(i));
    li.append(pin, remove);
  }
  if (i < 9) li.append(el("span", "row-key", `${MOD}${i + 1}`));

  li.addEventListener("mousemove", (e) => {
    if (e.clientX === lastMouse.x && e.clientY === lastMouse.y) return;
    lastMouse = { x: e.clientX, y: e.clientY };
    if (selected !== i) {
      selected = i;
      renderSelection(false);
    }
  });
  li.addEventListener("click", () => choose(i, true));
  return li;
}

function actionButton(title: string, path: string, onClick: () => void) {
  const button = el("button", "row-action");
  button.title = title;
  button.innerHTML = `<svg viewBox="0 0 16 16">${path}</svg>`;
  button.addEventListener("click", (e) => {
    e.stopPropagation();
    onClick();
  });
  return button;
}

function registerPrompt() {
  const li = el("li", "register");
  const button = el("button", "link", "＋ メールアドレスや電話番号を登録する…");
  button.addEventListener("click", () => api.openManager());
  li.append(button);
  return li;
}

function renderEmpty() {
  emptyEl.hidden = rows.length > 0;
  if (rows.length > 0) return;
  emptyEl.replaceChildren();
  if (queryEl.value) {
    emptyEl.append(el("p", undefined, `「${queryEl.value}」に一致するものはありません`));
    return;
  }
  emptyEl.append(
    el("p", "empty-title", "まだ何もありません"),
    el("p", undefined, "メールアドレスや電話番号をスニペットに登録すると、ここからすぐ入力できます。コピーしたものも、ここに履歴として並びます。"),
  );
  const button = el("button", "button primary", "スニペットを登録する…");
  button.addEventListener("click", () => api.openManager());
  emptyEl.append(button);
}

function renderSelection(scroll = true) {
  for (const li of listEl.querySelectorAll<HTMLElement>(".row")) {
    const on = Number(li.dataset.index) === selected;
    li.classList.toggle("selected", on);
    if (on && scroll) li.scrollIntoView({ block: "nearest" });
  }
  const row = rows[selected];
  previewEl.textContent = row ? textOf(row) : "";
  previewEl.hidden = !row;
  renderHints();
}

function renderHints() {
  if (toastTimer !== undefined) return;
  const auto = status?.autoPaste ?? true;
  const hints = ["↑↓ 選ぶ", auto ? "Enter 入力" : "Enter コピー"];
  if (auto) hints.push(`${MOD}Enter コピーだけ`);
  if (rows[selected]?.kind === "history") hints.push(`${MOD}S スニペットにする`);
  hints.push("Esc 閉じる");
  hintsEl.replaceChildren(...hints.map((h) => el("span", undefined, h)));
}

function renderNotice() {
  noticeEl.hidden = !status || status.autoPaste;
}

function toast(message: string) {
  window.clearTimeout(toastTimer);
  hintsEl.replaceChildren(el("span", "toast", message));
  toastTimer = window.setTimeout(() => {
    toastTimer = undefined;
    renderHints();
  }, 1800);
}

// ---------------------------------------------------------------------------
// Actions

async function choose(i: number, paste: boolean) {
  const row = rows[i];
  if (!row) return;
  try {
    await api.choose(textOf(row), row.kind === "history" ? row.item.id : null, paste);
  } catch (e) {
    toast(String(e));
  }
}

async function pinRow(i: number) {
  const row = rows[i];
  if (row?.kind !== "history") return;
  try {
    const snippet = await api.snippetFromHistory(row.item.id);
    if (snippet) toast(`スニペット「${snippet.label}」にしました`);
  } catch (e) {
    toast(String(e));
  }
}

async function removeRow(i: number) {
  const row = rows[i];
  if (row?.kind !== "history") return;
  try {
    await api.removeHistory(row.item.id);
  } catch (e) {
    toast(String(e));
  }
}

function move(by: number) {
  if (rows.length === 0) return;
  selected = Math.min(rows.length - 1, Math.max(0, selected + by));
  renderSelection();
}

document.addEventListener("keydown", (e) => {
  // Enter that confirms a Japanese IME conversion is not a choice.
  if (e.isComposing || e.keyCode === 229) return;
  const mod = e.metaKey || e.ctrlKey;
  let handled = true;
  if (e.key === "ArrowDown") move(1);
  else if (e.key === "ArrowUp") move(-1);
  else if (e.key === "PageDown") move(8);
  else if (e.key === "PageUp") move(-8);
  else if (e.key === "Enter") choose(selected, !mod);
  else if (e.key === "Escape") {
    if (queryEl.value) {
      queryEl.value = "";
      render(true);
    } else {
      api.closePopup();
    }
  } else if (mod && /^[1-9]$/.test(e.key)) choose(Number(e.key) - 1, true);
  else if (mod && e.key.toLowerCase() === "s") pinRow(selected);
  else if (mod && (e.key === "Backspace" || e.key === "Delete") && rows[selected]?.kind === "history") removeRow(selected);
  else if (mod && e.key === ",") api.openManager();
  else handled = false;
  if (handled) e.preventDefault();
});

queryEl.addEventListener("input", () => render(true));
$("manage").addEventListener("click", () => api.openManager());
$("allow").addEventListener("click", () => api.requestAccessibility());

// The window is reused: start fresh each time the shortcut brings it up.
listen("popup-shown", () => {
  queryEl.value = "";
  render(true);
  listEl.scrollTop = 0;
  queryEl.focus();
  load();
});
listen("entries-changed", load);
window.addEventListener("focus", () => queryEl.focus());

load();

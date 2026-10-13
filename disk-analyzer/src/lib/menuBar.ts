/**
 * The menu bar, made from the command table (commands.ts): the app's menus at
 * the top of the screen on macOS, the window's menu on Windows.
 *
 * Only ⌘ / Ctrl combos become accelerators. Single keys (?, Enter, arrows)
 * must still reach text fields and buttons, so they are only shown (Windows:
 * right-aligned after a tab, macOS: after the name). On macOS, copying text
 * goes through the Edit menu, so that is the standard item.
 *
 * Names, greyed-out and check states follow the store, at most once a frame.
 */
import { isTauri } from "@tauri-apps/api/core";
import { CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu } from "@tauri-apps/api/menu";
import { command, isEnabled, labelOf, runCommand } from "./commands";
import { warn } from "./log";
import { comboText, isMac } from "./keys";
import { useStore, type S } from "../store";

type Item = MenuItem | CheckMenuItem | Submenu | PredefinedMenuItem;

/** A live item: how to read its state, and what it showed last. */
interface Entry {
  item: MenuItem | CheckMenuItem;
  text: (s: S) => string;
  enabled: (s: S) => boolean;
  checked?: (s: S) => boolean;
  shown: { text: string; enabled: boolean; checked?: boolean };
}

const st = () => useStore.getState();

/** "Mod+Shift+O" → "CmdOrCtrl+Shift+O". */
function accelerator(key: string): string {
  const names: Record<string, string> = { Mod: "CmdOrCtrl", ",": "Comma", Esc: "Escape", Enter: "Enter" };
  return key
    .split("+")
    .map((p) => names[p] ?? p)
    .join("+");
}

/** The label with a key that is shown but not an accelerator. */
function withKey(text: string, key: string | undefined): string {
  if (!key) return text;
  return isMac ? `${text}（${comboText(key)}）` : `${text}\t${comboText(key)}`;
}

let entries: Entry[] = [];

/** A menu item for a command. */
async function cmd(id: string): Promise<MenuItem | CheckMenuItem> {
  const c = command(id);
  const s = st();
  const combo = c.keys?.find((k) => k.includes("Mod+"));
  const accel = combo ? accelerator(combo) : undefined;
  const text = (x: S) => (accel ? labelOf(c, x) : withKey(labelOf(c, x), c.keys?.[0]));
  const enabled = (x: S) => isEnabled(c, x);
  const base = { text: text(s), enabled: enabled(s), accelerator: accel, action: () => runCommand(id) };
  const item = c.checked ? await CheckMenuItem.new({ ...base, checked: c.checked(s) }) : await MenuItem.new(base);
  entries.push({
    item,
    text,
    enabled,
    checked: c.checked,
    shown: { text: base.text, enabled: base.enabled, checked: c.checked?.(s) },
  });
  return item;
}

const sep = () => PredefinedMenuItem.new({ item: "Separator" });

async function submenu(text: string, items: Promise<Item>[]): Promise<Submenu> {
  return Submenu.new({ text, items: await Promise.all(items) });
}

async function build(): Promise<Menu> {
  entries = [];
  const appMenu = isMac
    ? [
        submenu("Disk Analyzer", [
          PredefinedMenuItem.new({ item: { About: null }, text: "Disk Analyzer について" }),
          cmd("app.checkUpdate"),
          sep(),
          cmd("app.settings"),
          sep(),
          PredefinedMenuItem.new({ item: "Services", text: "サービス" }),
          sep(),
          PredefinedMenuItem.new({ item: "Hide", text: "Disk Analyzer を隠す" }),
          PredefinedMenuItem.new({ item: "HideOthers", text: "ほかを隠す" }),
          PredefinedMenuItem.new({ item: "ShowAll", text: "すべてを表示" }),
          sep(),
          PredefinedMenuItem.new({ item: "Quit", text: "Disk Analyzer を終了" }),
        ]),
      ]
    : [];
  const items = await Promise.all([
    ...appMenu,
    submenu("ファイル", [
      cmd("file.choose"),
      cmd("file.rescan"),
      sep(),
      cmd("file.close"),
      ...(isMac ? [sep(), PredefinedMenuItem.new({ item: "CloseWindow", text: "ウィンドウを閉じる" })] : []),
      ...(isMac ? [] : [sep(), cmd("app.settings"), sep(), PredefinedMenuItem.new({ item: "Quit", text: "終了" })]),
    ]),
    submenu("編集", [
      PredefinedMenuItem.new({ item: "Copy", text: "コピー" }),
      PredefinedMenuItem.new({ item: "SelectAll", text: "すべてを選択" }),
      sep(),
      cmd("item.copyPath"),
    ]),
    submenu("表示", [
      cmd("chart.sunburst"),
      cmd("chart.treemap"),
      cmd("chart.icicle"),
      sep(),
      cmd("chart.pie"),
      cmd("chart.bar"),
    ]),
    submenu("移動", [cmd("go.up"), cmd("go.top"), sep(), cmd("list.open"), cmd("item.reveal")]),
    ...(isMac
      ? [
          submenu("ウインドウ", [
            PredefinedMenuItem.new({ item: "Minimize", text: "しまう" }),
            PredefinedMenuItem.new({ item: "Maximize", text: "拡大/縮小" }),
          ]),
        ]
      : []),
    submenu("ヘルプ", [
      cmd("help.shortcuts"),
      cmd("help.log"),
      ...(isMac ? [] : [sep(), cmd("app.checkUpdate")]),
    ]),
  ]);
  return Menu.new({ items });
}

/** Brings names and states up to date, at most once a frame. */
let pending = false;
function sync() {
  if (pending) return;
  pending = true;
  requestAnimationFrame(() => {
    pending = false;
    const s = st();
    for (const e of entries) {
      const text = e.text(s);
      const enabled = e.enabled(s);
      if (text !== e.shown.text) void e.item.setText(text);
      if (enabled !== e.shown.enabled) void e.item.setEnabled(enabled);
      if (e.checked && e.item instanceof CheckMenuItem) {
        const checked = e.checked(s);
        if (checked !== e.shown.checked) void e.item.setChecked(checked);
        e.shown.checked = checked;
      }
      e.shown.text = text;
      e.shown.enabled = enabled;
    }
  });
}

/** Sets up the menu bar (in the app only; the browser preview has none). */
export function installMenuBar(): () => void {
  if (!isTauri()) return () => {};
  build()
    .then((menu) => menu.setAsAppMenu())
    .then(sync)
    .catch((e) => warn("menu bar", e));
  return useStore.subscribe(sync);
}

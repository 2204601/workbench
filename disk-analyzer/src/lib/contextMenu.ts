/**
 * The menu on a right-click on an item, in the chart or the list. A native
 * menu (Tauri), so it looks like Finder's / Explorer's own. Nothing in it
 * changes files: the app only shows where they are (docs/SPEC.md §1).
 */
import { isTauri } from "@tauri-apps/api/core";
import { Menu, MenuItem, PredefinedMenuItem } from "@tauri-apps/api/menu";
import { copyPath, reveal, revealLabel } from "./actions";
import { warn } from "./log";
import { useStore } from "../store";

export async function itemMenu(id: number, dir: boolean) {
  if (!isTauri()) return;
  useStore.getState().select(id);
  try {
    const items = await Promise.all([
      ...(dir ? [MenuItem.new({ text: "開く", action: () => void useStore.getState().go(id) })] : []),
      MenuItem.new({ text: revealLabel, action: () => void reveal(id) }),
      PredefinedMenuItem.new({ item: "Separator" }),
      MenuItem.new({ text: "パスをコピー", action: () => void copyPath(id) }),
    ]);
    const menu = await Menu.new({ items });
    await menu.popup();
  } catch (e) {
    warn("context menu", e);
  }
}

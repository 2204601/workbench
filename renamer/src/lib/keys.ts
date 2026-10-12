/**
 * Key combos as the command table writes them ("Mod+Shift+O": Mod is ⌘ on
 * macOS and Ctrl elsewhere), shown and matched against key events.
 */

export const isMac = navigator.userAgent.includes("Mac");

const MAC: Record<string, string> = {
  Mod: "⌘",
  Alt: "⌥",
  Shift: "⇧",
  Backspace: "⌫",
  // "↩" is drawn as an emoji.
  Enter: "Return",
};
const OTHER: Record<string, string> = { Mod: "Ctrl", Alt: "Alt", Shift: "Shift" };

/** The parts of a combo as drawn on key caps. */
export function keyParts(combo: string): string[] {
  return combo.split("+").map((p) => {
    if (p === "Arrows") return "↑ ↓";
    if (p === "Space") return "スペース";
    return (isMac ? MAC : OTHER)[p] ?? p;
  });
}

/** "⌘⇧O" / "Ctrl+Shift+O": how a combo reads in menus. */
export const comboText = (combo: string) => keyParts(combo).join(isMac ? "" : "+");

/** Letters and digits by position (any keyboard layout); symbols by the character typed. */
function keyMatches(key: string, e: KeyboardEvent): boolean {
  if (/^[A-Z]$/.test(key)) return e.code === `Key${key}`;
  if (/^[0-9]$/.test(key)) return e.code === `Digit${key}` || e.code === `Numpad${key}`;
  switch (key) {
    case "Esc":
      return e.key === "Escape";
    case "Space":
      return e.key === " ";
    default:
      return e.key === key;
  }
}

/** Typed with Shift on most layouts ("?"), so Shift isn't part of the combo. */
const shifted = (key: string) => key.length === 1 && !/[A-Za-z0-9]/.test(key);

/** Whether `e` is exactly `combo`: no extra modifiers. */
export function comboMatches(combo: string, e: KeyboardEvent): boolean {
  const parts = combo.split("+");
  const key = parts.pop()!;
  const mods = new Set(parts);
  if ((isMac ? e.metaKey : e.ctrlKey) !== mods.has("Mod")) return false;
  if ((isMac ? e.ctrlKey : e.metaKey) || e.altKey !== mods.has("Alt")) return false;
  if (!shifted(key) && e.shiftKey !== mods.has("Shift")) return false;
  return keyMatches(key, e);
}

/** Text editing keys a field keeps even with ⌘ / Ctrl (select all, copy, undo…). */
const EDITING = new Set(["KeyA", "KeyC", "KeyV", "KeyX", "KeyZ", "KeyY"]);

/** Keys typed into a field stay there: only other ⌘ / Ctrl combos get through. */
export function fromField(e: KeyboardEvent): boolean {
  const el = e.target as HTMLElement | null;
  const field = !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
  return field && (!(isMac ? e.metaKey : e.ctrlKey) || EDITING.has(e.code));
}

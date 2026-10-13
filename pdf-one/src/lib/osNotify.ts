/**
 * OS notifications (tauri-plugin-notification) for long tasks that end while
 * the user is in another app. In the app, its own toast says the same.
 */
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { sendNotification } from "@tauri-apps/plugin-notification";
import { warn } from "./log";

/**
 * A task this long is one the user may have left the app during. The window
 * not being focused alone doesn't tell: after a drop from Finder / Explorer,
 * that stays in front while the user watches the app.
 */
const LONG_MS = 10_000;

/** `since` is when the task started (`Date.now()`). */
export function notifyIfAway(since: number, title: string, body?: string) {
  if (!isTauri() || Date.now() - since < LONG_MS) return;
  getCurrentWindow()
    .isFocused()
    .then((focused) => {
      if (!focused) sendNotification({ title, body });
    })
    .catch((e) => warn("notification", e));
}

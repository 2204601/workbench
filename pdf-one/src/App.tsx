import { isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect } from "react";
import { ContextMenu } from "./components/ContextMenu";
import { PasswordDialog, SplitDialog } from "./components/Dialogs";
import { DropOverlay, useFileDrop } from "./components/DropZone";
import { Organizer } from "./components/Organizer";
import { PropertiesBar } from "./components/PropertiesBar";
import { SearchBar } from "./components/SearchBar";
import { SettingsDialog } from "./components/SettingsDialog";
import { ShortcutHelp } from "./components/ShortcutHelp";
import { Sidebar } from "./components/Sidebar";
import { StampDialog } from "./components/StampDialog";
import { StartScreen } from "./components/StartScreen";
import { Toasts } from "./components/Toasts";
import { TabBar, ToolBar } from "./components/Toolbar";
import { Viewer } from "./components/Viewer";
import { openRequested, settleAll } from "./lib/actions";
import { api } from "./lib/api";
import { onCopy, onPaste } from "./lib/clipboard";
import { runKey } from "./lib/commands";
import { warn } from "./lib/log";
import { installMenuBar } from "./lib/menuBar";
import { setTextFont } from "./lib/text";
import { loadAppVersion, scheduleUpdateCheck } from "./lib/update";
import { activeDoc, useStore } from "./store";

/** The settings' author name, else the OS user name. */
async function loadAuthor() {
  try {
    const [s, os] = await Promise.all([api.getAppSettings(), api.osUserName()]);
    useStore.getState().setAuthor(s.author.trim() || os);
  } catch (e) {
    warn("author", e);
  }
}

export default function App() {
  const dialog = useStore((s) => s.dialog);
  const d = useStore(activeDoc);
  const panel = useStore((s) => s.panel);
  const organizer = useStore((s) => s.organizer);
  const dropping = useFileDrop();

  useEffect(() => {
    void loadAppVersion();
    void loadAuthor();
    api.textFontFamily().then(setTextFont, () => setTextFont(null));
    const stopMenu = installMenuBar();
    const stopUpdate = scheduleUpdateCheck();
    const onKey = (e: KeyboardEvent) => void runKey(e);
    window.addEventListener("keydown", onKey);
    document.addEventListener("copy", onCopy);
    document.addEventListener("paste", onPaste);

    // Files from the OS: at launch, and later (a double-click while open).
    void openRequested();
    let unlisten: (() => void) | undefined;
    let gone = false;
    if (isTauri()) {
      listen("open-requested", () => void openRequested())
        .then((u) => (gone ? u() : (unlisten = u)))
        .catch((e) => warn("open-requested", e));
    }

    // Closing the window with unsaved changes asks about each tab first.
    let unclose: (() => void) | undefined;
    if (isTauri()) {
      const win = getCurrentWindow();
      win
        .onCloseRequested(async (e) => {
          if (!useStore.getState().docs.some((x) => x.dirty && !x.readOnly)) return;
          e.preventDefault();
          if (await settleAll()) await win.destroy();
        })
        .then((u) => (gone ? u() : (unclose = u)))
        .catch((e) => warn("close", e));
    }
    return () => {
      gone = true;
      stopMenu();
      stopUpdate();
      unlisten?.();
      unclose?.();
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("copy", onCopy);
      document.removeEventListener("paste", onPaste);
    };
  }, []);

  // The window's title: the file, with a dot when unsaved (Windows shows it).
  useEffect(() => {
    const title = d ? `${d.dirty ? "● " : ""}${d.name} — PDF One` : "PDF One";
    document.title = title;
    if (isTauri()) void getCurrentWindow().setTitle(title).catch(() => {});
  }, [d?.name, d?.dirty, d]);

  return (
    <div className="flex h-full flex-col">
      <TabBar />
      {d ? (
        <>
          <ToolBar />
          <PropertiesBar />
          <div className="flex min-h-0 flex-1">
            {panel && !organizer && <Sidebar d={d} />}
            <div className="relative flex min-w-0 flex-1">
              {organizer ? <Organizer d={d} /> : <Viewer key={d.key} d={d} />}
              {!organizer && <SearchBar />}
            </div>
          </div>
        </>
      ) : (
        <StartScreen />
      )}

      {dialog === "settings" && <SettingsDialog />}
      {dialog === "shortcuts" && <ShortcutHelp />}
      {dialog === "stamps" && <StampDialog />}
      {dialog === "split" && <SplitDialog />}
      <PasswordDialog />
      <ContextMenu />
      {dropping && <DropOverlay />}
      <Toasts />
    </div>
  );
}

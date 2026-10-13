import { useEffect } from "react";
import { DropOverlay, useFileDrop } from "./components/DropZone";
import { ExportDialog } from "./components/ExportDialog";
import { Inspector } from "./components/Inspector";
import { LeftPanel } from "./components/LeftPanel";
import { Preview } from "./components/Preview";
import { SettingsDialog } from "./components/SettingsDialog";
import { ShortcutHelp } from "./components/ShortcutHelp";
import { Timeline } from "./components/Timeline";
import { Toasts } from "./components/Toasts";
import { Toolbar } from "./components/Toolbar";
import { guardClose } from "./lib/actions";
import { installClipboard, runKey } from "./lib/commands";
import { listenMedia } from "./lib/media";
import { installMenuBar } from "./lib/menuBar";
import { loadAppVersion, scheduleUpdateCheck } from "./lib/update";
import { useStore } from "./store";

export default function App() {
  const dialog = useStore((s) => s.dialog);
  const dropping = useFileDrop();

  useEffect(() => {
    void loadAppVersion();
    const stops = [installMenuBar(), scheduleUpdateCheck(), listenMedia(), installClipboard(), guardClose()];
    const onKey = (e: KeyboardEvent) => void runKey(e);
    window.addEventListener("keydown", onKey);
    return () => {
      stops.forEach((f) => f());
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  return (
    <div className="flex h-full flex-col">
      <Toolbar />
      <div className="flex min-h-0 flex-1">
        <LeftPanel />
        <Preview />
        <Inspector />
      </div>
      <Timeline />

      {dialog === "settings" && <SettingsDialog />}
      {dialog === "shortcuts" && <ShortcutHelp />}
      {dialog === "export" && <ExportDialog />}
      {dropping && <DropOverlay />}
      <Toasts />
    </div>
  );
}

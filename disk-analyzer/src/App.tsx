import { useEffect } from "react";
import { ChartArea } from "./components/charts/ChartArea";
import { DropOverlay, useFolderDrop } from "./components/DropZone";
import { ItemList } from "./components/ItemList";
import { Scanning } from "./components/Scanning";
import { SettingsDialog } from "./components/SettingsDialog";
import { ShortcutHelp } from "./components/ShortcutHelp";
import { StartScreen } from "./components/StartScreen";
import { StatusBar } from "./components/StatusBar";
import { Toasts } from "./components/Toasts";
import { Toolbar } from "./components/Toolbar";
import { runKey } from "./lib/commands";
import { installMenuBar } from "./lib/menuBar";
import { loadAppVersion, scheduleUpdateCheck } from "./lib/update";
import { useStore } from "./store";

export default function App() {
  const dialog = useStore((s) => s.dialog);
  const scanning = useStore((s) => s.scanning !== null);
  const shown = useStore((s) => s.result !== null && s.folder !== null);
  const dropping = useFolderDrop();

  useEffect(() => {
    void loadAppVersion();
    const stopMenu = installMenuBar();
    const stopUpdate = scheduleUpdateCheck();
    const onKey = (e: KeyboardEvent) => void runKey(e);
    window.addEventListener("keydown", onKey);
    return () => {
      stopMenu();
      stopUpdate();
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  return (
    <div className="flex h-full flex-col">
      <Toolbar />
      {scanning ? (
        <Scanning />
      ) : shown ? (
        <div className="flex min-h-0 flex-1">
          <ChartArea />
          <ItemList />
        </div>
      ) : (
        <StartScreen />
      )}
      {!scanning && <StatusBar />}

      {dialog === "settings" && <SettingsDialog />}
      {dialog === "shortcuts" && <ShortcutHelp />}
      {dropping && <DropOverlay />}
      <Toasts />
    </div>
  );
}

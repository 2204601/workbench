import { useEffect } from "react";
import { DropOverlay, EmptyState, useFileDrop } from "./components/DropZone";
import { FileTable } from "./components/FileTable";
import { RulePanel } from "./components/RulePanel";
import { NotUndoneDialog, StoppedDialog } from "./components/RunDialogs";
import { SettingsDialog } from "./components/SettingsDialog";
import { ShortcutHelp } from "./components/ShortcutHelp";
import { StatusBar } from "./components/StatusBar";
import { Toasts } from "./components/Toasts";
import { Toolbar } from "./components/Toolbar";
import { checkInterrupted } from "./lib/actions";
import { runKey } from "./lib/commands";
import { installMenuBar } from "./lib/menuBar";
import { loadAppVersion, scheduleUpdateCheck } from "./lib/update";
import { useStore } from "./store";

export default function App() {
  const dialog = useStore((s) => s.dialog);
  const loaded = useStore((s) => s.listing.summary.total > 0);
  const dropping = useFileDrop();

  useEffect(() => {
    void loadAppVersion();
    void checkInterrupted();
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
      {loaded ? (
        <div className="flex min-h-0 flex-1">
          <RulePanel />
          <FileTable />
        </div>
      ) : (
        <EmptyState />
      )}
      <StatusBar />

      {dialog === "settings" && <SettingsDialog />}
      {dialog === "shortcuts" && <ShortcutHelp />}
      <StoppedDialog />
      <NotUndoneDialog />
      {dropping && <DropOverlay />}
      <Toasts />
    </div>
  );
}

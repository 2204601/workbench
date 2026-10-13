import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { Film } from "lucide-react";
import { useEffect, useState } from "react";
import { addFiles, openProject } from "../lib/actions";
import { warn } from "../lib/log";
import { useStore } from "../store";

/**
 * Files dropped from Finder / Explorer are added, through Tauri's drop
 * events (Platform UI §6: not HTML5 drag and drop). A .cutter file opens.
 * While something is dragged over the window, the whole window says so.
 */
export function useFileDrop(): boolean {
  const [over, setOver] = useState(false);
  useEffect(() => {
    if (!isTauri()) return;
    let stop: (() => void) | undefined;
    let gone = false;
    getCurrentWebview()
      .onDragDropEvent((e) => {
        const p = e.payload;
        if (p.type === "enter" || p.type === "over") setOver(!useStore.getState().exporting);
        else if (p.type === "leave") setOver(false);
        else if (p.type === "drop") {
          setOver(false);
          if (useStore.getState().exporting) return;
          const project = p.paths.find((x) => x.toLowerCase().endsWith(".cutter"));
          if (project) void openProject(project);
          else void addFiles(p.paths);
        }
      })
      .then((un) => (gone ? un() : (stop = un)))
      .catch((e) => warn("drop", e));
    return () => {
      gone = true;
      stop?.();
    };
  }, []);
  return over;
}

export function DropOverlay() {
  return (
    <div className="pointer-events-none fixed inset-0 z-40 flex animate-fade-in items-center justify-center bg-accent/10 p-6">
      <div className="flex h-full w-full flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-accent text-accent">
        <Film size={40} strokeWidth={1.5} />
        <div className="text-base">ドロップして追加</div>
        <div className="text-xs text-dim">動画・写真はタイムラインの最後に並びます。.cutter はプロジェクトとして開きます</div>
      </div>
    </div>
  );
}

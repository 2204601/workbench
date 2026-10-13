import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { FolderSearch } from "lucide-react";
import { useEffect, useState } from "react";
import { scan } from "../lib/actions";
import { warn } from "../lib/log";
import { useStore } from "../store";

/**
 * A folder dropped from Finder / Explorer is scanned, through Tauri's drop
 * events (Platform UI §6: not HTML5 drag and drop). While something is
 * dragged over the window, the whole window says what a drop does.
 */
export function useFolderDrop(): boolean {
  const [over, setOver] = useState(false);
  useEffect(() => {
    if (!isTauri()) return;
    let stop: (() => void) | undefined;
    let gone = false;
    getCurrentWebview()
      .onDragDropEvent((e) => {
        const p = e.payload;
        if (p.type === "enter" || p.type === "over") setOver(!useStore.getState().scanning);
        else if (p.type === "leave") setOver(false);
        else if (p.type === "drop") {
          setOver(false);
          if (p.paths.length !== 1) {
            useStore.getState().toast("フォルダを 1 つだけドロップしてください", true);
            return;
          }
          void scan(p.paths[0]);
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
        <FolderSearch size={40} strokeWidth={1.5} />
        <div className="text-base">ドロップしてスキャン</div>
        <div className="text-xs text-dim">フォルダの中を全部読んで、容量をグラフにします</div>
      </div>
    </div>
  );
}

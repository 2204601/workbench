import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { FolderOpen, FolderInput } from "lucide-react";
import { useEffect, useState } from "react";
import { dropPaths } from "../lib/actions";
import { command, runCommand } from "../lib/commands";
import { comboText } from "../lib/keys";
import { warn } from "../lib/log";

/**
 * Files and folders dropped from Finder / Explorer, through Tauri's drop
 * events (Platform UI §6: not HTML5 drag and drop). While something is
 * dragged over the window, the whole window says what a drop does.
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
        if (p.type === "enter" || p.type === "over") setOver(true);
        else if (p.type === "leave") setOver(false);
        else if (p.type === "drop") {
          setOver(false);
          void dropPaths(p.paths);
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
        <FolderInput size={40} strokeWidth={1.5} />
        <div className="text-base">ドロップして読み込む</div>
        <div className="text-xs text-dim">フォルダなら新しい一覧に、ファイルだけなら今の一覧に足します</div>
      </div>
    </div>
  );
}

/** Nothing loaded yet (docs/SPEC.md §3). */
export function EmptyState() {
  const open = command("file.openFolder");
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-8">
      <div className="flex w-full max-w-md flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-line px-8 py-14 text-center text-dim">
        <FolderOpen size={36} strokeWidth={1.5} />
        <div className="text-base text-fg">フォルダかファイルをここへドロップ</div>
        <div className="text-xs">フォルダの中のファイルを一覧にします（サブフォルダの中は含めません）</div>
        <button
          onClick={() => runCommand(open.id)}
          className="mt-3 rounded-md bg-accent px-4 py-1.5 text-white hover:brightness-110"
        >
          フォルダを開く（{comboText(open.keys![0])}）
        </button>
      </div>
    </div>
  );
}

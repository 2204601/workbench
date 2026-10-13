import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { create } from "zustand";
import { command, isEnabled, labelOf, runCommand } from "../lib/commands";
import { comboText } from "../lib/keys";
import { useStore } from "../store";

/**
 * The right-click menu: one level (Platform UI §7), made of command ids
 * from the command table, so it reads the same as the menu bar.
 */
export const useContextMenu = create<{
  at: { x: number; y: number } | null;
  items: (string | "-")[];
  open: (e: { clientX: number; clientY: number }, items: (string | "-")[]) => void;
  close: () => void;
}>()((set) => ({
  at: null,
  items: [],
  open: (e, items) => set({ at: { x: e.clientX, y: e.clientY }, items }),
  close: () => set({ at: null }),
}));

export function ContextMenu() {
  const { at, items, close } = useContextMenu();
  const s = useStore();
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState(at);

  // Kept inside the window.
  useLayoutEffect(() => {
    if (!at || !box.current) return;
    const r = box.current.getBoundingClientRect();
    setPos({ x: Math.min(at.x, window.innerWidth - r.width - 4), y: Math.min(at.y, window.innerHeight - r.height - 4) });
  }, [at]);

  useEffect(() => {
    if (!at) return;
    const away = (e: Event) => {
      if (!box.current?.contains(e.target as Node)) close();
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("pointerdown", away, true);
    window.addEventListener("keydown", key, true);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("pointerdown", away, true);
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("blur", close);
    };
  }, [at, close]);

  if (!at) return null;
  return (
    <div
      ref={box}
      data-modal
      role="menu"
      className="fixed z-50 min-w-52 animate-fade-in rounded-lg border border-line bg-panel py-1 shadow-2xl"
      style={{ left: (pos ?? at).x, top: (pos ?? at).y }}
    >
      {items.map((id, i) => {
        if (id === "-") return <div key={i} className="my-1 h-px bg-line" />;
        const c = command(id);
        const Icon = c.icon;
        const enabled = isEnabled(c, s);
        return (
          <button
            key={id}
            role="menuitem"
            disabled={!enabled}
            onClick={() => {
              close();
              runCommand(id);
            }}
            className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-sm hover:bg-accent hover:text-white disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-fg"
          >
            <span className="w-4">{Icon && <Icon size={14} />}</span>
            <span className="flex-1">{labelOf(c, s)}</span>
            {c.keys?.[0] && <span className="text-xs opacity-60">{comboText(c.keys[0])}</span>}
          </button>
        );
      })}
    </div>
  );
}

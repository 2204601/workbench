import { X } from "lucide-react";
import { useEffect, useRef } from "react";

/**
 * A dialog over the window. `data-modal` stops the page's keys while it is
 * open (src/lib/commands.ts `runKey`); Esc and a click outside close it.
 */
export function Modal({
  title,
  onClose,
  width = 480,
  children,
}: {
  title: string;
  onClose: () => void;
  width?: number;
  children: React.ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.isComposing) {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    box.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div
      data-modal
      className="fixed inset-0 z-40 flex animate-fade-in items-center justify-center bg-black/50"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        ref={box}
        tabIndex={-1}
        role="dialog"
        aria-label={title}
        className="max-h-[85vh] animate-zoom-in overflow-hidden rounded-xl border border-line bg-panel shadow-2xl outline-none"
        style={{ width }}
      >
        <div className="flex items-center border-b border-line px-4 py-3">
          <h2 className="flex-1 text-sm font-semibold">{title}</h2>
          <button onClick={onClose} className="rounded p-1 text-dim hover:bg-hover hover:text-fg" aria-label="閉じる">
            <X size={16} />
          </button>
        </div>
        <div className="max-h-[calc(85vh-49px)] overflow-y-auto p-4">{children}</div>
      </div>
    </div>
  );
}

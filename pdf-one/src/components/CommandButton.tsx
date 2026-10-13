import { command, isEnabled, runCommand } from "../lib/commands";
import { comboText } from "../lib/keys";
import { useStore } from "../store";

/** A toolbar button for a command: its icon, name and key from the table. */
export function CommandButton({ id, label, compact }: { id: string; label?: string; compact?: boolean }) {
  const c = command(id);
  const enabled = useStore((s) => isEnabled(c, s));
  const checked = useStore((s) => c.checked?.(s) ?? false);
  const Icon = c.icon;
  return (
    <button
      onClick={() => runCommand(id)}
      disabled={!enabled}
      title={c.keys ? `${c.title.replace(/…$/, "")}（${comboText(c.keys[0])}）` : c.title}
      aria-label={c.title}
      aria-pressed={c.checked ? checked : undefined}
      className={`flex h-7 shrink-0 items-center gap-1.5 rounded-md ${compact ? "px-1.5" : "px-2"} text-[13px] disabled:opacity-35 ${
        checked ? "bg-accent text-white" : "hover:bg-white/10"
      }`}
    >
      {Icon && <Icon size={16} />}
      {label}
    </button>
  );
}

import { command, isEnabled, plainTitle, runCommand } from "../lib/commands";
import { comboText } from "../lib/keys";
import { useStore } from "../store";

/**
 * A small button for a command: its icon and its name from the table (a
 * word on every button, docs/UX.md §2). `compact` shows the icon alone;
 * `label` replaces the name.
 */
export function CommandButton({ id, label, compact }: { id: string; label?: string; compact?: boolean }) {
  const c = command(id);
  const enabled = useStore((s) => isEnabled(c, s));
  const checked = useStore((s) => c.checked?.(s) ?? false);
  const Icon = c.icon;
  const title = plainTitle(c);
  return (
    <button
      onClick={() => runCommand(id)}
      disabled={!enabled}
      title={c.keys ? `${title}（${comboText(c.keys[0])}）` : title}
      aria-label={title}
      aria-pressed={c.checked ? checked : undefined}
      className={`flex h-8 shrink-0 items-center gap-1.5 rounded-md ${compact ? "px-1.5" : "px-2"} text-sm whitespace-nowrap disabled:opacity-40 ${
        checked ? "bg-accent text-white" : "hover:bg-hover"
      }`}
    >
      {Icon && <Icon size={16} />}
      {!compact && (label ?? title)}
    </button>
  );
}

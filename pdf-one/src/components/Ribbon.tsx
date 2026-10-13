import { ChevronDown } from "lucide-react";
import { useEffect, useState } from "react";
import { command, isEnabled, plainTitle, runCommand } from "../lib/commands";
import { comboText } from "../lib/keys";
import { RIBBON, isMenu, type RibbonMenu } from "../lib/ribbon";
import { useStore } from "../store";
import { CommandSearch } from "./CommandSearch";
import { useContextMenu } from "./ContextMenu";


/**
 * The work tabs and their big buttons (docs/UX.md §4–§5): a picture over a
 * word, 56px tall, in a few groups. Like Word's ribbon, which the people
 * who use this app already know.
 */
export function Ribbon() {
  const [tab, setTab] = useState(RIBBON[0].id);
  const active = useStore((s) => s.active);
  // A file opens on ホーム; the tab isn't remembered (UX §5).
  useEffect(() => setTab(RIBBON[0].id), [active]);
  const current = RIBBON.find((t) => t.id === tab) ?? RIBBON[0];

  /** 何をしますか picked a command: show the tab it lives on. */
  const reveal = (id: string) => {
    const home = RIBBON.find((t) => t.groups.flat().some((it) => (isMenu(it) ? it.items.includes(id) : it === id)));
    if (home) setTab(home.id);
  };

  return (
    <div className="shrink-0 border-b border-line bg-panel">
      <div className="flex items-end gap-1 px-2 pt-1.5" role="tablist">
        {RIBBON.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={t.id === tab}
            onClick={() => setTab(t.id)}
            className={`h-8 shrink-0 rounded-t-md border border-b-0 px-3.5 text-sm ${
              t.id === tab ? "border-line bg-bg font-medium text-fg" : "border-transparent text-dim hover:bg-hover hover:text-fg"
            }`}
          >
            {t.label}
          </button>
        ))}
        <div className="min-w-2 flex-1" />
        <div className="pb-1">
          <CommandSearch onPick={reveal} />
        </div>
      </div>
      <div className="@container border-t border-line bg-bg">
        <div className="flex items-stretch gap-1 overflow-x-auto px-2 py-1.5">
          {current.groups.map((g, i) => (
            <div key={i} className="flex shrink-0 items-stretch gap-0.5">
              {i > 0 && <div className="mx-1 my-2 w-px bg-line" />}
              {g.map((item) => (isMenu(item) ? <MenuButton key={item.id} menu={item} /> : <BigButton key={item} id={item} />))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * Narrower than 60rem (the ribbon's width; in rem, so 文字を大きく raises it
 * with the buttons), the buttons are a row: the picture beside the word.
 * Written out in full: Tailwind only finds class names it can read whole.
 */
const BIG =
  "flex h-14 min-w-14 shrink-0 flex-col items-center justify-center gap-1.5 rounded-md px-2 text-xs leading-none whitespace-nowrap disabled:opacity-40 @max-[60rem]:h-8 @max-[60rem]:flex-row @max-[60rem]:gap-1.5 @max-[60rem]:px-2.5";
const ICON = "@max-[60rem]:size-4";

/** A command as a big button: its picture over its name. */
function BigButton({ id }: { id: string }) {
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
      className={`${BIG} ${checked ? "bg-accent text-white" : "hover:bg-hover"}`}
    >
      {Icon && <Icon size={22} className={ICON} />}
      <span>{title}</span>
    </button>
  );
}

/** A few commands under one big button (図形, 印鑑・画像). */
function MenuButton({ menu }: { menu: RibbonMenu }) {
  const ids = menu.items.filter((x): x is string => x !== "-");
  const checked = useStore((s) => ids.some((id) => command(id).checked?.(s) ?? false));
  const enabled = useStore((s) => ids.some((id) => isEnabled(command(id), s)));
  const Icon = menu.icon;
  return (
    <button
      disabled={!enabled}
      aria-haspopup="menu"
      aria-pressed={checked}
      title={menu.title}
      onClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        useContextMenu.getState().open({ clientX: r.left, clientY: r.bottom + 2 }, menu.items);
      }}
      className={`${BIG} ${checked ? "bg-accent text-white" : "hover:bg-hover"}`}
    >
      <Icon size={22} className={ICON} />
      <span className="flex items-center gap-0.5">
        {menu.title}
        <ChevronDown size={12} />
      </span>
    </button>
  );
}

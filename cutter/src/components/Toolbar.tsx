import { Download, FilePlus2, FolderOpen, Redo2, Save, Undo2 } from "lucide-react";
import { baseName } from "../lib/api";
import { setAspect } from "../lib/actions";
import { command, isEnabled, labelOf, runCommand } from "../lib/commands";
import { comboText } from "../lib/keys";
import { ASPECTS, aspectOf, type Aspect } from "../lib/project";
import { dragRegion } from "../lib/titleBar";
import { dirty, useStore } from "../store";

/** A button for a command: its icon, name and key in the tooltip. */
export function CommandButton({ id, icon: Icon, text }: { id: string; icon: typeof Save; text?: string }) {
  const c = command(id);
  const enabled = useStore((s) => isEnabled(c, s));
  const label = useStore((s) => labelOf(c, s));
  const key = c.keys?.[0];
  return (
    <button
      onClick={() => runCommand(id)}
      disabled={!enabled}
      title={key ? `${label}（${comboText(key)}）` : label}
      className="flex h-8 items-center gap-1.5 rounded-md px-2 text-dim hover:bg-white/10 hover:text-fg disabled:opacity-35 disabled:hover:bg-transparent"
    >
      <Icon size={16} />
      {text && <span className="text-xs">{text}</span>}
    </button>
  );
}

export function Toolbar() {
  const path = useStore((s) => s.path);
  const changed = useStore(dirty);
  const aspect = useStore((s) => aspectOf(s.project));
  const canExport = useStore((s) => s.project.clips.length > 0 && !s.exporting);
  const openDialog = useStore((s) => s.openDialog);
  const name = path ? baseName(path).replace(/\.cutter$/, "") : "無題のプロジェクト";

  return (
    <div
      {...dragRegion(true)}
      className="flex h-12 shrink-0 items-center gap-1 border-b border-line bg-panel pr-3 pl-[calc(var(--traffic-lights)+8px)]"
    >
      <CommandButton id="file.new" icon={FilePlus2} />
      <CommandButton id="file.open" icon={FolderOpen} />
      <CommandButton id="file.save" icon={Save} />
      <div className="mx-1 h-5 w-px bg-line" />
      <CommandButton id="edit.undo" icon={Undo2} />
      <CommandButton id="edit.redo" icon={Redo2} />
      <div className="mx-3 min-w-0 flex-1 truncate text-center text-sm">
        {name}
        {changed && <span className="ml-1.5 text-dim" title="保存していない変更があります">●</span>}
      </div>
      <div className="flex rounded-md bg-bg p-0.5" role="radiogroup" aria-label="画面の形">
        {(Object.keys(ASPECTS) as Aspect[]).map((a) => (
          <button
            key={a}
            role="radio"
            aria-checked={aspect === a}
            onClick={() => setAspect(a)}
            title={ASPECTS[a].label}
            className={`rounded px-2.5 py-1 text-xs ${aspect === a ? "bg-raised text-fg" : "text-dim hover:text-fg"}`}
          >
            {a}
          </button>
        ))}
      </div>
      <button
        onClick={() => openDialog("export")}
        disabled={!canExport}
        className="ml-2 flex h-8 items-center gap-1.5 rounded-md bg-accent px-3 text-sm font-medium text-white hover:brightness-110 disabled:opacity-40"
      >
        <Download size={16} />
        書き出す
      </button>
    </div>
  );
}

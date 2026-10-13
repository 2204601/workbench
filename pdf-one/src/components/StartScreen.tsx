import { Clock, FileText, FolderOpen } from "lucide-react";
import { useEffect, useState } from "react";
import { baseName, openPaths } from "../lib/actions";
import { api } from "../lib/api";
import { command, runCommand } from "../lib/commands";
import { comboText } from "../lib/keys";
import { appVersion } from "../lib/update";

/** No file open (Platform UI §9): open one, or one used lately. */
export function StartScreen() {
  const [recent, setRecent] = useState<string[]>([]);
  const open = command("file.open");
  useEffect(() => {
    api.getAppSettings().then((s) => setRecent(s.recent), () => {});
  }, []);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex max-w-xl flex-col gap-8 px-6 py-14">
        <div className="flex flex-col items-center gap-5 rounded-2xl border-2 border-dashed border-line px-8 py-12 text-center">
          <FileText size={40} strokeWidth={1.4} className="text-accent" />
          <div>
            <h1 className="text-lg font-semibold">開く PDF を選んでください</h1>
            <p className="mt-1 text-dim">開いたらすぐ書き込めます。ここへドロップしても開けます。いくつでも、タブで並べて開けます。</p>
          </div>
          <button onClick={() => runCommand(open.id)} className="flex h-11 items-center gap-2 rounded-lg bg-accent px-6 text-base text-white hover:brightness-110">
            <FolderOpen size={18} />
            PDF を開く
            <span className="text-xs opacity-80">{comboText(open.keys![0])}</span>
          </button>
        </div>
        {recent.length > 0 && (
          <section aria-label="最近使ったファイル">
            <div className="mb-2 flex items-center gap-1.5 text-xs text-dim">
              <Clock size={12} />
              最近使ったファイル
            </div>
            <div className="flex flex-col">
              {recent.map((p) => (
                <button
                  key={p}
                  onClick={() => void openPaths([p])}
                  title={p}
                  className="flex items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-raised"
                >
                  <FileText size={16} className="shrink-0 text-dim" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{baseName(p)}</span>
                    <span className="block truncate text-xs text-dim">{p}</span>
                  </span>
                </button>
              ))}
            </div>
          </section>
        )}
        <div className="text-center text-xs text-dim">PDF One {appVersion()}</div>
      </div>
    </div>
  );
}

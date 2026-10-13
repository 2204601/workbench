import { CloudOff, Globe, TriangleAlert } from "lucide-react";
import { bytes, count, duration } from "../lib/format";
import { comboText } from "../lib/keys";
import { useStore } from "../store";

/** The bottom line (docs/SPEC.md §6): the folder on screen, the scan, and the room left on the drive. */
export function StatusBar() {
  const folder = useStore((s) => s.folder);
  const r = useStore((s) => s.result);
  if (!folder || !r) return null;
  const space = r.space;
  const used = space ? space.total - space.free : 0;
  return (
    <footer className="flex h-8 shrink-0 items-center gap-4 border-t border-line bg-panel px-3 text-xs text-dim">
      <span className="shrink-0 tabular-nums text-fg">{bytes(folder.size)}</span>
      <span className="shrink-0 tabular-nums">
        {count(folder.files)} ファイル・{count(folder.dirs)} フォルダ
      </span>
      <span className="min-w-0 flex-1 truncate" title={folder.path}>
        {folder.path}
      </span>
      {r.unreadable > 0 && (
        <span className="flex shrink-0 items-center gap-1 text-warn" title={r.errors.join("\n")}>
          <TriangleAlert size={13} />
          読めないフォルダ {count(r.unreadable)}
        </span>
      )}
      {r.cloudFiles > 0 && (
        <span
          className="flex shrink-0 items-center gap-1"
          title={`クラウドにだけあるファイル（OneDrive の「オンラインのみ」など）は、このパソコンの容量を使っていないので 0 として数えています。ダウンロードすると ${bytes(r.cloudBytes)} 増えます。`}
        >
          <CloudOff size={13} />
          クラウドのみ {count(r.cloudFiles)}
        </span>
      )}
      {r.network && (
        <span className="flex shrink-0 items-center gap-1" title="ネットワーク上のフォルダです">
          <Globe size={13} />
          ネットワーク
        </span>
      )}
      <span className="shrink-0 tabular-nums" title={`スキャンしたときの中身です。そのあと変わっていれば「もう一度スキャン」（${comboText("Mod+R")}）`}>
        スキャン {duration(r.elapsedMs)}
      </span>
      {space && space.total > 0 && (
        <span className="flex shrink-0 items-center gap-2 tabular-nums" title={`使用 ${bytes(used)} / 全体 ${bytes(space.total)}`}>
          <span className="h-1.5 w-20 overflow-hidden rounded-full bg-bg">
            <span className="block h-full rounded-full bg-s1" style={{ width: `${(used / space.total) * 100}%` }} />
          </span>
          空き {bytes(space.free)}
        </span>
      )}
    </footer>
  );
}

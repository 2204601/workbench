import { Globe } from "lucide-react";
import { baseName, count } from "../lib/format";
import { useStore } from "../store";

/** The bottom line (docs/SPEC.md §3): how many, which folder, and whether it is on the network. */
export function StatusBar() {
  const summary = useStore((s) => s.listing.summary);
  const { total, shown, changed, errors, folders } = summary;
  const network = folders.filter((f) => f.network).length;
  const where =
    folders.length === 1
      ? folders[0].path
      : folders.length > 1
        ? `${folders.length} つのフォルダ（${folders.map((f) => baseName(f.path)).slice(0, 3).join("、")}${folders.length > 3 ? "…" : ""}）`
        : "";
  return (
    <footer className="flex h-8 shrink-0 items-center gap-4 border-t border-line bg-panel px-3 text-xs text-dim">
      {total === 0 ? (
        <span>読み込まれていません</span>
      ) : (
        <>
          <span className="tabular-nums">
            {shown === total ? `${count(total)} 件` : `${count(total)} 件中 ${count(shown)} 件を表示`}
          </span>
          <span className="tabular-nums">変更 {count(changed)} 件</span>
          {errors > 0 && <span className="text-danger tabular-nums">問題 {count(errors)} 件</span>}
          <span className="min-w-0 flex-1 truncate text-right" title={folders.map((f) => f.path).join("\n")}>
            {where}
          </span>
          {network > 0 && (
            <span className="flex shrink-0 items-center gap-1 text-warn" title="ネットワーク上のフォルダです">
              <Globe size={13} />
              ネットワーク
            </span>
          )}
        </>
      )}
    </footer>
  );
}

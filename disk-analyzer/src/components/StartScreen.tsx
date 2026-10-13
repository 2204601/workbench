import { FolderOpen, Globe, HardDrive, House, RotateCw, Usb, type LucideIcon } from "lucide-react";
import { useEffect } from "react";
import { scan } from "../lib/actions";
import type { Place } from "../lib/api";
import { command, runCommand } from "../lib/commands";
import { bytes, percent } from "../lib/format";
import { comboText } from "../lib/keys";
import { useStore } from "../store";

const KIND: Record<Place["kind"], { icon: LucideIcon; name: string }> = {
  drive: { icon: HardDrive, name: "ローカルディスク" },
  removable: { icon: Usb, name: "外付けディスク" },
  network: { icon: Globe, name: "ネットワークドライブ" },
  home: { icon: House, name: "ホームフォルダ" },
};

/** "Windows (C:)" on Windows, the label alone elsewhere. */
function title(p: Place): string {
  if (p.kind === "home") return KIND.home.name;
  const name = p.label || KIND[p.kind].name;
  const letter = /^[A-Za-z]:\\?$/.test(p.path) ? p.path.slice(0, 2) : "";
  return letter ? `${name} (${letter})` : name;
}

function PlaceCard({ p }: { p: Place }) {
  const { icon: Icon } = KIND[p.kind];
  const s = p.space;
  const used = s ? s.total - s.free : 0;
  return (
    <button
      onClick={() => void scan(p.path)}
      className="group flex w-full items-center gap-4 rounded-xl border border-line bg-panel px-4 py-3 text-left hover:border-accent/60 hover:bg-raised"
    >
      <Icon size={28} strokeWidth={1.5} className="shrink-0 text-dim group-hover:text-accent" />
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex items-baseline gap-2">
          <span className="truncate text-[14px] font-semibold">{title(p)}</span>
          <span className="truncate text-xs text-dim">{p.path}</span>
        </span>
        {s && s.total > 0 ? (
          <>
            <span className="h-1.5 overflow-hidden rounded-full bg-bg">
              <span className="block h-full rounded-full bg-s1" style={{ width: `${(used / s.total) * 100}%` }} />
            </span>
            <span className="text-xs text-dim tabular-nums">
              空き {bytes(s.free)}（全体 {bytes(s.total)}、{percent(used, s.total)} 使用）
            </span>
          </>
        ) : (
          <span className="text-xs text-dim">容量を確かめられませんでした</span>
        )}
      </span>
    </button>
  );
}

/** Nothing scanned yet (docs/SPEC.md §2): the drives, a folder of one's own, or a drop. */
export function StartScreen() {
  const places = useStore((s) => s.places);
  const loadPlaces = useStore((s) => s.loadPlaces);
  const choose = command("file.choose");
  useEffect(() => {
    void loadPlaces();
  }, [loadPlaces]);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex max-w-2xl flex-col gap-6 px-6 py-10">
        <div>
          <h1 className="text-lg font-semibold">どこの容量を調べますか？</h1>
          <p className="mt-1 text-dim">
            ドライブかフォルダを選ぶと、中身を全部読んで、何が場所を使っているかをグラフにします。ファイルを消したり動かしたりはしません。
          </p>
        </div>
        <section className="flex flex-col gap-2" aria-label="ドライブ">
          <div className="flex items-center justify-between text-xs text-dim">
            <span>ドライブ</span>
            <button onClick={() => void loadPlaces()} className="flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-white/10 hover:text-fg">
              <RotateCw size={12} />
              更新
            </button>
          </div>
          {places === null ? (
            <div className="py-6 text-center text-dim">ドライブを確かめています…</div>
          ) : (
            places.map((p) => <PlaceCard key={`${p.kind}-${p.path}`} p={p} />)
          )}
        </section>
        <div className="flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-line px-8 py-8 text-center text-dim">
          <FolderOpen size={32} strokeWidth={1.5} />
          <div className="text-fg">フォルダをここへドロップ</div>
          <div className="text-xs">共有フォルダ（\\server\共有 など）も選べます。ネットワーク越しは時間がかかります</div>
          <button
            onClick={() => runCommand(choose.id)}
            className="mt-2 rounded-md bg-accent px-4 py-1.5 text-white hover:brightness-110"
          >
            フォルダを選ぶ（{comboText(choose.keys![0])}）
          </button>
        </div>
      </div>
    </div>
  );
}

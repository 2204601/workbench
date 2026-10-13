import { Lightbulb, X } from "lucide-react";
import { useEffect } from "react";
import { create } from "zustand";
import { api } from "../lib/api";
import { warn } from "../lib/log";
import { activeDoc, useStore } from "../store";

/** The first-run tips (docs/UX.md §9): one at a time, three in all, each once. */
const TIPS: Record<string, string> = {
  tabs: "上のタブで作業を選びます。まず「書き込み」を押してみてください。",
  select: "ページの上のものはクリックで選べます。右の「詳細」で色や大きさを変えられます。",
  save: "保存すると、元のファイルはそのまま残せます。保存のとき「新しいファイルとして保存」を選んでください。",
};

const useTips = create<{
  /** Loaded from the settings; null until then. */
  seen: string[] | null;
  queue: string[];
  show: (id: string) => void;
  dismiss: () => void;
}>()((set, get) => ({
  seen: null,
  queue: [],
  show: (id) => {
    const { seen, queue } = get();
    if (seen?.includes(id) || queue.includes(id)) return;
    set({ queue: [...queue, id] });
  },
  dismiss: () => {
    const { seen, queue } = get();
    const [id, ...rest] = queue;
    if (!id) return;
    const next = [...(seen ?? []), id];
    set({ seen: next, queue: rest });
    // Remembered across runs. Read fresh, so other settings aren't clobbered.
    api
      .getAppSettings()
      .then((s) => api.setAppSettings({ ...s, seenTips: next }))
      .catch((e) => warn("tips", e));
  },
}));

export function showTip(id: string) {
  useTips.getState().show(id);
}

/** The tip in turn, over the top of the pages, until わかった. */
export function Tips() {
  const seen = useTips((s) => s.seen);
  const queue = useTips((s) => s.queue);
  const d = useStore(activeDoc);
  const edited = useStore((s) => (activeDoc(s)?.past.length ?? 0) > 0);
  const dirty = useStore((s) => activeDoc(s)?.dirty ?? false);

  useEffect(() => {
    if (seen !== null) return;
    // Tips asked for meanwhile wait here; the ones already seen drop out.
    api.getAppSettings().then(
      (s) => {
        const seenNow = s.seenTips ?? [];
        useTips.setState((t) => ({ seen: seenNow, queue: t.queue.filter((id) => !seenNow.includes(id)) }));
      },
      () => useTips.setState({ seen: [] }),
    );
  }, [seen]);

  // When each tip is due.
  useEffect(() => {
    if (d && !d.readOnly) showTip("tabs");
  }, [d]);
  useEffect(() => {
    if (edited) showTip("select");
  }, [edited]);
  useEffect(() => {
    if (dirty) showTip("save");
  }, [dirty]);

  const id = seen ? queue[0] : undefined;
  if (!id || !d) return null;
  return (
    <div
      role="status"
      className="absolute top-3 left-1/2 z-20 flex max-w-[min(32rem,calc(100%-2rem))] -translate-x-1/2 animate-fade-in items-center gap-3 rounded-lg border border-accent bg-panel py-2.5 pr-2 pl-3.5 shadow-xl"
    >
      <Lightbulb size={18} className="shrink-0 text-accent" />
      <span className="text-sm leading-snug">{TIPS[id]}</span>
      <button
        onClick={() => useTips.getState().dismiss()}
        className="flex h-8 shrink-0 items-center gap-1 rounded-md bg-accent px-3 text-sm text-white hover:brightness-110"
      >
        わかった
      </button>
      <button onClick={() => useTips.getState().dismiss()} className="rounded p-1 text-dim hover:bg-hover hover:text-fg" aria-label="閉じる">
        <X size={14} />
      </button>
    </div>
  );
}

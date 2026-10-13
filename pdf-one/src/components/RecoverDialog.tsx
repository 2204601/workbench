import { FileText, RotateCcw, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { create } from "zustand";
import { baseName } from "../lib/actions";
import { api, type Draft } from "../lib/api";
import { restoreDraft } from "../lib/drafts";
import { warn } from "../lib/log";
import { useStore } from "../store";
import { Modal } from "./Modal";

const st = () => useStore.getState();

/** Looks for drafts left by a previous run; opens the dialog if there are any. */
export async function checkDrafts() {
  try {
    const drafts = await api.listDrafts();
    if (drafts.length) {
      useRecover.setState({ drafts });
      st().openDialog("recover");
    }
  } catch (e) {
    warn("drafts", e);
  }
}

const useRecover = create<{ drafts: Draft[] }>()(() => ({ drafts: [] }));

function when(ms: number): string {
  const t = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${t.getFullYear()}/${p(t.getMonth() + 1)}/${p(t.getDate())} ${p(t.getHours())}:${p(t.getMinutes())}`;
}

/**
 * 前回、保存していない変更があります (docs/SPEC.md「保存」): each draft can be
 * brought back as a tab, or thrown away. Left alone, it is asked about
 * again next time.
 */
export function RecoverDialog() {
  const drafts = useRecover((s) => s.drafts);
  const [busy, setBusy] = useState<string | null>(null);
  const close = () => st().openDialog(null);
  useEffect(() => {
    if (!drafts.length) close();
  }, [drafts.length]);

  const remove = async (d: Draft) => {
    await api.removeDraft(d.id).catch((e) => warn("draft", e));
    useRecover.setState({ drafts: useRecover.getState().drafts.filter((x) => x.id !== d.id) });
  };
  const restore = async (d: Draft) => {
    setBusy(d.id);
    const ok = await restoreDraft(d);
    setBusy(null);
    if (ok) useRecover.setState({ drafts: useRecover.getState().drafts.filter((x) => x.id !== d.id) });
  };

  return (
    <Modal title="前回、保存していない変更があります" onClose={close} width={560}>
      <p className="mb-3 text-sm leading-relaxed">
        前回の編集の下書きが残っています。「戻す」で続きから編集できます（元のファイルはそのままです）。いらなければ「捨てる」。
      </p>
      <div className="flex flex-col gap-2">
        {drafts.map((d) => (
          <div key={d.id} className="flex items-center gap-3 rounded-lg border border-line px-3 py-2">
            <FileText size={18} className="shrink-0 text-dim" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm">{baseName(d.path)}</div>
              <div className="truncate text-xs text-dim">
                {when(d.savedAt)} に下書き ・ {d.path}
              </div>
            </div>
            <button
              onClick={() => void restore(d)}
              disabled={busy !== null}
              className="flex h-8 shrink-0 items-center gap-1 rounded-md bg-accent px-3 text-sm text-white hover:brightness-110 disabled:opacity-50"
            >
              <RotateCcw size={14} />
              {busy === d.id ? "戻しています…" : "戻す"}
            </button>
            <button
              onClick={() => void remove(d)}
              disabled={busy !== null}
              className="flex h-8 shrink-0 items-center gap-1 rounded-md px-2.5 text-sm text-dim hover:bg-danger hover:text-white disabled:opacity-50"
            >
              <Trash2 size={14} />
              捨てる
            </button>
          </div>
        ))}
      </div>
      <div className="mt-4 flex items-center justify-between">
        <button
          onClick={() => void Promise.all(drafts.map(remove))}
          disabled={busy !== null}
          className="rounded-md px-3 py-1.5 text-sm text-dim hover:bg-hover disabled:opacity-50"
        >
          すべて捨てる
        </button>
        <button onClick={close} className="rounded-md px-3 py-1.5 text-sm hover:bg-hover">
          あとで決める
        </button>
      </div>
    </Modal>
  );
}

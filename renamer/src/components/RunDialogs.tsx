import { AlertTriangle } from "lucide-react";
import { finishRename, resumeRename, undoLast } from "../lib/actions";
import type { Failure } from "../lib/api";
import { count } from "../lib/format";
import { useStore } from "../store";
import { Modal } from "./Modal";

function FailureLine({ f }: { f: Failure }) {
  return (
    <div className="rounded-md bg-bg px-3 py-2">
      <div className="truncate font-medium" title={`${f.folder}\n${f.name}`}>
        {f.name}
        <span className="mx-1.5 text-dim">→</span>
        {f.newName}
      </div>
      <div className="mt-0.5 text-xs text-danger">{f.reason}</div>
    </div>
  );
}

/**
 * A run stopped (docs/SPEC.md §7): a file failed, or the user stopped it.
 * Nothing goes on until one of the three is chosen; closing the dialog is
 * "stop here".
 */
export function StoppedDialog() {
  const stopped = useStore((s) => s.stopped);
  if (!stopped) return null;
  const { failure, renamed, remaining } = stopped;
  return (
    <Modal title={failure ? "名前を変更できないファイルがありました" : "名前の変更を中止しました"} onClose={() => void finishRename()} width={500}>
      <div className="flex flex-col gap-3">
        {failure && (
          <>
            <div className="flex items-start gap-2">
              <AlertTriangle size={18} className="mt-0.5 shrink-0 text-warn" />
              <p>このファイルで止まりました。</p>
            </div>
            <FailureLine f={failure} />
          </>
        )}
        <p className="text-dim">
          {count(renamed)} 件は変更済み、残りは {count(remaining)} 件です。
        </p>
        <div className="mt-2 flex flex-col gap-2">
          <button
            onClick={() => void undoLast(false)}
            className="rounded-md bg-accent px-3 py-2 text-left text-white hover:brightness-110"
            disabled={renamed === 0}
          >
            変更した {count(renamed)} 件を元に戻す
          </button>
          {failure && (
            <button onClick={() => void resumeRename()} className="rounded-md bg-raised px-3 py-2 text-left hover:bg-white/10">
              このファイルを飛ばして続ける
            </button>
          )}
          <button onClick={() => void finishRename()} className="rounded-md bg-raised px-3 py-2 text-left hover:bg-white/10">
            ここで終える（変更した分はそのまま）
          </button>
        </div>
      </div>
    </Modal>
  );
}

/** After an undo: the files that stayed as they were, and why (docs/SAFETY.md §3). */
export function NotUndoneDialog() {
  const failed = useStore((s) => s.notUndone);
  if (!failed) return null;
  const close = () => useStore.setState({ notUndone: null });
  return (
    <Modal title={`${count(failed.length)} 件は元に戻せませんでした`} onClose={close} width={520}>
      <p className="mb-3 text-dim">
        ほかの人が動かしたか、元の名前がもう使われています。これらは今の名前のままです。もう一度「元に戻す」を試せます。
      </p>
      <div className="flex max-h-80 flex-col gap-1.5 overflow-y-auto">
        {failed.map((f, i) => (
          <FailureLine key={i} f={f} />
        ))}
      </div>
      <div className="mt-4 text-right">
        <button onClick={close} className="rounded-md bg-raised px-4 py-1.5 hover:bg-white/10">
          閉じる
        </button>
      </div>
    </Modal>
  );
}

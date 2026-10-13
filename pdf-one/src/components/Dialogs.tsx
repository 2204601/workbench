import { FilePlus2, FolderOpen, Save } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { create } from "zustand";
import { revealLabel, splitDocument } from "../lib/actions";
import { api } from "../lib/api";
import { runCommand } from "../lib/commands";
import { setPasswordPrompt } from "../lib/pdfjs";
import { activeDoc, useStore } from "../store";
import { Modal } from "./Modal";

const st = () => useStore.getState();

/** ページごとに分割: how many pages go in each file. */
export function SplitDialog() {
  const d = useStore(activeDoc);
  const [every, setEvery] = useState(1);
  const close = () => st().openDialog(null);
  if (!d) return null;
  const files = Math.ceil(d.pages.length / Math.max(1, every));
  return (
    <Modal title="ページごとに分割" onClose={close} width={400}>
      <label className="flex items-center gap-2">
        <input
          type="number"
          min={1}
          max={d.pages.length}
          value={every}
          onChange={(e) => setEvery(Math.max(1, Number(e.target.value) || 1))}
          className="h-8 w-20 rounded border border-line bg-bg px-2 text-right outline-none focus:border-accent"
        />
        ページずつ、別のファイルにする
      </label>
      <p className="mt-2 text-xs text-dim">
        全 {d.pages.length} ページが {files} 個のファイルになります。保存するフォルダを次に選びます。元のファイルは変わりません。
      </p>
      <div className="mt-5 flex justify-end gap-2">
        <button onClick={close} className="rounded-md px-3 py-1.5 hover:bg-hover">
          キャンセル
        </button>
        <button
          onClick={() => {
            close();
            void splitDocument(every);
          }}
          className="rounded-md bg-accent px-4 py-1.5 text-white hover:brightness-110"
        >
          分割する…
        </button>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- 保存のしかた

export type SaveChoice = "new" | "overwrite";

const useSaveChoice = create<{ ask: { name: string; suggested: string; answer: (c: SaveChoice | null) => void } | null }>()(() => ({
  ask: null,
}));

/**
 * Before a file's first save (docs/UX.md §8): a new file next to the
 * original (the default), or the original itself with the old version kept
 * in the backups. Null: cancelled.
 */
export function askSaveChoice(name: string, suggested: string): Promise<SaveChoice | null> {
  return new Promise((resolve) =>
    useSaveChoice.setState({
      ask: {
        name,
        suggested,
        answer: (c) => {
          useSaveChoice.setState({ ask: null });
          resolve(c);
        },
      },
    }),
  );
}

const choice = "flex w-full items-start gap-3 rounded-lg border border-line px-3 py-2.5 text-left hover:border-accent hover:bg-hover";

export function SaveChoiceDialog() {
  const ask = useSaveChoice((s) => s.ask);
  if (!ask) return null;
  return (
    <Modal title="保存のしかた" onClose={() => ask.answer(null)} width={460}>
      <p className="mb-3">「{ask.name}」をどのように保存しますか？</p>
      <div className="flex flex-col gap-2">
        <button onClick={() => ask.answer("new")} className={`${choice} border-accent`} autoFocus>
          <FilePlus2 size={20} className="mt-0.5 shrink-0 text-accent" />
          <span>
            <span className="block font-medium">新しいファイルとして保存（おすすめ）</span>
            <span className="mt-0.5 block text-xs leading-relaxed text-dim">元のファイルはそのまま残ります。名前は「{ask.suggested}」を提案します（変えられます）。</span>
          </span>
        </button>
        <button onClick={() => ask.answer("overwrite")} className={choice}>
          <Save size={20} className="mt-0.5 shrink-0 text-dim" />
          <span>
            <span className="block font-medium">元のファイルに上書き</span>
            <span className="mt-0.5 block text-xs leading-relaxed text-dim">上書きする前の版はバックアップに残るので、あとで戻せます。</span>
          </span>
        </button>
      </div>
      <p className="mt-3 flex flex-wrap items-center gap-x-1 text-xs text-dim">
        次からは聞かずに、同じ場所へ保存します。別の名前にしたいときは「名前を付けて保存」。
        <button
          onClick={() => {
            ask.answer(null);
            void api.revealBackups().catch(() => runCommand("file.backups"));
          }}
          className="inline-flex items-center gap-0.5 text-accent hover:underline"
        >
          <FolderOpen size={11} />
          バックアップのフォルダを{revealLabel.replace("で表示", "で開く")}
        </button>
      </p>
      <div className="mt-4 flex justify-end">
        <button onClick={() => ask.answer(null)} className="rounded-md px-3 py-1.5 hover:bg-hover">
          キャンセル
        </button>
      </div>
    </Modal>
  );
}

/** A password for a protected PDF, asked for by pdf.js (src/lib/pdfjs.ts). */
const usePassword = create<{ ask: { name: string; wrong: boolean; answer: (p: string | null) => void } | null }>()(() => ({
  ask: null,
}));

setPasswordPrompt(
  (name, wrong) =>
    new Promise((resolve) =>
      usePassword.setState({
        ask: {
          name,
          wrong,
          answer: (p) => {
            usePassword.setState({ ask: null });
            resolve(p);
          },
        },
      }),
    ),
);

export function PasswordDialog() {
  const ask = usePassword((s) => s.ask);
  const [value, setValue] = useState("");
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => {
    setValue("");
    field.current?.focus();
  }, [ask]);
  if (!ask) return null;
  return (
    <Modal title="パスワード" onClose={() => ask.answer(null)} width={400}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          ask.answer(value);
        }}
      >
        <p className="mb-3">「{ask.name}」はパスワードで保護されています。</p>
        {ask.wrong && <p className="mb-2 text-danger">パスワードが違います。</p>}
        <input
          ref={field}
          type="password"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="h-8 w-full rounded border border-line bg-bg px-2 outline-none focus:border-accent"
          aria-label="パスワード"
        />
        <p className="mt-2 text-xs text-dim">パスワードで保護された PDF は、表示だけできます。</p>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={() => ask.answer(null)} className="rounded-md px-3 py-1.5 hover:bg-hover">
            キャンセル
          </button>
          <button type="submit" className="rounded-md bg-accent px-4 py-1.5 text-white hover:brightness-110">
            開く
          </button>
        </div>
      </form>
    </Modal>
  );
}

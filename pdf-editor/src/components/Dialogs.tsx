import { useEffect, useRef, useState } from "react";
import { create } from "zustand";
import { splitDocument } from "../lib/actions";
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
        <button onClick={close} className="rounded-md px-3 py-1.5 hover:bg-white/10">
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
        <p className="mt-2 text-xs text-dim">保護された PDF は表示だけできます。</p>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={() => ask.answer(null)} className="rounded-md px-3 py-1.5 hover:bg-white/10">
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

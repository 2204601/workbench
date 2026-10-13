import { Printer } from "lucide-react";
import { useState } from "react";
import { PAPERS, parseRange, printDocument, type PrintOptions } from "../lib/print";
import { activeDoc, useStore } from "../store";
import { Modal } from "./Modal";

const st = () => useStore.getState();

type Range = "all" | "current" | "some";

/**
 * 印刷 (docs/SPEC.md「印刷」): the few things the OS's dialog doesn't
 * know about the document; everything else is left to that dialog.
 */
export function PrintDialog() {
  const d = useStore(activeDoc);
  const close = () => st().openDialog(null);
  const [range, setRange] = useState<Range>("all");
  const [some, setSome] = useState("");
  const [paper, setPaper] = useState<keyof typeof PAPERS>("a4");
  const [fit, setFit] = useState(true);
  const [perSheet, setPerSheet] = useState<1 | 2>(1);
  const [orientation, setOrientation] = useState<PrintOptions["orientation"]>("auto");
  const [withMarks, setWithMarks] = useState(true);
  if (!d) return null;

  const count = d.pages.length;
  const pages: number[] | null =
    range === "all" ? d.pages.map((_, i) => i) : range === "current" ? [d.page] : parseRange(some, count);
  const bad = range === "some" && some.trim() !== "" && pages === null;

  const go = () => {
    if (!pages) return;
    close();
    void printDocument(d, { pages, paper, fit, perSheet, orientation, withMarks });
  };

  const choice = (on: boolean) => `h-8 rounded-md px-3 text-sm ${on ? "bg-accent text-white" : "bg-raised hover:bg-hover"}`;
  const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <div className="flex flex-col gap-1.5">
      <div className="text-xs text-dim">{label}</div>
      <div className="flex flex-wrap items-center gap-1">{children}</div>
    </div>
  );
  return (
    <Modal title="印刷" onClose={close} width={520}>
      <div className="flex flex-col gap-4">
        <Row label="印刷するページ">
          <button onClick={() => setRange("all")} className={choice(range === "all")}>
            すべて（{count} ページ）
          </button>
          <button onClick={() => setRange("current")} className={choice(range === "current")}>
            いまのページ（{d.page + 1}）
          </button>
          <button onClick={() => setRange("some")} className={choice(range === "some")}>
            指定する
          </button>
          {range === "some" && (
            <input
              value={some}
              autoFocus
              onChange={(e) => setSome(e.target.value)}
              placeholder="例：1-3, 5"
              aria-label="印刷するページ"
              className={`h-8 w-32 rounded border bg-bg px-2 text-sm outline-none focus:border-accent ${bad ? "border-danger" : "border-line"}`}
            />
          )}
        </Row>
        {bad && <div className="-mt-2 text-xs text-danger">「1-3, 5」のように、1 から {count} までの番号で書いてください</div>}
        <Row label="用紙">
          {(Object.keys(PAPERS) as (keyof typeof PAPERS)[]).map((k) => (
            <button key={k} onClick={() => setPaper(k)} className={choice(paper === k)}>
              {PAPERS[k].label}
            </button>
          ))}
        </Row>
        <Row label="大きさ">
          <button onClick={() => setFit(true)} className={choice(fit)} title="ページを用紙いっぱいに広げたり縮めたりします">
            用紙に合わせる
          </button>
          <button onClick={() => setFit(false)} className={choice(!fit)} title="PDF の大きさのまま。用紙より大きいところは切れます">
            実際の大きさ
          </button>
        </Row>
        <Row label="1 枚の用紙に">
          <button onClick={() => setPerSheet(1)} className={choice(perSheet === 1)}>
            1 ページ
          </button>
          <button onClick={() => setPerSheet(2)} className={choice(perSheet === 2)} title="用紙を横にして、2 ページを並べます">
            2 ページ
          </button>
        </Row>
        <Row label="用紙の向き">
          <button onClick={() => setOrientation("auto")} className={choice(orientation === "auto")}>
            自動
          </button>
          <button onClick={() => setOrientation("portrait")} className={choice(orientation === "portrait")}>
            縦
          </button>
          <button onClick={() => setOrientation("landscape")} className={choice(orientation === "landscape")}>
            横
          </button>
        </Row>
        {!d.readOnly && (
          <label className="flex cursor-pointer items-start gap-2">
            <input type="checkbox" checked={withMarks} onChange={(e) => setWithMarks(e.target.checked)} className="mt-0.5 accent-accent" />
            <span>
              <span className="block text-sm">書き込みも印刷する</span>
              <span className="block text-xs text-dim">外すと、元の PDF のページだけを印刷します</span>
            </span>
          </label>
        )}
        <p className="rounded-md bg-raised p-2.5 text-xs leading-relaxed text-dim">
          このあと、パソコンの印刷の画面が開きます。プリンター、部数、両面はそこで選びます。
        </p>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <button onClick={close} className="rounded-md px-3 py-1.5 hover:bg-hover">
          キャンセル
        </button>
        <button
          onClick={go}
          disabled={!pages}
          className="flex items-center gap-1.5 rounded-md bg-accent px-4 py-1.5 text-white hover:brightness-110 disabled:opacity-50"
        >
          <Printer size={15} />
          印刷する…
        </button>
      </div>
    </Modal>
  );
}

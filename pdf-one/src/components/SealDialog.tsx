import { useEffect, useMemo, useState } from "react";
import { create } from "zustand";
import { boxSealSize, sealDate, sealLayout, SEAL_WORDS } from "../lib/seal";
import { textFontFamily } from "../lib/text";
import { useStore, type PendingSeal } from "../store";
import { Modal } from "./Modal";

const st = () => useStore.getState();

/** Which seal the dialog makes: a date seal, or a word in a box. */
export const useSealDialog = create<{ mode: "date" | "word"; open: (mode: "date" | "word") => void }>()((set) => ({
  mode: "date",
  open: (mode) => {
    set({ mode });
    st().openDialog("seal");
  },
}));

const COLORS: [string, string][] = [
  ["#d62828", "赤"],
  ["#1d4ed8", "青"],
  ["#111111", "黒"],
];
const MM = 72 / 25.4;
const DIAMETERS: [number, string][] = [
  [18, "小（18 mm）"],
  [24, "中（24 mm）"],
  [30, "大（30 mm）"],
];
const WORD_SIZES: [number, string][] = [
  [12, "小"],
  [16, "中"],
  [22, "大"],
];

/** A seal as it will look, drawn the way the overlay draws it. */
export function SealPreview({ seal, px }: { seal: PendingSeal; px: number }) {
  const [w, h] = seal.size;
  const l = sealLayout(seal.shape, w, h, seal.fontSize, seal.width, seal.lines);
  const i = seal.width / 2;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width={w * px} height={h * px} style={{ fontFamily: textFontFamily() }} aria-hidden>
      {seal.shape === "round" ? (
        <ellipse cx={w / 2} cy={h / 2} rx={w / 2 - i} ry={h / 2 - i} fill="none" stroke={seal.color} strokeWidth={seal.width} />
      ) : (
        <rect x={i} y={i} width={w - seal.width} height={h - seal.width} fill="none" stroke={seal.color} strokeWidth={seal.width} />
      )}
      {l.dividers.map(([y, x1, x2], k) => (
        <line key={k} x1={x1} y1={h - y} x2={x2} y2={h - y} stroke={seal.color} strokeWidth={seal.width} />
      ))}
      {l.lines.map((line, k) => (
        <text key={k} x={line.x} y={h - line.y} fontSize={line.size} fill={seal.color} dominantBaseline="central" style={{ fontKerning: "none" }}>
          {line.text}
        </text>
      ))}
    </svg>
  );
}

/**
 * 日付印 / 文字の印 (docs/SPEC.md「印鑑」): made here from a few words, then
 * placed with a click. Drawn as lines and text, not a picture, so it stays
 * sharp and the words can be changed later in 詳細.
 */
export function SealDialog() {
  const mode = useSealDialog((s) => s.mode);
  const author = useStore((s) => s.author);
  const close = () => st().openDialog(null);

  const [era, setEra] = useState<"western" | "reiwa">("western");
  const [top, setTop] = useState("");
  const [date, setDate] = useState(() => sealDate("western"));
  const [bottom, setBottom] = useState(author);
  const [color, setColor] = useState(COLORS[0][0]);
  const [diameter, setDiameter] = useState(24);
  const [word, setWord] = useState(SEAL_WORDS[0]);
  const [wordSize, setWordSize] = useState(16);
  useEffect(() => setDate(sealDate(era)), [era]);

  const seal = useMemo<PendingSeal>(() => {
    if (mode === "date") {
      const d = diameter * MM;
      return { shape: "round", lines: [top, date, bottom], color, fontSize: Math.round(diameter * 0.38 * 10) / 10, width: 1.5, size: [d, d] };
    }
    const text = word.trim() || SEAL_WORDS[0];
    return { shape: "box", lines: [text], color, fontSize: wordSize, width: 1.5, size: boxSealSize(text, wordSize) };
  }, [mode, top, date, bottom, color, diameter, word, wordSize]);

  const place = () => {
    st().setTool("seal");
    st().setPendingSeal(seal);
    close();
    st().notify({ title: "置く場所をクリックしてください", detail: "置いたあとも、ドラッグで動かしたり、「詳細」で文字を直したりできます。", duration: 4000 });
  };

  const field = "h-8 w-full rounded border border-line bg-bg px-2 text-sm outline-none focus:border-accent";
  const choice = (on: boolean) => `h-8 rounded-md px-3 text-sm ${on ? "bg-accent text-white" : "bg-raised hover:bg-hover"}`;
  return (
    <Modal title={mode === "date" ? "日付印を作る" : "文字の印を作る"} onClose={close} width={560}>
      <div className="flex gap-5">
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          {mode === "date" ? (
            <>
              <label className="flex flex-col gap-1 text-xs text-dim">
                上の文字（部署や会社名。空でもよい）
                <input value={top} onChange={(e) => setTop(e.target.value)} placeholder="営業部" className={field} />
              </label>
              <div className="flex flex-col gap-1 text-xs text-dim">
                日付
                <div className="flex gap-1">
                  <input value={date} onChange={(e) => setDate(e.target.value)} className={field} aria-label="日付" />
                  <button onClick={() => setEra("western")} className={choice(era === "western")} title="2026.10.13 の形">
                    西暦
                  </button>
                  <button onClick={() => setEra("reiwa")} className={choice(era === "reiwa")} title="令和8.10.13 の形">
                    令和
                  </button>
                </div>
              </div>
              <label className="flex flex-col gap-1 text-xs text-dim">
                下の文字（名前）
                <input value={bottom} onChange={(e) => setBottom(e.target.value)} placeholder="鈴木" className={field} />
              </label>
              <div className="flex flex-col gap-1 text-xs text-dim">
                大きさ
                <div className="flex gap-1">
                  {DIAMETERS.map(([mm, label]) => (
                    <button key={mm} onClick={() => setDiameter(mm)} className={choice(diameter === mm)}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="flex flex-col gap-1 text-xs text-dim">
                言葉
                <div className="flex flex-wrap gap-1">
                  {SEAL_WORDS.map((w) => (
                    <button key={w} onClick={() => setWord(w)} className={choice(word === w)}>
                      {w}
                    </button>
                  ))}
                </div>
                <input value={word} onChange={(e) => setWord(e.target.value)} placeholder="ほかの言葉" className={`${field} mt-1`} aria-label="印の言葉" />
              </div>
              <div className="flex flex-col gap-1 text-xs text-dim">
                文字の大きさ
                <div className="flex gap-1">
                  {WORD_SIZES.map(([n, label]) => (
                    <button key={n} onClick={() => setWordSize(n)} className={choice(wordSize === n)}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}
          <div className="flex flex-col gap-1 text-xs text-dim">
            色
            <div className="flex gap-1">
              {COLORS.map(([c, label]) => (
                <button key={c} onClick={() => setColor(c)} className={`${choice(color === c)} flex items-center gap-1.5`}>
                  <span className="h-3.5 w-3.5 rounded-full border border-white/40" style={{ background: c }} />
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="flex w-44 shrink-0 flex-col items-center gap-2">
          <div className="text-xs text-dim">見本（実物の大きさ）</div>
          <div className="flex h-40 w-40 items-center justify-center rounded-lg border border-line bg-white">
            <SealPreview seal={seal} px={96 / 72} />
          </div>
        </div>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <button onClick={close} className="rounded-md px-3 py-1.5 hover:bg-hover">
          キャンセル
        </button>
        <button onClick={place} className="rounded-md bg-accent px-4 py-1.5 text-white hover:brightness-110">
          置く
        </button>
      </div>
    </Modal>
  );
}

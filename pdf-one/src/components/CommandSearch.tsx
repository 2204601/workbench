import { Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { COMMANDS, isEnabled, plainTitle, runCommand, type Command } from "../lib/commands";
import { comboText } from "../lib/keys";
import { useStore } from "../store";

/** Commands that are only keys (arrows, Esc) or need no finding. */
const HIDDEN = /^(go\.|annot\.nudge|edit\.deselect|edit\.find(Next|Prev))/;

const fold = (s: string) => s.normalize("NFKC").toLowerCase().replace(/\s+/g, "");

/** Katakana to hiragana, so ハンコ finds はんこ. */
const kana = (s: string) => s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));

const norm = (s: string) => kana(fold(s));

function matches(c: Command, q: string): boolean {
  if (norm(c.title).includes(q)) return true;
  return (c.words ?? []).some((w) => norm(w).includes(q));
}

/**
 * 何をしますか (docs/UX.md §9): type a word (ハンコ, 結合, 小さく) and the
 * matching operations are listed by their names; picking one runs it.
 */
export function CommandSearch({ onPick }: { onPick?: (id: string) => void }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const s = useStore();
  const field = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLDivElement>(null);

  const q = norm(query);
  const found = useMemo(() => {
    if (!q) return [];
    const all = COMMANDS.filter((c) => !HIDDEN.test(c.id) && matches(c, q));
    // Usable ones first, then by how early the word matches the name.
    return all
      .map((c) => ({ c, on: isEnabled(c, s), at: norm(c.title).indexOf(q) }))
      .sort((a, b) => Number(b.on) - Number(a.on) || (a.at < 0 ? 99 : a.at) - (b.at < 0 ? 99 : b.at))
      .slice(0, 8);
    // `s` is the whole store; enabled states are what matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, s.docs, s.active, s.tool, s.panel, s.organizer]);

  useEffect(() => setCursor(0), [q]);

  useEffect(() => {
    if (!open) return;
    const away = (e: Event) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", away, true);
    return () => window.removeEventListener("pointerdown", away, true);
  }, [open]);

  const run = (c: Command) => {
    setOpen(false);
    setQuery("");
    field.current?.blur();
    onPick?.(c.id);
    runCommand(c.id);
  };

  const showing = open && q.length > 0;
  return (
    <div ref={box} className="relative shrink-0">
      <div className="flex h-7 items-center gap-1.5 rounded-md border border-line bg-bg px-2 focus-within:border-accent">
        <Search size={14} className="shrink-0 text-dim" />
        <input
          ref={field}
          value={query}
          placeholder="何をしますか"
          aria-label="何をしますか（操作を言葉で探す）"
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing || e.keyCode === 229) return;
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setCursor((i) => Math.min(found.length - 1, i + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setCursor((i) => Math.max(0, i - 1));
            } else if (e.key === "Enter") {
              e.preventDefault();
              const f = found[cursor];
              if (f?.on) run(f.c);
            } else if (e.key === "Escape") {
              e.preventDefault();
              setQuery("");
              setOpen(false);
              field.current?.blur();
            }
          }}
          className="w-36 bg-transparent text-sm outline-none placeholder:text-dim"
        />
      </div>
      {showing && (
        <div
          role="listbox"
          className="absolute top-full right-0 z-30 mt-1 w-80 animate-fade-in overflow-hidden rounded-lg border border-line bg-panel py-1 shadow-xl"
        >
          {found.length === 0 && <div className="px-3 py-2 text-sm text-dim">「{query}」に合う操作は見つかりませんでした</div>}
          {found.map(({ c, on }, i) => {
            const Icon = c.icon;
            return (
              <button
                key={c.id}
                role="option"
                aria-selected={i === cursor}
                disabled={!on}
                onMouseEnter={() => setCursor(i)}
                onClick={() => run(c)}
                className={`flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-sm disabled:opacity-45 ${
                  i === cursor && on ? "bg-accent text-white" : ""
                }`}
              >
                <span className="w-4 shrink-0">{Icon && <Icon size={15} />}</span>
                <span className="min-w-0 flex-1 truncate">
                  {plainTitle(c)}
                  {!on && <span className="ml-1 text-xs opacity-80">（いまは使えません）</span>}
                </span>
                {c.keys?.[0] && <span className="shrink-0 text-xs opacity-70">{comboText(c.keys[0])}</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

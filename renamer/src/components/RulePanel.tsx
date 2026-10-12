import { AlertCircle, CheckCircle2, Play } from "lucide-react";
import { command, isEnabled, labelOf, runCommand } from "../lib/commands";
import { DATE_FORMATS, RULE_KINDS, type Drafts, type Place, type ReplaceAction, type Sep } from "../lib/ruleDraft";
import { comboText } from "../lib/keys";
import { count } from "../lib/format";
import { useStore } from "../store";

// ------------------------------------------------------------ controls

function Label({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <div className="mb-1 flex items-baseline gap-2 text-xs text-dim">
      <span>{children}</span>
      {hint && <span className="text-[11px] opacity-70">{hint}</span>}
    </div>
  );
}

const inputClass =
  "h-7 w-full rounded-md border border-line bg-bg px-2 outline-none placeholder:text-dim/60 focus:border-accent";

function Text({
  value,
  onChange,
  placeholder,
  mono,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
}) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      spellCheck={false}
      className={`${inputClass} ${mono ? "font-mono text-[12px]" : ""}`}
    />
  );
}

function Num({ value, onChange, min = 0 }: { value: number; onChange: (v: number) => void; min?: number }) {
  return (
    <input
      type="number"
      value={value}
      min={min}
      onChange={(e) => {
        const n = Math.floor(Number(e.target.value));
        if (Number.isFinite(n)) onChange(Math.max(min, n));
      }}
      className={`${inputClass} tabular-nums`}
    />
  );
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex rounded-md bg-bg p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={`flex-1 rounded px-2 py-1 text-xs ${value === o.value ? "bg-raised text-fg shadow" : "text-dim hover:text-fg"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Check({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: React.ReactNode }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 py-0.5">
      <input type="checkbox" className="accent-accent" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{children}</span>
    </label>
  );
}

function Select<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value as T)} className={inputClass}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

const SEPS: { value: Sep; label: string }[] = [
  { value: "_", label: "_（アンダーバー）" },
  { value: "-", label: "-（ハイフン）" },
  { value: " ", label: "スペース" },
  { value: "", label: "なし" },
];

function Stack({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col gap-3">{children}</div>;
}

// ------------------------------------------------------------ forms

function ReplaceForm() {
  const d = useStore((s) => s.drafts.replace);
  const detail = useStore((s) => s.mode === "detail");
  const set = (p: Partial<Drafts["replace"]>) => useStore.getState().setDraft("replace", p);
  const actions: { value: ReplaceAction; label: string }[] = [
    { value: "replace", label: "文字を置き換える" },
    { value: "prefix", label: "先頭に追加" },
    { value: "suffix", label: "末尾に追加" },
    { value: "remove", label: "文字を削除" },
    { value: "trim", label: "先頭・末尾から削除" },
  ];
  const finding = d.action === "replace" || d.action === "remove";
  return (
    <Stack>
      <div>
        <Label>すること</Label>
        <Select value={d.action} options={actions} onChange={(action) => set({ action })} />
      </div>
      {finding && (
        <>
          <div>
            <Label hint={detail && d.regex ? "正規表現（Rust の書き方）" : undefined}>
              {d.action === "remove" ? "削除する文字" : "検索する文字"}
            </Label>
            <Text value={d.find} onChange={(find) => set({ find })} mono={detail && d.regex} placeholder="例：IMG_" />
          </div>
          {d.action === "replace" && (
            <div>
              <Label hint={detail && d.regex ? "$1 でグループを参照" : undefined}>置き換え後</Label>
              <Text value={d.with} onChange={(w) => set({ with: w })} mono={detail && d.regex} placeholder="空なら削除" />
            </div>
          )}
          <div>
            {detail && (
              <Check checked={d.regex} onChange={(regex) => set({ regex })}>
                正規表現
              </Check>
            )}
            <Check checked={d.caseSensitive} onChange={(caseSensitive) => set({ caseSensitive })}>
              大文字と小文字を区別する
            </Check>
            <Check checked={d.firstOnly} onChange={(firstOnly) => set({ firstOnly })}>
              最初の 1 つだけ
            </Check>
          </div>
        </>
      )}
      {(d.action === "prefix" || d.action === "suffix") && (
        <div>
          <Label>追加する文字</Label>
          <Text value={d.text} onChange={(text) => set({ text })} placeholder={d.action === "prefix" ? "例：済_" : "例：_確認済"} />
        </div>
      )}
      {d.action === "trim" && (
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label>先頭から（文字）</Label>
            <Num value={d.trimStart} onChange={(trimStart) => set({ trimStart })} />
          </div>
          <div>
            <Label>末尾から（文字）</Label>
            <Num value={d.trimEnd} onChange={(trimEnd) => set({ trimEnd })} />
          </div>
        </div>
      )}
    </Stack>
  );
}

const PLACES: { value: Place; label: string }[] = [
  { value: "start", label: "先頭" },
  { value: "end", label: "末尾" },
  { value: "only", label: "置き換え" },
];

function NumberForm() {
  const d = useStore((s) => s.drafts.number);
  const detail = useStore((s) => s.mode === "detail");
  const set = (p: Partial<Drafts["number"]>) => useStore.getState().setDraft("number", p);
  if (detail)
    return (
      <Stack>
        <div>
          <Label>テンプレート</Label>
          <Text value={d.template} onChange={(template) => set({ template })} mono placeholder="{name}_{n:3}" />
          <p className="mt-1.5 text-[11px] leading-relaxed text-dim">
            {"{name} 元の名前　{n} 番号　{n:3} 3 桁"}
            <br />
            {"{parent} フォルダ名　{mdate:yyyyMMdd} 更新日　{cdate:…} 作成日"}
            <br />
            {"{ と } そのものは {{ }} と書きます"}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label>開始番号</Label>
            <Num value={d.start} onChange={(start) => set({ start })} min={-999999} />
          </div>
          <div>
            <Label>増やす数</Label>
            <Num value={d.step} onChange={(step) => set({ step })} min={-1000} />
          </div>
        </div>
        <NumberOrderNote />
      </Stack>
    );
  return (
    <Stack>
      <div>
        <Label>番号を付ける位置</Label>
        <Segmented value={d.place} options={PLACES.map((p) => (p.value === "only" ? { ...p, label: "番号だけ" } : p))} onChange={(place) => set({ place })} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label>開始番号</Label>
          <Num value={d.start} onChange={(start) => set({ start })} />
        </div>
        <div>
          <Label>桁数</Label>
          <Select
            value={String(d.digits)}
            options={[0, 2, 3, 4, 5].map((n) => ({ value: String(n), label: n ? `${n} 桁（${"0".repeat(n - 1)}1）` : "そろえない" }))}
            onChange={(v) => set({ digits: Number(v) })}
          />
        </div>
      </div>
      {d.place !== "only" && (
        <div>
          <Label>区切り</Label>
          <Select value={d.sep} options={SEPS} onChange={(sep) => set({ sep })} />
        </div>
      )}
      <NumberOrderNote />
    </Stack>
  );
}

function NumberOrderNote() {
  return <p className="text-[11px] leading-relaxed text-dim">番号は一覧の並び順に振ります。対象から外した行は数えません。</p>;
}

function DateForm() {
  const d = useStore((s) => s.drafts.date);
  const detail = useStore((s) => s.mode === "detail");
  const set = (p: Partial<Drafts["date"]>) => useStore.getState().setDraft("date", p);
  return (
    <Stack>
      <div>
        <Label>使う日時</Label>
        <Segmented
          value={d.source}
          options={[
            { value: "modified", label: "更新日時" },
            { value: "created", label: "作成日時" },
          ]}
          onChange={(source) => set({ source })}
        />
        {d.source === "created" && (
          <p className="mt-1.5 text-[11px] leading-relaxed text-warn">
            作成日時は、コピーしたときや NAS では「コピーした日時」になることがあります。
          </p>
        )}
      </div>
      <div>
        <Label>付ける位置</Label>
        <Segmented value={d.place} options={PLACES.map((p) => (p.value === "only" ? { ...p, label: "日付だけ" } : p))} onChange={(place) => set({ place })} />
      </div>
      <div>
        <Label hint={detail ? "yyyy yy MM dd HH mm ss" : undefined}>書式</Label>
        {detail ? (
          <Text value={d.format} onChange={(format) => set({ format })} mono />
        ) : (
          <Select value={d.format} options={DATE_FORMATS.map((f) => ({ value: f, label: f }))} onChange={(format) => set({ format })} />
        )}
      </div>
      {d.place !== "only" && (
        <div>
          <Label>区切り</Label>
          <Select value={d.sep} options={SEPS} onChange={(sep) => set({ sep })} />
        </div>
      )}
    </Stack>
  );
}

function NormalizeForm() {
  const d = useStore((s) => s.drafts.normalize);
  const set = (p: Partial<Drafts["normalize"]>) => useStore.getState().setDraft("normalize", p);
  return (
    <Stack>
      <div>
        <Check checked={d.width} onChange={(width) => set({ width })}>
          全角の英数字・記号を半角に
        </Check>
        <Check checked={d.kana} onChange={(kana) => set({ kana })}>
          半角カナを全角に
        </Check>
        <Check checked={d.spaces} onChange={(spaces) => set({ spaces })}>
          空白をそろえる（全角→半角、連続を 1 つ、前後を削除）
        </Check>
        <Check checked={d.nfc} onChange={(nfc) => set({ nfc })}>
          日本語の表記をそろえる（NFC）
        </Check>
      </div>
      <div>
        <Label>英字</Label>
        <Select
          value={d.case}
          options={[
            { value: "keep", label: "そのまま" },
            { value: "lower", label: "小文字に" },
            { value: "upper", label: "大文字に" },
            { value: "capitalize", label: "先頭だけ大文字に" },
          ]}
          onChange={(c) => set({ case: c })}
        />
      </div>
      <div>
        <Label>空白を置き換える</Label>
        <Select
          value={d.spaceTo as "" | "_" | "-"}
          options={[
            { value: "", label: "そのまま" },
            { value: "_", label: "_ に" },
            { value: "-", label: "- に" },
          ]}
          onChange={(spaceTo) => set({ spaceTo })}
        />
      </div>
      <div>
        <Label>Windows で使えない文字（\ / : * ? " &lt; &gt; |）</Label>
        <Select
          value={d.forbidden}
          options={[
            { value: "keep", label: "そのまま（問題として表示）" },
            { value: "fullwidth", label: "全角に（： ／ など）" },
            { value: "underscore", label: "_ に" },
          ]}
          onChange={(forbidden) => set({ forbidden })}
        />
      </div>
      <p className="text-[11px] leading-relaxed text-dim">
        NFC：Mac で付けた「ガ」「パ」などが、Windows で別の文字に見えるのを防ぎます。
      </p>
    </Stack>
  );
}

const FORMS = { replace: ReplaceForm, number: NumberForm, date: DateForm, normalize: NormalizeForm };

// ------------------------------------------------------------ panel

/** Just renamed: the rule rests, so the list shows the names as they are now. */
function Paused() {
  const paused = useStore((s) => s.paused);
  if (!paused) return null;
  return (
    <div className="mb-3 flex gap-2 rounded-md border border-success/40 bg-success/10 p-2 text-xs">
      <CheckCircle2 size={14} className="mt-px shrink-0 text-success" />
      <div className="flex-1">
        <p>変更しました。一覧は今の名前です。ルールを変えると、次の変更をプレビューします。</p>
        <button onClick={() => useStore.getState().setPaused(false)} className="mt-1.5 text-accent hover:underline">
          同じルールをもう一度プレビュー
        </button>
      </div>
    </div>
  );
}

/** ⌘Enter, with the count, greyed out while a row has a problem. */
function RunButton() {
  const c = command("run.execute");
  const enabled = useStore((s) => isEnabled(c, s));
  const label = useStore((s) => labelOf(c, s));
  const errors = useStore((s) => s.listing.summary.errors);
  return (
    <div>
      <button
        onClick={() => runCommand(c.id)}
        disabled={!enabled}
        className="flex h-9 w-full items-center justify-center gap-2 rounded-md bg-accent font-medium text-white hover:brightness-110 disabled:bg-raised disabled:text-dim"
        title={comboText(c.keys![0])}
      >
        <Play size={15} />
        {label.replace(/…$/, "")}
      </button>
      {errors > 0 && (
        <p className="mt-1.5 text-center text-[11px] text-danger">問題のある行が {count(errors)} 件あります。解消すると実行できます</p>
      )}
    </div>
  );
}

/** The left side: one rule at a time (docs/SPEC.md §5). */
export function RulePanel() {
  const mode = useStore((s) => s.mode);
  const kind = useStore((s) => s.ruleKind);
  const includeExt = useStore((s) => s.includeExt);
  const ruleError = useStore((s) => s.ruleError);
  const { setMode, setRuleKind, setIncludeExt } = useStore.getState();
  const Form = FORMS[kind];
  return (
    <aside className="flex w-80 shrink-0 flex-col border-r border-line bg-panel">
      <div className="flex flex-col gap-3 border-b border-line p-3">
        <Segmented
          value={mode}
          options={[
            { value: "simple", label: "簡単" },
            { value: "detail", label: "詳細" },
          ]}
          onChange={setMode}
        />
        <div className="grid grid-cols-4 gap-1">
          {RULE_KINDS.map((r, i) => (
            <button
              key={r.kind}
              onClick={() => setRuleKind(r.kind)}
              title={`${r.label}（${comboText(`Mod+${i + 1}`)}）`}
              className={`rounded-md py-1.5 text-[13px] ${
                kind === r.kind ? "bg-accent text-white" : "bg-raised text-dim hover:text-fg"
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <Paused />
        <Form />
        {ruleError && (
          <div className="mt-3 flex gap-2 rounded-md border border-danger/40 bg-danger/10 p-2 text-xs text-danger" role="alert">
            <AlertCircle size={14} className="mt-px shrink-0" />
            <span className="break-words">{ruleError}</span>
          </div>
        )}
      </div>
      <div className="flex flex-col gap-3 border-t border-line p-3">
        <Check checked={includeExt} onChange={setIncludeExt}>
          拡張子も対象にする
        </Check>
        <RunButton />
      </div>
    </aside>
  );
}

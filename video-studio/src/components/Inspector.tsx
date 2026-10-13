import { AlignCenter, Bold, Copy, Scissors, Trash2, Volume2, VolumeX } from "lucide-react";
import { useMemo, useRef } from "react";
import { changeClip, changeOverlay, deleteSelection, duplicateSelection, setTransition, splitAtPlayhead } from "../lib/actions";
import { ANIMS } from "../lib/anim";
import { seconds, timecode } from "../lib/format";
import { FONTS } from "../lib/overlayRender";
import { TEXT_COLORS } from "../lib/presets";
import { ASPECTS, aspectOf, type AnimKind, type Clip, type FontId, type Overlay, type TextStyle } from "../lib/project";
import { EMOJI, SHAPES, STAMP_COLORS, shapeOf } from "../lib/stamps";
import { layout, updateClip, updateOverlay } from "../lib/timeline";
import { TRANSITIONS } from "../lib/transitions";
import { useStore } from "../store";
import { ShapeIcon } from "./icons";

const st = () => useStore.getState();

const label = "mb-1 block text-[11px] text-dim";
const section = "mb-4";
const field = "w-full rounded-md border border-line bg-bg px-2 py-1 text-xs outline-none focus:border-accent";

/**
 * A slider that changes the project live while dragged and becomes one
 * undo step when let go.
 */
function Slider({ value, min, max, step, onLive, format }: {
  value: number;
  min: number;
  max: number;
  step: number;
  onLive: (base: ReturnType<typeof st>["project"], v: number) => ReturnType<typeof st>["project"];
  format: (v: number) => string;
}) {
  const base = useRef<ReturnType<typeof st>["project"] | null>(null);
  const begin = () => {
    if (!base.current) {
      base.current = st().project;
      st().beginLive();
    }
  };
  const end = () => {
    if (base.current) st().endLive();
    base.current = null;
  };
  return (
    <div className="flex items-center gap-2">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onPointerDown={begin}
        onPointerUp={end}
        onKeyDown={begin}
        onKeyUp={end}
        onBlur={end}
        onChange={(e) => {
          begin();
          st().live(onLive(base.current!, Number(e.target.value)));
        }}
        className="min-w-0 flex-1"
      />
      <span className="w-12 shrink-0 text-right text-[11px] text-dim tabular-nums">{format(value)}</span>
    </div>
  );
}

function Swatches({ colors, value, onPick, allowNone }: { colors: string[]; value: string | null; onPick: (c: string | null) => void; allowNone?: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {allowNone && (
        <button
          onClick={() => onPick(null)}
          className={`checker h-5 w-5 rounded-full border ${value === null ? "border-fg ring-2 ring-accent" : "border-line"}`}
          title="なし"
          aria-label="なし"
        />
      )}
      {colors.map((c) => (
        <button
          key={c}
          onClick={() => onPick(c)}
          className={`h-5 w-5 rounded-full border ${value === c ? "border-fg ring-2 ring-accent" : "border-line"}`}
          style={{ background: c }}
          aria-label={c}
        />
      ))}
      <input
        type="color"
        value={value && /^#[0-9a-f]{6}$/i.test(value) ? value : "#ffffff"}
        onChange={(e) => onPick(e.target.value)}
        className="h-5 w-6 cursor-pointer rounded border border-line bg-transparent"
        title="ほかの色"
      />
    </div>
  );
}

function Seg<T extends string>({ value, options, onPick }: { value: T; options: { id: T; label: string }[]; onPick: (v: T) => void }) {
  return (
    <div className="flex rounded-md bg-bg p-0.5">
      {options.map((o) => (
        <button
          key={o.id}
          onClick={() => onPick(o.id)}
          className={`flex-1 rounded px-1.5 py-1 text-[11px] ${value === o.id ? "bg-raised text-fg" : "text-dim hover:text-fg"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Actions({ split }: { split?: boolean }) {
  const btn = "flex flex-1 items-center justify-center gap-1 rounded-md border border-line py-1.5 text-[11px] text-dim hover:text-fg";
  return (
    <div className="flex gap-1.5">
      {split && (
        <button className={btn} onClick={splitAtPlayhead}>
          <Scissors size={12} />
          分割
        </button>
      )}
      <button className={btn} onClick={duplicateSelection}>
        <Copy size={12} />
        複製
      </button>
      <button className={`${btn} hover:!text-danger`} onClick={deleteSelection}>
        <Trash2 size={12} />
        削除
      </button>
    </div>
  );
}

// ---------------------------------------------------------------- clip

function ClipInspector({ c }: { c: Clip }) {
  const m = useStore((s) => s.project.media.find((x) => x.id === c.mediaId));
  if (!m) return null;
  return (
    <>
      <div className={section}>
        <div className="truncate text-sm font-medium" title={m.path}>
          {m.name}
        </div>
        <div className="mt-0.5 text-[11px] text-dim">
          {m.kind === "image" ? "写真" : `動画 ${m.width}×${m.height}・${timecode(m.duration)}`}
        </div>
      </div>
      <div className={section}>
        <span className={label}>長さ</span>
        {m.kind === "image" ? (
          <Slider
            value={c.end - c.start}
            min={0.5}
            max={20}
            step={0.1}
            format={seconds}
            onLive={(base, v) => updateClip(base, c.id, { start: 0, end: v })}
          />
        ) : (
          <div className="text-xs">
            {seconds(c.end - c.start)}
            <span className="ml-2 text-[11px] text-dim">
              {timecode(c.start)} 〜 {timecode(c.end)}
            </span>
            <div className="mt-1 text-[11px] text-dim">タイムラインでクリップの端をドラッグすると切り詰められます。</div>
          </div>
        )}
      </div>
      {m.kind === "video" && m.hasAudio && (
        <div className={section}>
          <span className={label}>音量</span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => changeClip(c.id, { volume: c.volume > 0 ? 0 : 1 })}
              className="rounded p-1 text-dim hover:bg-white/10 hover:text-fg"
              title={c.volume > 0 ? "消音" : "音を戻す"}
            >
              {c.volume > 0 ? <Volume2 size={14} /> : <VolumeX size={14} />}
            </button>
            <div className="flex-1">
              <Slider
                value={c.volume}
                min={0}
                max={1}
                step={0.05}
                format={(v) => `${Math.round(v * 100)}%`}
                onLive={(base, v) => updateClip(base, c.id, { volume: v })}
              />
            </div>
          </div>
        </div>
      )}
      <div className={section}>
        <span className={label}>形が違うとき</span>
        <Seg
          value={c.fit}
          options={[
            { id: "contain", label: "全体を見せる" },
            { id: "cover", label: "画面を埋める" },
          ]}
          onPick={(fit) => changeClip(c.id, { fit })}
        />
      </div>
      <Actions split />
    </>
  );
}

// ---------------------------------------------------------------- transition

function TransitionInspector({ c }: { c: Clip }) {
  const project = useStore((s) => s.project);
  const it = useMemo(() => layout(project).items.find((x) => x.clip.id === c.id), [project, c.id]);
  const prev = project.clips[project.clips.findIndex((x) => x.id === c.id) - 1];
  if (!it || !prev) return null;
  // The longest it can be between these two clips (timeline.ts layout).
  const room = Math.max(0.1, Math.min(prev.end - prev.start, c.end - c.start) - 1 / st().project.fps);
  return (
    <>
      <div className={section}>
        <div className="text-sm font-medium">つなぎ目</div>
        <div className="mt-0.5 text-[11px] text-dim">{timecode(it.start)} のところ</div>
      </div>
      <div className={section}>
        <span className={label}>切り替え</span>
        <select
          className={field}
          value={c.transition?.kind ?? ""}
          onChange={(e) => setTransition(c.id, (e.target.value || null) as never)}
        >
          <option value="">なし（そのままつなぐ）</option>
          {TRANSITIONS.map((t) => (
            <option key={t.kind} value={t.kind}>
              {t.label}
            </option>
          ))}
        </select>
      </div>
      {c.transition && (
        <div className={section}>
          <span className={label}>長さ</span>
          <Slider
            value={Math.min(c.transition.duration, room)}
            min={0.1}
            max={Math.min(3, room)}
            step={0.05}
            format={seconds}
            onLive={(base, v) => updateClip(base, c.id, { transition: { ...c.transition!, duration: v } })}
          />
          {it.transition + 1e-6 < c.transition.duration && (
            <div className="mt-1 text-[11px] text-warn">クリップが短いため {seconds(it.transition)} になります</div>
          )}
        </div>
      )}
      <p className="text-[11px] leading-relaxed text-dim">左の「切り替え」タブでも選べます。</p>
    </>
  );
}

// ---------------------------------------------------------------- overlay

function Timing({ o }: { o: Overlay }) {
  const duration = useStore((s) => layout(s.project).duration);
  const anim = (key: "animIn" | "animOut") => (
    <select className={field} value={o[key]} onChange={(e) => changeOverlay(o.id, { [key]: e.target.value as AnimKind })}>
      {ANIMS.map((a) => (
        <option key={a.kind} value={a.kind}>
          {a.label}
        </option>
      ))}
    </select>
  );
  return (
    <>
      <div className={section}>
        <span className={label}>
          出ている時間 {timecode(o.start)} 〜 {timecode(o.end)}
        </span>
        <Slider
          value={o.end - o.start}
          min={0.3}
          max={Math.max(10, Math.ceil(duration))}
          step={0.1}
          format={seconds}
          onLive={(base, v) => updateOverlay(base, o.id, { end: o.start + v })}
        />
      </div>
      <div className={`${section} grid grid-cols-2 gap-2`}>
        <label>
          <span className={label}>出るとき</span>
          {anim("animIn")}
        </label>
        <label>
          <span className={label}>消えるとき</span>
          {anim("animOut")}
        </label>
      </div>
    </>
  );
}

function Placement({ o }: { o: Overlay }) {
  return (
    <>
      <div className={section}>
        <span className={label}>位置</span>
        <div className="flex gap-1.5">
          {[
            { y: 0.15, label: "上" },
            { y: 0.5, label: "真ん中" },
            { y: 0.85, label: "下" },
          ].map((p) => (
            <button
              key={p.label}
              onClick={() => changeOverlay(o.id, { x: 0.5, y: p.y })}
              className="flex flex-1 items-center justify-center gap-1 rounded-md border border-line py-1 text-[11px] text-dim hover:text-fg"
            >
              <AlignCenter size={11} />
              {p.label}
            </button>
          ))}
        </div>
        <div className="mt-1 text-[11px] text-dim">プレビューの上でドラッグしても動かせます。</div>
      </div>
      <div className={section}>
        <span className={label}>大きさ</span>
        <Slider value={o.scale} min={0.2} max={4} step={0.05} format={(v) => `${Math.round(v * 100)}%`} onLive={(b, v) => updateOverlay(b, o.id, { scale: v })} />
      </div>
      <div className={section}>
        <span className={label}>回転</span>
        <Slider value={o.rotation} min={-180} max={180} step={1} format={(v) => `${v}°`} onLive={(b, v) => updateOverlay(b, o.id, { rotation: v })} />
      </div>
    </>
  );
}

function TextInspector({ o }: { o: Overlay }) {
  const style = (change: Partial<TextStyle>) => changeOverlay(o.id, { style: { ...o.style, ...change } });
  const typing = useRef<string | null>(null);
  return (
    <>
      <div className={section}>
        <span className={label}>文字</span>
        <textarea
          data-overlay-text
          rows={3}
          value={o.text}
          // Typing changes the preview at once; one undo step per visit to the box.
          onFocus={() => {
            typing.current = o.id;
            st().beginLive();
          }}
          onBlur={() => {
            if (typing.current) st().endLive();
            typing.current = null;
          }}
          onChange={(e) => {
            const s = st();
            if (s.liveBase) s.live(updateOverlay(s.project, o.id, { text: e.target.value }));
            else s.commit(updateOverlay(s.project, o.id, { text: e.target.value }));
          }}
          className={`${field} resize-none text-sm`}
          placeholder="ここに入力（改行もできます）"
        />
      </div>
      <div className={`${section} flex gap-2`}>
        <select className={field} value={o.style.font} onChange={(e) => style({ font: e.target.value as FontId })}>
          {FONTS.map((f) => (
            <option key={f.id} value={f.id}>
              {f.label}
            </option>
          ))}
        </select>
        <button
          onClick={() => style({ bold: !o.style.bold })}
          className={`rounded-md border px-2 ${o.style.bold ? "border-accent bg-accent/15 text-fg" : "border-line text-dim"}`}
          title="太字"
        >
          <Bold size={14} />
        </button>
      </div>
      <div className={section}>
        <span className={label}>文字の大きさ</span>
        <Slider value={o.style.size} min={24} max={300} step={2} format={(v) => `${v}`} onLive={(b, v) => updateOverlay(b, o.id, { style: { ...o.style, size: v } })} />
      </div>
      <div className={section}>
        <span className={label}>文字の色</span>
        <Swatches colors={TEXT_COLORS} value={o.style.color} onPick={(c) => c && style({ color: c })} />
      </div>
      <div className={section}>
        <span className={label}>ふち</span>
        <Swatches colors={["#000000", "#ffffff", "#ff6fa3", "#4c8dff"]} value={o.style.outline} onPick={(c) => style({ outline: c })} allowNone />
      </div>
      <div className={section}>
        <span className={label}>背景</span>
        <Swatches
          colors={["rgba(0,0,0,0.62)", "#ffffff", "#ffd23f", "#4c8dff", "#ff4d4d"]}
          value={o.style.box}
          onPick={(c) => style({ box: c })}
          allowNone
        />
      </div>
      <Placement o={o} />
      <Timing o={o} />
      <Actions />
    </>
  );
}

function StampInspector({ o }: { o: Overlay }) {
  const shape = shapeOf(o.stamp);
  return (
    <>
      <div className={section}>
        <span className={label}>スタンプ</span>
        <div className="grid grid-cols-6 gap-1">
          {SHAPES.map((s) => (
            <button
              key={s.id}
              onClick={() => changeOverlay(o.id, { stamp: `shape:${s.id}` })}
              className={`flex aspect-square items-center justify-center rounded ${o.stamp === `shape:${s.id}` ? "bg-accent/25" : "hover:bg-white/10"}`}
              title={s.label}
            >
              <ShapeIcon shape={s} color={o.color} size={22} />
            </button>
          ))}
          {EMOJI.slice(0, 22).map((e) => (
            <button
              key={e}
              onClick={() => changeOverlay(o.id, { stamp: e })}
              className={`flex aspect-square items-center justify-center rounded text-lg ${o.stamp === e ? "bg-accent/25" : "hover:bg-white/10"}`}
            >
              {e}
            </button>
          ))}
        </div>
      </div>
      {shape && (
        <div className={section}>
          <span className={label}>色</span>
          <Swatches colors={STAMP_COLORS} value={o.color} onPick={(c) => c && changeOverlay(o.id, { color: c })} />
        </div>
      )}
      <Placement o={o} />
      <Timing o={o} />
      <Actions />
    </>
  );
}

// ---------------------------------------------------------------- nothing picked

function ProjectInfo() {
  const p = useStore((s) => s.project);
  const duration = useStore((s) => layout(s.project).duration);
  return (
    <>
      <div className={section}>
        <div className="text-sm font-medium">プロジェクト</div>
        <div className="mt-1 text-[11px] leading-relaxed text-dim">
          {ASPECTS[aspectOf(p)].label}（{p.width}×{p.height}）・{p.fps} fps
          <br />
          長さ {timecode(duration)}・クリップ {p.clips.length}・文字とスタンプ {p.overlays.length}
        </div>
      </div>
      <div className="text-[11px] leading-relaxed text-dim">
        <p className="mb-2 font-medium text-fg">使い方</p>
        <ol className="list-decimal space-y-1.5 pl-4">
          <li>動画や写真を追加すると、タイムラインに順に並びます</li>
          <li>
            再生位置で <b className="text-fg">S</b> を押すと分割。いらない部分を選んで <b className="text-fg">Delete</b>
          </li>
          <li>クリップの端をドラッグして切り詰め、ドラッグで並べ替え</li>
          <li>つなぎ目の ◇ を押して切り替えを選ぶ</li>
          <li>「テキスト」「スタンプ」から再生位置に重ねる</li>
          <li>右上の「書き出す」で MP4 に</li>
        </ol>
      </div>
    </>
  );
}

export function Inspector() {
  const sel = useStore((s) => s.selection);
  const clip = useStore((s) => (sel && sel.kind !== "overlay" ? s.project.clips.find((c) => c.id === sel.id) : undefined));
  const overlay = useStore((s) => (sel?.kind === "overlay" ? s.project.overlays.find((o) => o.id === sel.id) : undefined));
  return (
    <div className="w-72 shrink-0 overflow-y-auto border-l border-line bg-panel p-4">
      {sel?.kind === "clip" && clip ? (
        <ClipInspector c={clip} />
      ) : sel?.kind === "transition" && clip ? (
        <TransitionInspector c={clip} />
      ) : overlay?.kind === "text" ? (
        <TextInspector key={overlay.id} o={overlay} />
      ) : overlay ? (
        <StampInspector o={overlay} />
      ) : (
        <ProjectInfo />
      )}
    </div>
  );
}

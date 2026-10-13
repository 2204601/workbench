import { AlertTriangle, Clapperboard, Film, Image as ImageIcon, Loader2, Plus, Shapes, Sparkles, Trash2, Type, Upload } from "lucide-react";
import { useState } from "react";
import {
  addMediaToTimeline,
  addStamp,
  addText,
  importDialog,
  removeMedia,
  setTransition,
  setTransitionEverywhere,
  transitionTarget,
} from "../lib/actions";
import { fileUrl } from "../lib/api";
import { openSource } from "../lib/sourcePlayer";
import { timecode } from "../lib/format";
import { FONTS } from "../lib/overlayRender";
import { TEXT_PRESETS } from "../lib/presets";
import type { Media } from "../lib/project";
import { EMOJI, SHAPES, STAMP_COLORS } from "../lib/stamps";
import { TRANSITIONS } from "../lib/transitions";
import { useStore, type LeftTab } from "../store";
import { ShapeIcon, TransitionIcon } from "./icons";

const TABS: { id: LeftTab; label: string; icon: typeof Film }[] = [
  { id: "media", label: "素材", icon: Film },
  { id: "text", label: "テキスト", icon: Type },
  { id: "stamp", label: "スタンプ", icon: Shapes },
  { id: "transition", label: "切り替え", icon: Sparkles },
];

export function LeftPanel() {
  const tab = useStore((s) => s.leftTab);
  const setTab = useStore((s) => s.setLeftTab);
  return (
    <div className="flex w-72 shrink-0 border-r border-line bg-panel">
      <div className="flex w-16 shrink-0 flex-col gap-1 border-r border-line p-1.5" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`flex flex-col items-center gap-1 rounded-lg py-2 text-[10px] ${tab === t.id ? "bg-raised text-fg" : "text-dim hover:bg-white/5 hover:text-fg"}`}
          >
            <t.icon size={18} />
            {t.label}
          </button>
        ))}
      </div>
      <div className="min-w-0 flex-1 overflow-y-auto p-3">
        {tab === "media" && <MediaTab />}
        {tab === "text" && <TextTab />}
        {tab === "stamp" && <StampTab />}
        {tab === "transition" && <TransitionTab />}
      </div>
    </div>
  );
}

const heading = "mb-2 text-xs font-semibold text-dim";

// ---------------------------------------------------------------- media

/** The pointer moved the media file (a drag): the click that follows opens nothing. */
let justDragged = false;

/** Starts dragging a media file toward the timeline (pointer events: Platform UI §6). */
function startMediaDrag(e: React.PointerEvent, m: Media) {
  if (e.button !== 0) return;
  const x0 = e.clientX;
  const y0 = e.clientY;
  let dragging = false;
  justDragged = false;
  const s = useStore.getState();
  const move = (ev: PointerEvent) => {
    if (!dragging && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 5) return;
    dragging = true;
    justDragged = true;
    s.setMediaDrag({ mediaId: m.id, x: ev.clientX, y: ev.clientY });
  };
  const up = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    // The timeline takes the drop on its own pointerup (Timeline.tsx); this clears after.
    setTimeout(() => useStore.getState().setMediaDrag(null), 0);
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
}

function MediaThumb({ m }: { m: Media }) {
  const info = useStore((s) => s.media[m.id]);
  const thumbs = info?.prepared?.thumbs;
  if (m.kind === "image") return <img src={fileUrl(m.path)} alt="" className="h-full w-full object-cover" draggable={false} />;
  if (thumbs) {
    // The second thumbnail when there is one: the first is often black.
    const i = Math.min(1, thumbs.count - 1);
    return (
      <div
        className="h-full w-full bg-cover"
        style={{
          backgroundImage: `url("${fileUrl(thumbs.path)}")`,
          backgroundSize: `${thumbs.count * 100}% 100%`,
          backgroundPosition: `${thumbs.count > 1 ? (i / (thumbs.count - 1)) * 100 : 0}% 0`,
        }}
      />
    );
  }
  return (
    <div className="flex h-full w-full items-center justify-center text-dim">
      <Clapperboard size={20} />
    </div>
  );
}

function MediaItem({ m }: { m: Media }) {
  const info = useStore((s) => s.media[m.id]);
  const uses = useStore((s) => s.project.clips.reduce((n, c) => n + (c.mediaId === m.id ? 1 : 0), 0));
  const open = useStore((s) => s.source?.mediaId === m.id);
  const video = m.kind === "video";
  // A video opens in the source view to pick parts of it; a picture goes on the timeline whole.
  const onClick = () => {
    if (justDragged) return;
    if (video) openSource(m.id);
  };
  return (
    <div
      className={`group relative cursor-pointer overflow-hidden rounded-lg border bg-bg ${open ? "border-accent ring-1 ring-accent" : "border-line"}`}
      onPointerDown={(e) => startMediaDrag(e, m)}
      onClick={onClick}
      onDoubleClick={() => !video && addMediaToTimeline(m)}
      title={
        video
          ? `${m.name}\n押すと素材の表示で開きます。使う部分を決めてタイムラインへ`
          : `${m.name}\nダブルクリックかドラッグでタイムラインへ`
      }
    >
      <div className="relative aspect-video bg-black">
        <MediaThumb m={m} />
        <span className="absolute right-1 bottom-1 rounded bg-black/70 px-1 text-[10px] tabular-nums">
          {m.kind === "image" ? <ImageIcon size={10} className="inline" /> : timecode(m.duration, false)}
        </span>
        {info?.status === "preparing" && (
          <span className="absolute inset-x-0 top-0 flex items-center gap-1 bg-black/60 px-1.5 py-0.5 text-[10px]">
            <Loader2 size={10} className="animate-spin" />
            準備中{info.ratio ? ` ${Math.floor(info.ratio * 100)}%` : ""}
          </span>
        )}
        {(info?.status === "missing" || info?.status === "error") && (
          <span className="absolute inset-x-0 top-0 flex items-center gap-1 bg-danger/80 px-1.5 py-0.5 text-[10px]" title={info.error}>
            <AlertTriangle size={10} />
            {info.status === "missing" ? "見つかりません" : "読めません"}
          </span>
        )}
      </div>
      <div className="flex items-center gap-1 px-1.5 py-1">
        <span className={`min-w-0 flex-1 truncate text-[11px] ${uses ? "" : "text-dim"}`}>{m.name}</span>
        {uses > 0 && (
          <span className="shrink-0 rounded bg-warn/20 px-1 text-[10px] text-warn" title="タイムラインで使っている数">
            {uses}
          </span>
        )}
        <button
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            addMediaToTimeline(m);
          }}
          className="rounded p-0.5 text-dim hover:bg-white/10 hover:text-fg"
          title={video ? "再生位置に入れる（範囲を決めてあればその範囲）" : "再生位置に入れる"}
        >
          <Plus size={13} />
        </button>
        <button
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            removeMedia(m);
          }}
          className="hidden rounded p-0.5 text-dim group-hover:block hover:bg-white/10 hover:text-danger"
          title="素材の一覧から外す"
        >
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  );
}

function MediaTab() {
  const media = useStore((s) => s.project.media);
  return (
    <div>
      <button
        onClick={() => void importDialog()}
        className="mb-3 flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-line py-4 text-dim hover:border-accent hover:text-fg"
      >
        <Upload size={16} />
        動画・写真を追加
      </button>
      {media.length === 0 ? (
        <p className="text-xs leading-relaxed text-dim">
          ファイルをウィンドウにドロップしても追加できます。動画は押すと開くので、使う部分を「ここから（I）」「ここまで（O）」で決めてタイムラインに入れます。1 本の動画から何か所でも使えます。
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {media.map((m) => (
            <MediaItem key={m.id} m={m} />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- text

function TextTab() {
  const hasClips = useStore((s) => s.project.clips.length > 0);
  return (
    <div>
      <div className={heading}>押すと再生位置に入ります</div>
      <div className="grid grid-cols-2 gap-2">
        {TEXT_PRESETS.map((p) => {
          const family = FONTS.find((f) => f.id === p.style.font)?.family;
          return (
            <button
              key={p.label}
              disabled={!hasClips}
              onClick={() => addText(p)}
              className="flex aspect-video flex-col items-center justify-center gap-1 rounded-lg border border-line bg-[#3a3f4a] px-1 hover:border-accent disabled:opacity-40"
            >
              <span
                className="max-w-full truncate rounded px-1.5 text-sm"
                style={{
                  fontFamily: family,
                  fontWeight: p.style.bold ? 700 : 400,
                  color: p.style.color,
                  background: p.style.box ?? undefined,
                  WebkitTextStroke: p.style.outline ? `0.6px ${p.style.outline}` : undefined,
                  paintOrder: "stroke",
                }}
              >
                {p.text}
              </span>
              <span className="text-[10px] text-dim">{p.label}</span>
            </button>
          );
        })}
      </div>
      {!hasClips && <p className="mt-3 text-xs text-dim">先に動画か写真を追加してください。</p>}
    </div>
  );
}

// ---------------------------------------------------------------- stamps

function StampTab() {
  const hasClips = useStore((s) => s.project.clips.length > 0);
  const [color, setColor] = useState(STAMP_COLORS[0]);
  return (
    <div>
      <div className={heading}>図形（色を選べます）</div>
      <div className="mb-2 flex gap-1.5">
        {STAMP_COLORS.map((c) => (
          <button
            key={c}
            onClick={() => setColor(c)}
            className={`h-5 w-5 rounded-full border ${c === color ? "border-fg ring-2 ring-accent" : "border-line"}`}
            style={{ background: c }}
            aria-label={c}
          />
        ))}
      </div>
      <div className="mb-4 grid grid-cols-4 gap-1.5">
        {SHAPES.map((s) => (
          <button
            key={s.id}
            disabled={!hasClips}
            onClick={() => addStamp(`shape:${s.id}`, color)}
            title={s.label}
            className="flex aspect-square items-center justify-center rounded-lg border border-line bg-bg hover:border-accent disabled:opacity-40"
          >
            <ShapeIcon shape={s} color={color} />
          </button>
        ))}
      </div>
      <div className={heading}>絵文字</div>
      <div className="grid grid-cols-5 gap-1">
        {EMOJI.map((e) => (
          <button
            key={e}
            disabled={!hasClips}
            onClick={() => addStamp(e, color)}
            className="flex aspect-square items-center justify-center rounded-lg text-2xl hover:bg-white/10 disabled:opacity-40"
          >
            {e}
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- transitions

function TransitionTab() {
  const target = useStore(() => transitionTarget());
  const current = useStore((s) => (target ? s.project.clips.find((c) => c.id === target)?.transition?.kind : undefined));
  const cuts = useStore((s) => Math.max(0, s.project.clips.length - 1));
  return (
    <div>
      <p className="mb-3 text-xs leading-relaxed text-dim">
        {target
          ? "選んだつなぎ目に入ります。"
          : "タイムラインでつなぎ目（クリップの境目の ◇）かクリップを選ぶと、そこに入れられます。"}
      </p>
      <div className="grid grid-cols-2 gap-2">
        {TRANSITIONS.map((t) => (
          <button
            key={t.kind}
            disabled={!target}
            onClick={() => target && setTransition(target, t.kind)}
            className={`flex flex-col items-center gap-1.5 rounded-lg border p-2 disabled:opacity-40 ${current === t.kind ? "border-accent bg-accent/10" : "border-line bg-bg hover:border-accent"}`}
          >
            <TransitionIcon kind={t.kind} />
            <span className="text-[11px]">{t.label}</span>
          </button>
        ))}
      </div>
      <div className="mt-4 flex flex-col gap-2">
        {target && current && (
          <button onClick={() => setTransition(target, null)} className="rounded-md border border-line py-1.5 text-xs text-dim hover:text-fg">
            このつなぎ目から外す
          </button>
        )}
        <button
          disabled={cuts === 0}
          onClick={() => setTransitionEverywhere(current ?? "fade")}
          className="rounded-md border border-line py-1.5 text-xs text-dim hover:text-fg disabled:opacity-40"
        >
          すべてのつなぎ目に「{TRANSITIONS.find((t) => t.kind === (current ?? "fade"))?.label}」
        </button>
      </div>
    </div>
  );
}

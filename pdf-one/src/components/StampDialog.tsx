import { open } from "@tauri-apps/plugin-dialog";
import { ClipboardPaste, ImagePlus, Plus, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { chooseImage, placePicture } from "../lib/actions";
import { api, type ImageInfo, type Stamp } from "../lib/api";
import { imageUrl } from "../lib/images";
import { isMac } from "../lib/keys";
import { useStore } from "../store";
import { Modal } from "./Modal";

const st = () => useStore.getState();

/** Library pictures already in Rust's image store this run. */
const loaded = new Map<string, ImageInfo>();

/**
 * 画像・印鑑: pictures to put on pages. The library keeps seals and
 * signatures for any document; a file or the clipboard works once.
 */
export function StampDialog() {
  const close = () => st().openDialog(null);
  const [stamps, setStamps] = useState<(Stamp & { img?: ImageInfo; url?: string })[] | null>(null);

  const load = useCallback(async () => {
    try {
      const list = await api.listStamps();
      const withImages = await Promise.all(
        list.map(async (s) => {
          try {
            const img = loaded.get(s.id) ?? (await api.useStamp(s.id));
            loaded.set(s.id, img);
            return { ...s, img, url: await imageUrl(img.id) };
          } catch {
            return s;
          }
        }),
      );
      setStamps(withImages);
    } catch (e) {
      st().toast(String(e), true);
      setStamps([]);
    }
  }, []);
  useEffect(() => void load(), [load]);

  const add = async () => {
    const picked = await open({
      multiple: true,
      title: "ライブラリに加える画像",
      filters: [{ name: "画像（PNG・JPEG）", extensions: ["png", "jpg", "jpeg", "PNG", "JPG", "JPEG"] }],
    }).catch(() => null);
    if (!picked) return;
    for (const p of Array.isArray(picked) ? picked : [picked]) {
      await api.addStamp(p).catch((e) => st().toast(String(e), true));
    }
    void load();
  };

  return (
    <Modal title="印鑑・画像" onClose={close} width={560}>
      <p className="mb-3 text-xs leading-relaxed text-dim">
        選んでからページをクリックすると置けます（ドラッグで大きさも）。印鑑や署名は、背景が透明な PNG にしておくと書類になじみます。
      </p>
      <div className="grid grid-cols-4 gap-2">
        {stamps?.map((s) => (
          <div key={s.id} className="group relative">
            <button
              disabled={!s.img}
              onClick={() => s.img && placePicture(s.img)}
              className="flex aspect-square w-full flex-col items-center justify-center gap-1 rounded-lg border border-line bg-[repeating-conic-gradient(var(--raised)_0_25%,var(--panel)_0_50%)] bg-[length:16px_16px] p-2 hover:border-accent"
              title={s.name}
            >
              {s.url ? <img src={s.url} alt="" className="max-h-full max-w-full object-contain" /> : <span className="text-xs text-danger">読めません</span>}
            </button>
            <div className="mt-1 truncate text-center text-xs text-dim">{s.name}</div>
            <button
              onClick={() => api.removeStamp(s.id).then(load, (e) => st().toast(String(e), true))}
              className="absolute top-1 right-1 hidden rounded bg-black/60 p-0.5 text-white group-hover:block hover:bg-danger"
              aria-label={`${s.name} を消す`}
              title="ライブラリから消す"
            >
              <X size={12} />
            </button>
          </div>
        ))}
        <button
          onClick={() => void add()}
          className="flex aspect-square w-full flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-line text-xs text-dim hover:border-accent hover:text-fg"
        >
          <Plus size={20} />
          ライブラリに追加
        </button>
      </div>
      {stamps?.length === 0 && <p className="mt-3 text-xs text-dim">ライブラリはまだ空です。よく使う印鑑や署名の画像を加えておけます。</p>}
      <div className="mt-4 flex items-center gap-2 border-t border-line pt-3">
        <button onClick={() => void chooseImage()} className="flex items-center gap-1.5 rounded-md bg-raised px-3 py-1.5 hover:bg-hover">
          <ImagePlus size={14} />
          画像ファイルを選ぶ…
        </button>
        <span className="flex items-center gap-1 text-xs text-dim">
          <ClipboardPaste size={12} />
          コピーした画像は {isMac ? "⌘V" : "Ctrl+V"} で貼り付けられます
        </span>
      </div>
    </Modal>
  );
}

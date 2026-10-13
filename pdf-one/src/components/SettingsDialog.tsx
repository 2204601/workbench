import { useEffect, useState } from "react";
import { api, type AppSettings } from "../lib/api";
import { appVersion } from "../lib/update";
import { useStore } from "../store";
import { Modal } from "./Modal";

const TEXT_SIZES: [number, string][] = [
  [1, "ふつう"],
  [1.15, "大きく"],
  [1.3, "もっと大きく"],
];

/** ⌘, (Platform UI §9): one dialog for all settings. */
export function SettingsDialog() {
  const close = useStore((s) => () => s.openDialog(null));
  const toast = useStore((s) => s.toast);
  const setAuthor = useStore((s) => s.setAuthor);
  const textSize = useStore((s) => s.textSize);
  const setTextSize = useStore((s) => s.setTextSize);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [osName, setOsName] = useState("");
  const [font, setFont] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    api.getAppSettings().then(setSettings, (e) => toast(`設定を読み込めませんでした: ${e}`, true));
    api.osUserName().then(setOsName, () => {});
    api.textFontFamily().then(setFont, () => setFont(null));
  }, [toast]);

  const change = (next: AppSettings) => {
    setSettings(next);
    setAuthor(next.author.trim() || osName);
    api.setAppSettings(next).catch((e) => toast(String(e), true));
  };

  return (
    <Modal title="設定" onClose={close}>
      <div className="flex flex-col gap-5">
        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1.5">画面の文字の大きさ</legend>
          <div className="flex gap-1 rounded-md border border-line p-1" role="radiogroup">
            {TEXT_SIZES.map(([n, label]) => (
              <button
                key={n}
                role="radio"
                aria-checked={textSize === n}
                onClick={() => setTextSize(n)}
                className={`h-8 flex-1 rounded ${textSize === n ? "bg-accent text-white" : "hover:bg-hover"}`}
              >
                {label}
              </button>
            ))}
          </div>
          <span className="text-xs text-dim">ボタンや一覧の文字が大きくなります。PDF の中身の大きさは、右下の「表示の大きさ」で変えます。</span>
        </fieldset>
        {settings && (
          <>
            <label className="flex flex-col gap-1.5">
              <span>書き込みに記録する名前</span>
              <input
                value={settings.author}
                placeholder={osName || "名前"}
                onChange={(e) => change({ ...settings, author: e.target.value })}
                className="h-8 rounded border border-line bg-bg px-2 outline-none focus:border-accent"
              />
              <span className="text-xs text-dim">付箋やマーカーに記録され、Acrobat などでも表示されます。空欄ならパソコンのユーザー名です。</span>
            </label>
            <label className="flex cursor-pointer items-start gap-3">
              <input
                type="checkbox"
                className="mt-0.5 accent-accent"
                checked={settings.autoUpdate}
                onChange={(e) => change({ ...settings, autoUpdate: e.target.checked })}
              />
              <span>
                <span className="block">アップデートを自動で確認する</span>
                <span className="mt-0.5 block text-xs text-dim">起動して数秒後に、新しいバージョンがあるかを確かめます。</span>
              </span>
            </label>
            <div className="text-xs text-dim">
              書き込む文字のフォント：
              {font === undefined ? "確認中…" : font ? `${font}（パソコンのフォントを PDF に埋め込みます）` : "日本語のフォントが見つかりません。日本語は保存できません"}
            </div>
          </>
        )}
      </div>
      <div className="mt-6 text-xs text-dim">PDF One {appVersion()}</div>
    </Modal>
  );
}

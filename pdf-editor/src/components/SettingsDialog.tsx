import { useEffect, useState } from "react";
import { api, type AppSettings } from "../lib/api";
import { appVersion } from "../lib/update";
import { useStore } from "../store";
import { Modal } from "./Modal";

/** ⌘, (Platform UI §9): one dialog for all settings. */
export function SettingsDialog() {
  const close = useStore((s) => () => s.openDialog(null));
  const toast = useStore((s) => s.toast);
  const setAuthor = useStore((s) => s.setAuthor);
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
      {settings && (
        <div className="flex flex-col gap-5">
          <label className="flex flex-col gap-1.5">
            <span>注釈の作成者名</span>
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
        </div>
      )}
      <div className="mt-6 text-xs text-dim">PDF Editor {appVersion()}</div>
    </Modal>
  );
}

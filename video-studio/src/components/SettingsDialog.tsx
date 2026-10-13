import { useCallback, useEffect, useState } from "react";
import { api, type AppSettings } from "../lib/api";
import { appVersion } from "../lib/update";
import { useStore } from "../store";
import { Modal } from "./Modal";

/** ⌘, (Platform UI §9): one dialog for all settings. */
export function SettingsDialog() {
  // The function itself, not one made in the selector: a new function on
  // every read makes zustand re-render without end.
  const openDialog = useStore((s) => s.openDialog);
  const close = useCallback(() => openDialog(null), [openDialog]);
  const toast = useStore((s) => s.toast);
  const [settings, setSettings] = useState<AppSettings | null>(null);

  useEffect(() => {
    api.getAppSettings().then(setSettings, (e) => toast(`設定を読み込めませんでした: ${e}`, true));
  }, [toast]);

  const change = (next: AppSettings) => {
    setSettings(next);
    api.setAppSettings(next).catch((e) => toast(String(e), true));
  };

  return (
    <Modal title="設定" onClose={close}>
      {settings && (
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
      )}
      <div className="mt-6 text-xs text-dim">Video Studio {appVersion()}</div>
    </Modal>
  );
}

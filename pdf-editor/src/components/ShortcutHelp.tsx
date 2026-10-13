import { COMMANDS } from "../lib/commands";
import { keyParts } from "../lib/keys";
import { useStore } from "../store";
import { Modal } from "./Modal";

/** ? : every command that has a key, from the command table. */
export function ShortcutHelp() {
  const close = useStore((s) => () => s.openDialog(null));
  const rows = COMMANDS.filter((c) => c.keys?.length);
  return (
    <Modal title="キーボードショートカット" onClose={close} width={420}>
      <table className="w-full">
        <tbody>
          {rows.map((c) => (
            <tr key={c.id} className="border-b border-line/60 last:border-0">
              <td className="py-2">{c.title.replace(/…$/, "")}</td>
              <td className="py-2 text-right">
                {c.keys!.map((k) => (
                  <span key={k} className="ml-2 inline-flex gap-1">
                    {keyParts(k).map((p, i) => (
                      <kbd key={i} className="min-w-6 rounded border border-line bg-raised px-1.5 py-0.5 text-center text-xs">
                        {p}
                      </kbd>
                    ))}
                  </span>
                ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Modal>
  );
}

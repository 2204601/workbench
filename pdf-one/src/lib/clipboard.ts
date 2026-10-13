/**
 * Copy and paste: an annotation (⌘C on a selected one, ⌘V onto the page in
 * view), or a picture from another app (⌘V puts it down with the image
 * tool). Text selected on a page copies as text, as the WebView does it.
 */
import { api, type Annot } from "./api";
import { addAnnot, moved } from "./edit";
import { activeDoc, findAnnot, newAnnotId, useStore } from "../store";
import { placePicture } from "./actions";

const st = () => useStore.getState();

/** The annotation copied last, and the text put on the clipboard with it. */
let copied: { annot: Annot; marker: string } | null = null;

function inField(): boolean {
  const el = document.activeElement as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
}

export function onCopy(e: ClipboardEvent) {
  if (inField() || window.getSelection()?.toString()) return;
  const d = activeDoc(st());
  const found = d && findAnnot(d, d.selectedAnnot);
  if (!found) return;
  const a = found.annot;
  const marker = a.kind === "text" ? a.text : a.contents || `[PDF One の注釈 ${a.id}]`;
  copied = { annot: a, marker };
  e.clipboardData?.setData("text/plain", marker);
  e.preventDefault();
  st().notify({ title: "注釈をコピーしました", duration: 1500 });
}

export function onPaste(e: ClipboardEvent) {
  if (inField()) return;
  const d = activeDoc(st());
  if (!d || d.readOnly) return;
  const data = e.clipboardData;
  if (!data) return;
  // A picture: copied from a browser, a screenshot, an image editor.
  const file = Array.from(data.files).find((f) => f.type === "image/png" || f.type === "image/jpeg");
  if (file) {
    e.preventDefault();
    void file
      .arrayBuffer()
      .then((b) => api.addImageBytes(new Uint8Array(b)))
      .then(placePicture, (err) => st().toast(String(err), true));
    return;
  }
  const text = data.getData("text/plain");
  if (copied && text === copied.marker) {
    e.preventDefault();
    const page = d.pages[d.page];
    if (!page) return;
    // A little down and right of the original, so both can be seen.
    const a = { ...copied.annot, ...moved(copied.annot, 10, -10), id: newAnnotId(), modified: "", author: st().author };
    copied = { annot: a, marker: copied.marker };
    st().commit((s) => addAnnot(s, page.uid, a));
    st().patchDoc({ selectedAnnot: a.id });
    st().setTool("select");
  }
}

/**
 * What pdf.js's annotation layer needs to make links work (its
 * IPDFLinkService): links inside the document go to the page, web links
 * open in the browser after asking.
 */
import { ask } from "@tauri-apps/plugin-dialog";
import { isTauri } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { warn } from "./log";
import { getSource } from "./pdfjs";
import { activeDoc, useStore } from "../store";

const st = () => useStore.getState();

/** Shows page `index` of document `source`, if the tab has it. */
export function goToSourcePage(source: number, index: number, y?: number) {
  const d = activeDoc(st());
  if (!d) return;
  const at = d.pages.findIndex((p) => p.source === source && p.index === index);
  if (at < 0) {
    st().toast("リンク先のページはこの PDF にありません");
    return;
  }
  st().patchDoc((x) => ({ scrollTo: { page: at, seq: (x.scrollTo?.seq ?? 0) + 1, y } }));
}

/** Goes to a destination (a name, or [page ref, fit…]) of `source`. */
export async function goToDestination(source: number, dest: unknown) {
  const s = getSource(source);
  if (!s) return;
  try {
    const explicit = typeof dest === "string" ? await s.pdf.getDestination(dest) : (dest as unknown[]);
    if (!Array.isArray(explicit) || !explicit.length) return;
    const ref = explicit[0];
    const index =
      typeof ref === "number" ? ref : typeof ref === "object" && ref ? await s.pdf.getPageIndex(ref as never) : -1;
    if (index < 0) return;
    // /XYZ left top zoom: the top, when given.
    const kind = (explicit[1] as { name?: string } | undefined)?.name;
    const top = kind === "XYZ" || kind === "FitH" || kind === "FitBH" ? (explicit[kind === "XYZ" ? 3 : 2] as number | null) : null;
    goToSourcePage(source, index, top ?? undefined);
  } catch (e) {
    warn("link destination", e);
  }
}

async function openExternal(url: string) {
  if (!/^(https?:|mailto:)/i.test(url)) {
    st().toast("このリンクは開けません", true);
    return;
  }
  if (!isTauri()) {
    window.open(url, "_blank", "noopener");
    return;
  }
  const ok = await ask(`このリンクをブラウザで開きますか？\n\n${url}`, { title: "リンク", okLabel: "開く", cancelLabel: "キャンセル" });
  if (ok) await openUrl(url).catch((e) => st().toast(`開けませんでした: ${e}`, true));
}

/** pdf.js's own type; ours has the parts the annotation layer uses. */
type LinkService = import("pdfjs-dist/types/web/pdf_link_service").PDFLinkService;

export function makeLinkService(source: number): LinkService {
  const page = () => activeDoc(st())?.page ?? 0;
  const go = (delta: number | "first" | "last") => {
    const d = activeDoc(st());
    if (!d) return;
    const to = delta === "first" ? 0 : delta === "last" ? d.pages.length - 1 : Math.max(0, Math.min(d.pages.length - 1, page() + delta));
    st().patchDoc((x) => ({ scrollTo: { page: to, seq: (x.scrollTo?.seq ?? 0) + 1 } }));
  };
  return {
    eventBus: null,
    isInPresentationMode: false,
    externalLinkEnabled: true,
    addLinkAttributes(link: HTMLAnchorElement, url: string) {
      link.href = url;
      link.title = url;
      link.onclick = (e) => {
        e.preventDefault();
        void openExternal(url);
        return false;
      };
    },
    getDestinationHash: () => "#",
    getAnchorUrl: () => "#",
    goToDestination: (dest: unknown) => goToDestination(source, dest),
    goToPage: (n: number) => goToSourcePage(source, n - 1),
    executeNamedAction(action: string) {
      if (action === "NextPage") go(1);
      else if (action === "PrevPage") go(-1);
      else if (action === "FirstPage") go("first");
      else if (action === "LastPage") go("last");
    },
    executeSetOCGState() {},
    getAttachmentContent: async () => null,
  } as unknown as LinkService;
}

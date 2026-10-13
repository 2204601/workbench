/**
 * Pictures, decoded once. Read as bytes through Rust (`read_image`), not
 * loaded from the asset URL, so a canvas they are drawn on can still be
 * turned into a PNG for the export. The EXIF rotation of phone photos is
 * applied here, the same for the preview and the export.
 */
import { isTauri } from "@tauri-apps/api/core";
import { api } from "./api";
import { warn } from "./log";
import type { Media } from "./project";

const decoded = new Map<string, ImageBitmap>();
const loading = new Map<string, Promise<ImageBitmap | null>>();

export const imageFor = (m: Media): ImageBitmap | null => decoded.get(m.path) ?? null;

async function load(m: Media): Promise<ImageBitmap | null> {
  try {
    const blob = isTauri() ? new Blob([await api.readImage(m.path)]) : await (await fetch(m.path)).blob();
    const img = await createImageBitmap(blob, { imageOrientation: "from-image" });
    decoded.set(m.path, img);
    return img;
  } catch (e) {
    warn(`picture ${m.name}`, e);
    return null;
  } finally {
    loading.delete(m.path);
  }
}

/** The picture, decoding it if needed. */
export function loadImage(m: Media): Promise<ImageBitmap | null> {
  const have = decoded.get(m.path);
  if (have) return Promise.resolve(have);
  let p = loading.get(m.path);
  if (!p) {
    p = load(m);
    loading.set(m.path, p);
  }
  return p;
}

/** Starts decoding; `then` runs when the picture is there. */
export function requestImage(m: Media, then: () => void) {
  void loadImage(m).then((img) => img && then());
}

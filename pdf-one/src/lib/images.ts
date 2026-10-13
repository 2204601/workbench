/**
 * Pictures on pages are kept by Rust (its image store); the screen shows
 * them through blob URLs made once per picture.
 */
import { api } from "./api";
import { warn } from "./log";

const urls = new Map<number, Promise<string>>();

export function imageUrl(id: number): Promise<string> {
  let u = urls.get(id);
  if (!u) {
    u = api.imageBytes(id).then((bytes) => {
      // PNG and JPEG both start in a way the WebView recognizes.
      const type = bytes[0] === 0x89 ? "image/png" : "image/jpeg";
      return URL.createObjectURL(new Blob([bytes as BlobPart], { type }));
    });
    u.catch((e) => {
      warn("image", e);
      urls.delete(id);
    });
    urls.set(id, u);
  }
  return u;
}

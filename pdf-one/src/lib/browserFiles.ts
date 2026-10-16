// Files the browser handed over (the file chooser, a drop), for running
// outside Tauri (docs/WASM.md). The app passes files around by path, so each
// one gets a made-up path; src/dev/wasmBackend.ts reads them back by it.

const files = new Map<string, File>();
let next = 0;

export function registerFile(f: File): string {
  const path = `/ブラウザ/${++next}/${f.name}`;
  files.set(path, f);
  return path;
}

export function browserFile(path: string): File | undefined {
  return files.get(path);
}

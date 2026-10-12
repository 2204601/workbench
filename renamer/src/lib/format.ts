// How numbers, sizes and dates read in the window.

const nf = new Intl.NumberFormat("ja-JP");
export const count = (n: number) => nf.format(n);

export function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

const df = new Intl.DateTimeFormat("ja-JP", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});
export const dateTime = (ms: number | null) => (ms ? df.format(ms) : "―");

/** The last part of a path, for "\\nas01\共有\写真" → "写真". */
export const baseName = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() ?? path;

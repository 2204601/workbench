// How numbers and sizes read in the window.

const nf = new Intl.NumberFormat("ja-JP");
export const count = (n: number) => nf.format(n);

/** Binary units, as Explorer and DaisyDisk show them ("GB" for 1024³). */
export function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB", "PB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v < 10 ? v.toFixed(2) : v < 100 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

/** "12%", "0.4%", "0.01% 未満". */
export function percent(part: number, whole: number): string {
  if (whole <= 0) return "―";
  const p = (part / whole) * 100;
  if (p > 0 && p < 0.01) return "0.01% 未満";
  return `${p >= 10 ? Math.round(p) : p.toFixed(p >= 1 ? 1 : 2)}%`;
}

/** "12.3 秒", "2 分 5 秒". */
export function duration(ms: number): string {
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)} 秒`;
  return `${Math.floor(s / 60)} 分 ${Math.round(s % 60)} 秒`;
}

/** The last part of a path, for "\\nas01\共有\写真" → "写真"; a drive root stays as it is. */
export const baseName = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() ?? path;

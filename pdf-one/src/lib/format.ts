/** Numbers and dates as the UI shows them. */

/** "D:20251013093000+09'00'" → "2025/10/13 09:30" (local time); "" for none. */
export function formatPdfDate(s: string): string {
  const m = /^D?:?(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?([Zz+-])?(\d{2})?'?(\d{2})?/.exec(s.trim());
  if (!m) return "";
  const [, y, mo = "01", d = "01", h = "00", mi = "00", sec = "00", tz, th = "00", tm = "00"] = m;
  let t = Date.UTC(+y, +mo - 1, +d, +h, +mi, +sec);
  if (tz === "+" || tz === "-") t -= (tz === "+" ? 1 : -1) * (+th * 60 + +tm) * 60_000;
  else if (!tz) t = new Date(+y, +mo - 1, +d, +h, +mi, +sec).getTime();
  const date = new Date(t);
  if (isNaN(date.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}/${p(date.getMonth() + 1)}/${p(date.getDate())} ${p(date.getHours())}:${p(date.getMinutes())}`;
}

export function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

export const percent = (s: number) => `${Math.round(s * 100)}%`;

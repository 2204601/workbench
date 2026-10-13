/** "1:02.50" (or "1:02:03.50" past an hour); `frames` for the hundredths. */
export function timecode(t: number, hundredths = true): string {
  const s = Math.max(0, t);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  const cs = Math.floor((s * 100) % 100);
  const mm = h ? String(m).padStart(2, "0") : String(m);
  const base = `${h ? `${h}:` : ""}${mm}:${String(sec).padStart(2, "0")}`;
  return hundredths ? `${base}.${String(cs).padStart(2, "0")}` : base;
}

/** "3.5 秒" */
export const seconds = (t: number) => `${(Math.round(t * 10) / 10).toFixed(1)} 秒`;

/**
 * Numbers as the popup shows them. Sizes count in 1024s and are written
 * KB / MB / GB, as Explorer and Task Manager do (the same as format.rs).
 */

const KB = 1024;
const MB = KB * 1024;
const GB = MB * 1024;

function digits(x: number) {
  return x < 9.95 ? x.toFixed(1) : x.toFixed(0);
}

/** "9.8 GB", "512 MB". */
export function size(bytes: number) {
  if (bytes >= GB) return `${digits(bytes / GB)} GB`;
  if (bytes >= MB) return `${Math.round(bytes / MB)} MB`;
  return `${Math.round(bytes / KB)} KB`;
}

/** "0 KB/s", "850 KB/s", "1.2 MB/s". */
export function rate(bytesPerSec: number) {
  if (bytesPerSec >= GB) return `${digits(bytesPerSec / GB)} GB/s`;
  if (bytesPerSec >= MB) return `${digits(bytesPerSec / MB)} MB/s`;
  return `${Math.round(bytesPerSec / KB)} KB/s`;
}

/** "42%". Under 10 with one decimal, where the decimal still tells something. */
export function percent(p: number, decimals = false) {
  const v = Math.min(100, Math.max(0, p));
  return decimals && v < 9.95 ? `${v.toFixed(1)}%` : `${Math.round(v)}%`;
}

/** A round number at or above `x`, for the top of a speed graph: 1, 2, 5, 10, 20… × 1024ⁿ. */
export function niceCeiling(x: number) {
  const floor = 64 * KB;
  if (x <= floor) return floor;
  const unit = x >= GB ? GB : x >= MB ? MB : KB;
  const v = x / unit;
  const pow = 10 ** Math.floor(Math.log10(v));
  const step = [1, 2, 5, 10].find((s) => s * pow >= v) ?? 10;
  return step * pow * unit;
}

/** "12 秒前", "1 分前". */
export function ago(seconds: number) {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return s === 0 ? "いま" : `${s} 秒前`;
  return `${Math.floor(s / 60)} 分 ${s % 60} 秒前`.replace(" 0 秒", "");
}

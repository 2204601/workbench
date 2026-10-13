/**
 * The small line graphs of the last minute or so: one series filled below
 * its line, or two lines (read / write, received / sent) with a legend in
 * the card header. Hovering shows a crosshair and every series' value at
 * that moment.
 */
import { ago } from "./format";

export type Series = {
  label: string;
  /** A CSS custom property holding the colour: "--series-1". */
  color: string;
  values: number[];
};

export type ChartOptions = {
  /** How many readings across. */
  slots: number;
  /** A fixed top (100 for percentages), or the top for the values shown. */
  top: number | ((max: number) => number);
  format: (v: number) => string;
};

const HEIGHT = 48;

export class Chart {
  private canvas = document.createElement("canvas");
  private axis = document.createElement("span");
  private tip = document.createElement("div");
  private series: Series[] = [];
  private times: number[] = [];
  private hover: number | null = null;

  constructor(
    private host: HTMLElement,
    private options: ChartOptions,
  ) {
    this.axis.className = "axis";
    this.tip.className = "tip";
    this.tip.hidden = true;
    host.append(this.canvas, this.axis, this.tip);
    host.addEventListener("pointermove", (e) => this.pointer(e));
    host.addEventListener("pointerleave", () => {
      this.hover = null;
      this.tip.hidden = true;
      this.draw();
    });
    new ResizeObserver(() => this.draw()).observe(host);
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => this.draw());
  }

  /** `times`: when each reading was taken (ms), oldest first, as long as each series. */
  set(series: Series[], times: number[]) {
    this.series = series;
    this.times = times;
    this.draw();
    if (this.hover !== null) this.showTip();
  }

  private get top() {
    const max = Math.max(0, ...this.series.flatMap((s) => s.values.slice(-this.options.slots)));
    const top = this.options.top;
    return typeof top === "number" ? top : top(max);
  }

  /** x of reading `i` of `n`: the latest at the right edge. */
  private x(i: number, n: number, width: number) {
    const slots = this.options.slots;
    return (width * (i - (n - slots))) / (slots - 1);
  }

  private draw() {
    const width = this.host.clientWidth;
    if (width === 0) return;
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(HEIGHT * dpr);
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${HEIGHT}px`;
    const ctx = this.canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    const style = getComputedStyle(this.host);
    const css = (name: string) => style.getPropertyValue(name).trim();

    const top = this.top;
    this.axis.textContent = this.options.format(top);
    // Lines are 2 px; keep them inside the canvas at 0 and at the top.
    const y = (v: number) => 1 + (HEIGHT - 2) * (1 - Math.min(v, top) / top);

    // Recessive frame: the top hairline and the baseline.
    ctx.fillStyle = css("--grid");
    ctx.fillRect(0, 0, width, 1);
    ctx.fillRect(0, HEIGHT - 1, width, 1);

    const single = this.series.length === 1;
    for (const s of this.series) {
      const n = s.values.length;
      const first = Math.max(0, n - this.options.slots);
      if (n - first < 2) continue;
      const color = css(s.color);
      ctx.beginPath();
      for (let i = first; i < n; i++) {
        const px = this.x(i, n, width);
        if (i === first) ctx.moveTo(px, y(s.values[i]));
        else ctx.lineTo(px, y(s.values[i]));
      }
      ctx.lineWidth = 2;
      ctx.lineJoin = "round";
      ctx.strokeStyle = color;
      ctx.stroke();
      if (single) {
        ctx.lineTo(this.x(n - 1, n, width), HEIGHT);
        ctx.lineTo(this.x(first, n, width), HEIGHT);
        ctx.closePath();
        ctx.globalAlpha = 0.16;
        ctx.fillStyle = color;
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }

    if (this.hover !== null) {
      const n = this.times.length;
      const px = Math.round(this.x(this.hover, n, width)) + 0.5;
      ctx.fillStyle = css("--dim");
      ctx.fillRect(px - 0.5, 0, 1, HEIGHT);
      for (const s of this.series) {
        const v = s.values[this.hover];
        if (v === undefined) continue;
        ctx.beginPath();
        ctx.arc(px, y(v), 4, 0, Math.PI * 2);
        ctx.fillStyle = css(s.color);
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = css("--surface");
        ctx.stroke();
      }
    }
  }

  private pointer(e: PointerEvent) {
    const n = this.times.length;
    if (n === 0) return;
    const rect = this.host.getBoundingClientRect();
    const slots = this.options.slots;
    const slot = Math.round(((e.clientX - rect.left) / rect.width) * (slots - 1));
    const i = Math.min(n - 1, Math.max(0, n - slots + slot, 0));
    this.hover = i;
    this.draw();
    this.showTip();
  }

  private showTip() {
    const i = this.hover;
    if (i === null || i >= this.times.length) return;
    const latest = this.times[this.times.length - 1];
    this.tip.replaceChildren();
    for (const s of this.series) {
      const row = document.createElement("div");
      const key = document.createElement("i");
      key.style.background = `var(${s.color})`;
      const value = document.createElement("b");
      value.textContent = this.options.format(s.values[i] ?? 0);
      const label = document.createElement("span");
      label.textContent = s.label;
      row.append(key, value, label);
      this.tip.append(row);
    }
    const when = document.createElement("div");
    when.className = "when";
    when.textContent = ago((latest - this.times[i]) / 1000);
    this.tip.append(when);

    // Beside the crosshair, on whichever side has room.
    const width = this.host.clientWidth;
    const px = this.x(i, this.times.length, width);
    this.tip.hidden = false;
    const tipWidth = this.tip.offsetWidth;
    const left = px + 10 + tipWidth > width ? px - 10 - tipWidth : px + 10;
    this.tip.style.left = `${Math.max(0, left)}px`;
  }
}

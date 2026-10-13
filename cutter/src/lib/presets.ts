/** Ready-made text styles (テキスト tab): each adds a text at the playhead. */
import type { AnimKind, TextStyle } from "./project";
import { DEFAULT_TEXT } from "./project";

export interface TextPreset {
  label: string;
  text: string;
  y: number;
  style: TextStyle;
  animIn: AnimKind;
  animOut: AnimKind;
}

export const TEXT_PRESETS: TextPreset[] = [
  { label: "タイトル", text: "タイトル", y: 0.5, style: { ...DEFAULT_TEXT, size: 140 }, animIn: "pop", animOut: "fade" },
  {
    label: "テロップ",
    text: "テロップ",
    y: 0.86,
    style: { ...DEFAULT_TEXT, size: 64, outline: null, box: "rgba(0,0,0,0.62)" },
    animIn: "fade",
    animOut: "fade",
  },
  {
    label: "強調",
    text: "ここがポイント！",
    y: 0.2,
    style: { ...DEFAULT_TEXT, size: 96, color: "#ffd23f" },
    animIn: "pop",
    animOut: "fade",
  },
  {
    label: "吹き出し",
    text: "なるほど！",
    y: 0.3,
    style: { ...DEFAULT_TEXT, size: 76, color: "#1b1c1f", outline: null, box: "#ffffff" },
    animIn: "pop",
    animOut: "pop",
  },
  {
    label: "やわらか",
    text: "おつかれさま",
    y: 0.5,
    style: { ...DEFAULT_TEXT, font: "rounded", size: 110, color: "#ffffff", outline: "#ff6fa3" },
    animIn: "rise",
    animOut: "rise",
  },
  {
    label: "明朝",
    text: "はじまり",
    y: 0.5,
    style: { ...DEFAULT_TEXT, font: "mincho", size: 120, bold: false, outline: null },
    animIn: "fade",
    animOut: "fade",
  },
  {
    label: "左から",
    text: "Step 1",
    y: 0.14,
    style: { ...DEFAULT_TEXT, size: 72, outline: null, box: "#4c8dff" },
    animIn: "slide",
    animOut: "slide",
  },
];

export const TEXT_COLORS = ["#ffffff", "#1b1c1f", "#ffd23f", "#ff4d4d", "#ff6fa3", "#3ec27f", "#4c8dff", "#a98bff"];

/**
 * The ribbon (docs/UX.md §4–§5): work tabs, each with a few groups of big
 * buttons with a picture and a word. Every button is a command from the
 * table (commands.ts); a menu button gathers a few of them. Tabs for work
 * that isn't built yet aren't listed (no greyed-out promises).
 */
import { Shapes, Signature, Stamp, type LucideIcon } from "lucide-react";

/** A button for one command, or a menu of several. */
export type RibbonItem = string | RibbonMenu;

export interface RibbonMenu {
  id: string;
  title: string;
  icon: LucideIcon;
  /** Command ids; "-" is a separator. */
  items: (string | "-")[];
}

export interface RibbonTab {
  id: string;
  label: string;
  groups: RibbonItem[][];
}

const SHAPES: RibbonMenu = { id: "shapes", title: "図形", icon: Shapes, items: ["tool.rect", "tool.ellipse", "tool.line", "tool.arrow"] };
const STAMPS: RibbonMenu = {
  id: "stamps",
  title: "印鑑・画像",
  icon: Stamp,
  items: ["tool.image", "stamp.date", "stamp.word", "-", "tool.imageFile"],
};
const SIGN: RibbonMenu = { id: "sign", title: "署名", icon: Signature, items: ["sign.draw", "tool.image", "tool.imageFile"] };

export const RIBBON: RibbonTab[] = [
  {
    id: "home",
    label: "ホーム",
    groups: [["file.open", "file.save", "file.print"], ["edit.undo", "edit.redo"], ["tool.select", "tool.highlight", "tool.text", "tool.image"], ["edit.find"]],
  },
  {
    id: "markup",
    label: "書き込み",
    groups: [
      ["tool.select", "tool.highlight", "tool.underline", "tool.strikeout"],
      ["tool.text", "tool.note", "tool.ink", "tool.eraser"],
      [SHAPES, STAMPS],
    ],
  },
  {
    id: "pages",
    label: "ページ",
    groups: [
      ["view.organizer"],
      ["page.rotateRight", "page.rotateLeft", "page.delete"],
      ["page.insertBlank", "page.insertFile"],
      ["page.extract", "page.split"],
    ],
  },
  {
    id: "fill",
    label: "入力と署名",
    groups: [["tool.select", "tool.fill"], ["tool.check", "tool.cross", "tool.dot", "tool.dash", "tool.date"], [SIGN]],
  },
];

export const isMenu = (item: RibbonItem): item is RibbonMenu => typeof item !== "string";

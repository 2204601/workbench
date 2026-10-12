/**
 * What the rule panel's fields hold, per rule, and the rule they make
 * (docs/SPEC.md §5). The forms only describe the rule; Rust computes every
 * name (CLAUDE.md: 新しい名前の計算と検査は Rust 側だけ).
 */
import type { NormalizeOptions, Rule } from "./api";

export type Mode = "simple" | "detail";
export type RuleKind = "replace" | "number" | "date" | "normalize";

export const RULE_KINDS: { kind: RuleKind; label: string }[] = [
  { kind: "replace", label: "置換" },
  { kind: "number", label: "連番" },
  { kind: "date", label: "日付" },
  { kind: "normalize", label: "整形" },
];

export type ReplaceAction = "replace" | "prefix" | "suffix" | "remove" | "trim";
export type Place = "start" | "end" | "only";
export type Sep = "_" | "-" | " " | "";

export interface Drafts {
  replace: {
    action: ReplaceAction;
    find: string;
    with: string;
    /** 詳細 only. */
    regex: boolean;
    caseSensitive: boolean;
    firstOnly: boolean;
    text: string;
    trimStart: number;
    trimEnd: number;
  };
  number: {
    place: Place;
    start: number;
    step: number;
    digits: number;
    sep: Sep;
    /** 詳細: the template itself. */
    template: string;
  };
  date: {
    source: "modified" | "created";
    place: Place;
    format: string;
    sep: Sep;
  };
  normalize: NormalizeOptions;
}

export const DEFAULT_DRAFTS: Drafts = {
  replace: {
    action: "replace",
    find: "",
    with: "",
    regex: false,
    caseSensitive: false,
    firstOnly: false,
    text: "",
    trimStart: 0,
    trimEnd: 0,
  },
  number: { place: "start", start: 1, step: 1, digits: 3, sep: "_", template: "{name}_{n:3}" },
  date: { source: "modified", place: "start", format: "yyyyMMdd", sep: "_" },
  normalize: {
    width: false,
    kana: false,
    case: "keep",
    spaces: false,
    spaceTo: "",
    forbidden: "keep",
    nfc: true,
  },
};

export const DATE_FORMATS = ["yyyyMMdd", "yyyy-MM-dd", "yyyyMMdd_HHmmss", "yyMMdd"];

const numberToken = (digits: number) => (digits > 0 ? `{n:${digits}}` : "{n}");

function placed(token: string, place: Place, sep: Sep): string {
  if (place === "only") return token;
  return place === "start" ? `${token}${sep}{name}` : `{name}${sep}${token}`;
}

/** The rule the fields make, or null while there is nothing to apply yet. */
export function ruleOf(kind: RuleKind, mode: Mode, d: Drafts): Rule | null {
  const detail = mode === "detail";
  switch (kind) {
    case "replace": {
      const r = d.replace;
      const base = { regex: detail && r.regex, caseSensitive: r.caseSensitive, firstOnly: r.firstOnly };
      switch (r.action) {
        case "replace":
          return r.find ? { kind: "replace", find: r.find, with: r.with, ...base } : null;
        case "remove":
          return r.find ? { kind: "replace", find: r.find, with: "", ...base } : null;
        case "prefix":
        case "suffix":
          return r.text ? { kind: "insert", text: r.text, atEnd: r.action === "suffix" } : null;
        case "trim":
          return r.trimStart || r.trimEnd ? { kind: "trim", start: r.trimStart, end: r.trimEnd } : null;
      }
      break;
    }
    case "number": {
      const n = d.number;
      const template = detail ? n.template : placed(numberToken(n.digits), n.place, n.sep);
      return template ? { kind: "template", template, start: n.start, step: detail ? n.step : 1 } : null;
    }
    case "date": {
      const t = d.date;
      if (!t.format) return null;
      const token = `{${t.source === "created" ? "cdate" : "mdate"}:${t.format}}`;
      return { kind: "template", template: placed(token, t.place, t.sep), start: 1, step: 1 };
    }
    case "normalize":
      return { kind: "normalize", ...d.normalize };
  }
  return null;
}

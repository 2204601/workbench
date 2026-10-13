/**
 * The edit, as saved in a .cutter file: the media used, the clips in order
 * on the video track, and the texts and stamps over them. Plain data: every
 * change makes a new Project (undo keeps the old ones, store.ts).
 */

export type MediaKind = "video" | "image";

/** A file added to the project (its probe, src/lib/api.ts `Probe`). */
export interface Media {
  id: string;
  path: string;
  name: string;
  kind: MediaKind;
  /** Seconds; 0 for a picture. */
  duration: number;
  width: number;
  height: number;
  fps: number;
  hasAudio: boolean;
}

/** How a picture of another shape fills the frame. */
export type Fit = "contain" | "cover";

/** ffmpeg xfade names; the list is src/lib/transitions.ts and src-tauri/src/render.rs. */
export type TransitionKind =
  | "fade"
  | "fadeblack"
  | "fadewhite"
  | "wipeleft"
  | "wiperight"
  | "wipeup"
  | "wipedown"
  | "slideleft"
  | "slideright"
  | "slideup"
  | "slidedown"
  | "circleopen"
  | "circleclose";

export interface Transition {
  kind: TransitionKind;
  /** Seconds. */
  duration: number;
}

/** A part of a media file on the video track. */
export interface Clip {
  id: string;
  mediaId: string;
  /** In and out points in the file, in seconds. A picture: 0 and how long it shows. */
  start: number;
  end: number;
  /** 1 = as recorded, 0 = muted. */
  volume: number;
  fit: Fit;
  /** Into this clip from the one before (none on the first clip). */
  transition: Transition | null;
}

export type AnimKind = "none" | "fade" | "pop" | "rise" | "slide";

export type FontId = "gothic" | "mincho" | "rounded";

export interface TextStyle {
  font: FontId;
  /** Pixels at a frame 1080 tall (short side); scales with the frame. */
  size: number;
  color: string;
  bold: boolean;
  /** Edge around the letters, or none. */
  outline: string | null;
  /** A band behind the text, or none. */
  box: string | null;
}

/** A text or a stamp over the video, at a time and a place. */
export interface Overlay {
  id: string;
  kind: "text" | "stamp";
  /** Timeline seconds. */
  start: number;
  end: number;
  /** Centre, as a share of the frame (0..1). */
  x: number;
  y: number;
  scale: number;
  /** Degrees, clockwise. */
  rotation: number;
  animIn: AnimKind;
  animOut: AnimKind;
  text: string;
  style: TextStyle;
  /** Stamp: an emoji, or "shape:<id>" (src/lib/stamps.ts). */
  stamp: string;
  /** Colour of a shape stamp. */
  color: string;
}

export interface Project {
  version: 1;
  width: number;
  height: number;
  fps: number;
  media: Media[];
  clips: Clip[];
  overlays: Overlay[];
}

export type Aspect = "16:9" | "9:16" | "1:1";

export const ASPECTS: Record<Aspect, { width: number; height: number; label: string }> = {
  "16:9": { width: 1920, height: 1080, label: "横長 16:9" },
  "9:16": { width: 1080, height: 1920, label: "縦長 9:16" },
  "1:1": { width: 1080, height: 1080, label: "正方形 1:1" },
};

export function aspectOf(p: Pick<Project, "width" | "height">): Aspect {
  if (p.width > p.height) return "16:9";
  if (p.width < p.height) return "9:16";
  return "1:1";
}

export const emptyProject = (): Project => ({ version: 1, ...size("16:9"), fps: 30, media: [], clips: [], overlays: [] });

const size = (a: Aspect) => ({ width: ASPECTS[a].width, height: ASPECTS[a].height });

/** How long a picture shows when added. */
export const IMAGE_SECONDS = 3;
/** A text or stamp, when added. */
export const OVERLAY_SECONDS = 3;
export const DEFAULT_TRANSITION: Transition = { kind: "fade", duration: 0.5 };

let seq = 0;
/** Ids unique within a session and across saved files. */
export const newId = (prefix: string) => `${prefix}${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export const DEFAULT_TEXT: TextStyle = {
  font: "gothic",
  size: 96,
  color: "#ffffff",
  bold: true,
  outline: "#000000",
  box: null,
};

/** Reads a saved file, filling in what older files lack. Throws on what isn't one. */
export function parseProject(text: string): Project {
  const raw = JSON.parse(text);
  if (!raw || raw.version !== 1 || !Array.isArray(raw.clips) || !Array.isArray(raw.media)) {
    throw new Error("Video Studio のプロジェクトではありません");
  }
  const base = emptyProject();
  return {
    ...base,
    ...raw,
    clips: raw.clips.map((c: Partial<Clip>) => ({ volume: 1, fit: "contain", transition: null, ...c })),
    overlays: (raw.overlays ?? []).map((o: Partial<Overlay>) => ({
      scale: 1,
      rotation: 0,
      animIn: "none",
      animOut: "none",
      text: "",
      stamp: "",
      color: "#ff4d4d",
      ...o,
      style: { ...DEFAULT_TEXT, ...o.style },
    })),
  };
}

export const serializeProject = (p: Project) => JSON.stringify(p, null, 2);

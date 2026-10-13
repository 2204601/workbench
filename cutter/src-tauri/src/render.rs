//! The export: the edit (src/lib/exportJob.ts) as one ffmpeg run. Clips are
//! cut by seeking each input, fitted to the frame, and joined with `xfade` /
//! `acrossfade` (a transition) or `concat` (a plain cut). Texts and stamps
//! come as PNGs the page drew, laid over with `overlay` and animated with
//! expressions that follow src/lib/anim.ts.

use serde::Deserialize;
use std::fmt::Write as _;
use std::path::{Path, PathBuf};

pub const SAMPLE_RATE: u32 = 48_000;

/// The transitions ffmpeg's `xfade` has that the preview draws the same way
/// (src/lib/transitions.ts). Only these reach the filter graph.
pub const TRANSITIONS: &[&str] = &[
    "fade",
    "fadeblack",
    "fadewhite",
    "wipeleft",
    "wiperight",
    "wipeup",
    "wipedown",
    "slideleft",
    "slideright",
    "slideup",
    "slidedown",
    "circleopen",
    "circleclose",
];

/// How long a text or stamp takes to come in or go (src/lib/anim.ts ANIM_SECONDS).
pub const ANIM_SECONDS: f64 = 0.4;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Quality {
    High,
    Standard,
    Small,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Fit {
    /// The whole picture, with bars.
    #[default]
    Contain,
    /// Fills the frame; the sides that stick out are cut.
    Cover,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Anim {
    #[default]
    None,
    Fade,
    Pop,
    Rise,
    Slide,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Transition {
    pub kind: String,
    pub duration: f64,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum ClipSource {
    /// A part of a video file.
    #[serde(rename = "video", rename_all = "camelCase")]
    Video {
        path: String,
        start: f64,
        has_audio: bool,
        fit: Fit,
    },
    /// A picture, already fitted to the frame by the page (EXIF rotation and
    /// HEIC are the page's to read), as a PNG data URL.
    #[serde(rename = "image")]
    Image { png: String },
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportClip {
    pub source: ClipSource,
    pub duration: f64,
    /// 1 = as recorded.
    pub volume: f64,
    /// Into this clip from the one before; ignored on the first.
    pub transition: Option<Transition>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportOverlay {
    /// PNG data URL, drawn at its full size (rotation included).
    pub png: String,
    /// Where its centre goes, in pixels of the frame.
    pub x: f64,
    pub y: f64,
    pub start: f64,
    pub end: f64,
    pub anim_in: Anim,
    pub anim_out: Anim,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportJob {
    pub width: u32,
    pub height: u32,
    pub fps: u32,
    pub quality: Quality,
    pub clips: Vec<ExportClip>,
    pub overlays: Vec<ExportOverlay>,
}

/// The edit in frames: the same rounding as src/lib/timeline.ts.
#[derive(Debug, PartialEq)]
pub struct Frames {
    /// Each clip's length.
    pub clips: Vec<u64>,
    /// The transition into each clip (0 = a cut; always 0 for the first).
    pub transitions: Vec<u64>,
    pub total: u64,
}

pub fn frames(job: &ExportJob) -> Frames {
    let fps = job.fps as f64;
    let clips: Vec<u64> = job
        .clips
        .iter()
        .map(|c| ((c.duration * fps).round() as u64).max(1))
        .collect();
    let mut transitions = vec![0u64; clips.len()];
    for i in 1..clips.len() {
        let Some(t) = &job.clips[i].transition else {
            continue;
        };
        let want = (t.duration * fps).round().max(0.0) as u64;
        // Never longer than either clip's free part: at most two clips at once.
        let room = (clips[i - 1] - transitions[i - 1])
            .min(clips[i])
            .saturating_sub(1);
        transitions[i] = want.min(room);
    }
    let total = clips.iter().sum::<u64>() - transitions.iter().sum::<u64>();
    Frames {
        clips,
        transitions,
        total,
    }
}

pub fn validate(job: &ExportJob) -> Result<(), String> {
    if !(1..=120).contains(&job.fps) {
        return Err(format!("フレームレートが範囲の外です: {}", job.fps));
    }
    for d in [job.width, job.height] {
        if !(16..=7680).contains(&d) || d % 2 != 0 {
            return Err(format!(
                "書き出す大きさが使えません: {}x{}",
                job.width, job.height
            ));
        }
    }
    if job.clips.is_empty() {
        return Err("タイムラインにクリップがありません".into());
    }
    let finite = |x: f64| x.is_finite();
    for c in &job.clips {
        if !finite(c.duration) || c.duration <= 0.0 || !finite(c.volume) || c.volume < 0.0 {
            return Err("クリップの長さか音量がおかしい値です".into());
        }
        if let Some(t) = &c.transition {
            if !TRANSITIONS.contains(&t.kind.as_str()) || !finite(t.duration) {
                return Err(format!("切り替え「{}」は使えません", t.kind));
            }
        }
        if let ClipSource::Video { path, start, .. } = &c.source {
            if !finite(*start) || *start < 0.0 {
                return Err("クリップの開始位置がおかしい値です".into());
            }
            if !Path::new(path).is_file() {
                return Err(format!("素材のファイルが見つかりません: {path}"));
            }
        }
    }
    for o in &job.overlays {
        if ![o.x, o.y, o.start, o.end].into_iter().all(finite) || o.end <= o.start {
            return Err("文字かスタンプの位置か時間がおかしい値です".into());
        }
    }
    Ok(())
}

/// A PNG data URL's bytes.
pub fn png_bytes(data_url: &str) -> Result<Vec<u8>, String> {
    use base64::Engine as _;
    let b64 = data_url
        .strip_prefix("data:image/png;base64,")
        .ok_or("PNG のデータではありません")?;
    base64::engine::general_purpose::STANDARD
        .decode(b64)
        .map_err(|e| format!("PNG のデータを読めません: {e}"))
}

fn num(x: f64) -> String {
    let s = format!("{x:.6}");
    let s = s.trim_end_matches('0').trim_end_matches('.');
    if s.is_empty() || s == "-0" {
        "0".into()
    } else {
        s.into()
    }
}

/// ease-out cubic of `k` (0..1), as an ffmpeg expression.
fn ease_out(k: &str) -> String {
    format!("(1-pow(1-{k},3))")
}

/// ease-out-back of `k`: overshoots a little, for "pop".
fn back_out(k: &str) -> String {
    format!("(1+2.70158*pow({k}-1,3)+1.70158*pow({k}-1,2))")
}

/// The animation's length for an overlay `len` seconds long (src/lib/anim.ts `animSeconds`).
pub fn anim_seconds(len: f64) -> f64 {
    ANIM_SECONDS.min(len / 2.0)
}

/// The overlay's filters and `overlay` arguments.
struct OverlayExprs {
    /// Filters on the PNG stream (after format=rgba); may be empty.
    filters: Vec<String>,
    x: String,
    y: String,
}

fn overlay_exprs(o: &ExportOverlay, width: u32, height: u32) -> OverlayExprs {
    let (s, e) = (o.start, o.end);
    let a = anim_seconds(e - s);
    let k_in = format!("clip((t-{})/{},0,1)", num(s), num(a));
    let k_out = format!("clip(({}-t)/{},0,1)", num(e), num(a));
    let mut filters = Vec::new();

    // Scale (pop) first, then the fades: alpha only.
    let mut scale = Vec::new();
    if o.anim_in == Anim::Pop {
        scale.push(back_out(&k_in));
    }
    if o.anim_out == Anim::Pop {
        scale.push(back_out(&k_out));
    }
    if !scale.is_empty() {
        let f = scale.join("*");
        filters.push(format!(
            "scale=w='max(1,iw*{f})':h='max(1,ih*{f})':eval=frame"
        ));
    }
    let fade_len = |anim: Anim| match anim {
        Anim::None => None,
        Anim::Pop => Some(a / 3.0),
        _ => Some(a),
    };
    if let Some(d) = fade_len(o.anim_in) {
        filters.push(format!("fade=t=in:st={}:d={}:alpha=1", num(s), num(d)));
    }
    if let Some(d) = fade_len(o.anim_out) {
        filters.push(format!("fade=t=out:st={}:d={}:alpha=1", num(e - d), num(d)));
    }

    let (w, h) = (width as f64, height as f64);
    let mut x = format!("{}-overlay_w/2", num(o.x));
    let mut y = format!("{}-overlay_h/2", num(o.y));
    // Slide: in from the left, out to the right. Rise: in from below, out upwards.
    if o.anim_in == Anim::Slide {
        let _ = write!(x, "-(1-{})*{}", ease_out(&k_in), num(w * 0.15));
    }
    if o.anim_out == Anim::Slide {
        let _ = write!(x, "+(1-{})*{}", ease_out(&k_out), num(w * 0.15));
    }
    if o.anim_in == Anim::Rise {
        let _ = write!(y, "+(1-{})*{}", ease_out(&k_in), num(h * 0.08));
    }
    if o.anim_out == Anim::Rise {
        let _ = write!(y, "-(1-{})*{}", ease_out(&k_out), num(h * 0.08));
    }
    OverlayExprs { filters, x, y }
}

/// The ffmpeg run: arguments (inputs, output) and the filter graph, which
/// goes into a file (`-filter_complex_script`) to stay clear of the length
/// limit of a Windows command line.
pub struct Plan {
    pub args: Vec<String>,
    pub graph: String,
    /// Seconds, for the progress bar.
    pub duration: f64,
}

/// `images[i]` is the PNG file of clip `i` when it is a picture;
/// `overlays[j]` the PNG of overlay `j`.
pub fn plan(
    job: &ExportJob,
    images: &[Option<PathBuf>],
    overlays: &[PathBuf],
    graph_file: &Path,
    output: &Path,
) -> Plan {
    let fps = job.fps as f64;
    let (w, h) = (job.width, job.height);
    let fr = frames(job);
    let samples = |frames: u64| (frames as f64 * SAMPLE_RATE as f64 / fps).round() as u64;
    let secs = |frames: u64| frames as f64 / fps;
    let audio_fmt =
        format!("aformat=sample_fmts=fltp:sample_rates={SAMPLE_RATE}:channel_layouts=stereo");

    let mut args: Vec<String> = Vec::new();
    let mut g: Vec<String> = Vec::new();
    let mut input = 0usize;

    for (i, c) in job.clips.iter().enumerate() {
        let n = fr.clips[i];
        let len = secs(n);
        let video_audio = match &c.source {
            ClipSource::Video {
                path,
                start,
                has_audio,
                fit,
            } => {
                // Seeking the input is fast and frame exact; a little more
                // than needed, cut to the frame below.
                args.extend([
                    "-ss".into(),
                    num(*start),
                    "-t".into(),
                    num(len + 2.0 / fps),
                    "-i".into(),
                    path.clone(),
                ]);
                let fit = match fit {
                    Fit::Contain => format!(
                        "scale={w}:{h}:force_original_aspect_ratio=decrease,pad={w}:{h}:(ow-iw)/2:(oh-ih)/2:color=black"
                    ),
                    Fit::Cover => format!("scale={w}:{h}:force_original_aspect_ratio=increase,crop={w}:{h}"),
                };
                g.push(format!(
                    "[{input}:v]setpts=PTS-STARTPTS,fps={fps},{fit},setsar=1,format=yuv420p,tpad=stop_mode=clone:stop_duration={pad},trim=end_frame={n},setpts=PTS-STARTPTS,fps={fps}[v{i}]",
                    fps = job.fps,
                    pad = num(len + 1.0),
                ));
                Some(*has_audio)
            }
            ClipSource::Image { .. } => {
                let png = images.get(i).cloned().flatten().unwrap_or_default();
                args.extend([
                    "-loop".into(),
                    "1".into(),
                    "-framerate".into(),
                    job.fps.to_string(),
                    "-t".into(),
                    num(len + 2.0 / fps),
                    "-i".into(),
                    png.to_string_lossy().into_owned(),
                ]);
                g.push(format!(
                    "[{input}:v]scale={w}:{h},setsar=1,format=yuv420p,trim=end_frame={n},setpts=PTS-STARTPTS,fps={}[v{i}]",
                    job.fps
                ));
                None
            }
        };
        if video_audio == Some(true) && c.volume > 0.0 {
            g.push(format!(
                "[{input}:a]asetpts=PTS-STARTPTS,aresample={SAMPLE_RATE},{audio_fmt},volume={},apad,atrim=end_sample={}[a{i}]",
                num(c.volume),
                samples(n)
            ));
        } else {
            g.push(format!(
                "anullsrc=r={SAMPLE_RATE}:cl=stereo,{audio_fmt},atrim=end_sample={}[a{i}]",
                samples(n)
            ));
        }
        input += 1;
    }

    // Join: each clip onto everything before it.
    let (mut v, mut a) = ("v0".to_string(), "a0".to_string());
    let mut acc = fr.clips[0];
    for i in 1..job.clips.len() {
        let d = fr.transitions[i];
        if d > 0 {
            let kind = &job.clips[i].transition.as_ref().expect("transition").kind;
            g.push(format!(
                "[{v}][v{i}]xfade=transition={kind}:duration={}:offset={}[xv{i}]",
                num(secs(d)),
                num(secs(acc - d))
            ));
            g.push(format!("[{a}][a{i}]acrossfade=d={}[xa{i}]", num(secs(d))));
            acc += fr.clips[i] - d;
        } else {
            // concat answers in microseconds with no frame rate; xfade wants
            // both sides in frames, at a stated rate (ffmpeg 7 refuses otherwise).
            g.push(format!(
                "[{v}][{a}][v{i}][a{i}]concat=n=2:v=1:a=1[cv{i}][xa{i}]"
            ));
            g.push(format!("[cv{i}]fps={}[xv{i}]", job.fps));
            acc += fr.clips[i];
        }
        v = format!("xv{i}");
        a = format!("xa{i}");
    }

    let total = secs(fr.total);
    for (j, o) in job.overlays.iter().enumerate() {
        let start = o.start.max(0.0);
        if start >= total {
            continue;
        }
        let png = overlays.get(j).cloned().unwrap_or_default();
        args.extend([
            "-loop".into(),
            "1".into(),
            "-framerate".into(),
            job.fps.to_string(),
            "-t".into(),
            num(o.end.min(total) + 1.0 / fps),
            "-i".into(),
            png.to_string_lossy().into_owned(),
        ]);
        let ex = overlay_exprs(o, w, h);
        let mut chain = String::from("format=rgba");
        for f in &ex.filters {
            chain.push(',');
            chain.push_str(f);
        }
        g.push(format!("[{input}:v]{chain}[o{j}]"));
        g.push(format!(
            "[{v}][o{j}]overlay=x='{}':y='{}':enable='between(t,{},{})':eval=frame[ov{j}]",
            ex.x,
            ex.y,
            num(o.start),
            num(o.end)
        ));
        v = format!("ov{j}");
        input += 1;
    }
    g.push(format!("[{v}]format=yuv420p[vout]"));
    g.push(format!("[{a}]anull[aout]"));

    let (preset, crf, audio) = match job.quality {
        Quality::High => ("medium", "18", "192k"),
        Quality::Standard => ("medium", "22", "160k"),
        Quality::Small => ("veryfast", "28", "128k"),
    };
    args.extend(
        [
            "-filter_complex_script",
            &graph_file.to_string_lossy(),
            "-map",
            "[vout]",
            "-map",
            "[aout]",
            "-c:v",
            "libx264",
            "-preset",
            preset,
            "-crf",
            crf,
            "-pix_fmt",
            "yuv420p",
            "-r",
            &job.fps.to_string(),
            "-c:a",
            "aac",
            "-b:a",
            audio,
            "-movflags",
            "+faststart",
            "-f",
            "mp4",
            "-y",
            &output.to_string_lossy(),
        ]
        .map(String::from),
    );
    Plan {
        args,
        graph: g.join(";\n"),
        duration: total,
    }
}

/// Runs the export: writes the PNGs and the graph into `work`, ffmpeg into
/// `output` through a ".part.mp4" next to it (a failed or cancelled export
/// never leaves half a file under the real name). `progress(done, total)`
/// in seconds.
pub fn export(
    job: &ExportJob,
    work: &Path,
    output: &Path,
    cancel: &crate::ffmpeg::Cancel,
    mut progress: impl FnMut(f64, f64),
) -> Result<(), crate::ffmpeg::RunError> {
    use crate::ffmpeg::RunError;
    let fail = |e: String| RunError::Failed(e);
    std::fs::create_dir_all(work).map_err(|e| fail(e.to_string()))?;
    let write_png = |name: String, data: &str| -> Result<PathBuf, RunError> {
        let p = work.join(name);
        std::fs::write(&p, png_bytes(data).map_err(fail)?).map_err(|e| fail(e.to_string()))?;
        Ok(p)
    };
    let mut images = Vec::new();
    for (i, c) in job.clips.iter().enumerate() {
        images.push(match &c.source {
            ClipSource::Image { png } => Some(write_png(format!("clip{i}.png"), png)?),
            ClipSource::Video { .. } => None,
        });
    }
    let mut overlays = Vec::new();
    for (j, o) in job.overlays.iter().enumerate() {
        overlays.push(write_png(format!("overlay{j}.png"), &o.png)?);
    }
    let graph = work.join("graph.txt");
    let part = output.with_extension("part.mp4");
    let plan = plan(job, &images, &overlays, &graph, &part);
    std::fs::write(&graph, &plan.graph).map_err(|e| fail(e.to_string()))?;
    let total = plan.duration;
    if let Err(e) = crate::ffmpeg::run(&plan.args, cancel, |done| progress(done.min(total), total))
    {
        let _ = std::fs::remove_file(&part);
        return Err(e);
    }
    std::fs::rename(&part, output)
        .map_err(|e| fail(format!("{} に保存できませんでした: {e}", output.display())))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn video(path: &str, start: f64, duration: f64, t: Option<(&str, f64)>) -> ExportClip {
        ExportClip {
            source: ClipSource::Video {
                path: path.into(),
                start,
                has_audio: true,
                fit: Fit::Contain,
            },
            duration,
            volume: 1.0,
            transition: t.map(|(k, d)| Transition {
                kind: k.into(),
                duration: d,
            }),
        }
    }

    fn job(clips: Vec<ExportClip>, overlays: Vec<ExportOverlay>) -> ExportJob {
        ExportJob {
            width: 1280,
            height: 720,
            fps: 30,
            quality: Quality::Standard,
            clips,
            overlays,
        }
    }

    #[test]
    fn frames_round_and_keep_transitions_inside_clips() {
        let j = job(
            vec![
                video("a", 0.0, 2.0, None),
                video("b", 0.0, 1.0, Some(("fade", 0.5))),
                // Wants 2 s, but b has only 0.5 s left after its own transition.
                video("c", 0.0, 3.0, Some(("fade", 2.0))),
            ],
            vec![],
        );
        let f = frames(&j);
        assert_eq!(f.clips, vec![60, 30, 90]);
        assert_eq!(f.transitions, vec![0, 15, 14]);
        assert_eq!(f.total, 60 + 30 + 90 - 15 - 14);
    }

    #[test]
    fn graph_joins_with_xfade_or_concat() {
        let j = job(
            vec![
                video("a", 1.5, 2.0, None),
                video("b", 0.0, 2.0, Some(("wipeleft", 0.5))),
                video("c", 0.0, 1.0, None),
            ],
            vec![],
        );
        let p = plan(
            &j,
            &[None, None, None],
            &[],
            Path::new("g.txt"),
            Path::new("out.mp4"),
        );
        assert!(
            p.graph
                .contains("[v0][v1]xfade=transition=wipeleft:duration=0.5:offset=1.5[xv1]"),
            "{}",
            p.graph
        );
        assert!(p.graph.contains("[a0][a1]acrossfade=d=0.5[xa1]"));
        assert!(p
            .graph
            .contains("[xv1][xa1][v2][a2]concat=n=2:v=1:a=1[cv2][xa2];\n[cv2]fps=30[xv2]"));
        assert!(p
            .graph
            .ends_with("[xv2]format=yuv420p[vout];\n[xa2]anull[aout]"));
        assert!((p.duration - 4.5).abs() < 1e-9);
        // The first clip is read from 1.5 s.
        assert_eq!(&p.args[..6], ["-ss", "1.5", "-t", "2.066667", "-i", "a"]);
        assert!(p.args.ends_with(&["-y".to_string(), "out.mp4".to_string()]));
    }

    #[test]
    fn overlays_animate_with_expressions() {
        let o = ExportOverlay {
            png: String::new(),
            x: 640.0,
            y: 600.0,
            start: 1.0,
            end: 3.0,
            anim_in: Anim::Pop,
            anim_out: Anim::Slide,
        };
        let ex = overlay_exprs(&o, 1280, 720);
        assert_eq!(ex.filters.len(), 3);
        assert!(
            ex.filters[0].starts_with("scale=w='max(1,iw*(1+2.70158*pow(clip((t-1)/0.4,0,1)-1,3)")
        );
        assert_eq!(ex.filters[1], "fade=t=in:st=1:d=0.133333:alpha=1");
        assert_eq!(ex.filters[2], "fade=t=out:st=2.6:d=0.4:alpha=1");
        assert_eq!(ex.y, "600-overlay_h/2");
        assert_eq!(
            ex.x,
            "640-overlay_w/2+(1-(1-pow(1-clip((3-t)/0.4,0,1),3)))*192"
        );
    }

    #[test]
    fn refuses_what_could_break_the_graph() {
        let mut j = job(
            vec![
                video("Cargo.toml", 0.0, 1.0, None),
                video("Cargo.toml", 0.0, 1.0, Some(("fade;[x]", 0.5))),
            ],
            vec![],
        );
        assert!(validate(&j).unwrap_err().contains("fade;[x]"));
        j.clips[1].transition = None;
        assert!(validate(&j).is_ok());
        j.width = 1281;
        assert!(validate(&j).is_err());
    }

    #[test]
    fn numbers_print_short() {
        assert_eq!(num(1.0), "1");
        assert_eq!(num(0.5), "0.5");
        assert_eq!(num(1.0 / 3.0), "0.333333");
        assert_eq!(num(-0.0000001), "0");
    }
}

//! What the editor makes from a media file, once, into the app's cache
//! folder: a preview copy the window can play (only when it can't play the
//! original), a strip of thumbnails for the timeline, and a waveform.

use crate::ffmpeg::{self, Cancel, Kind, Probe, RunError};
use serde::Serialize;
use std::fs;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};

/// Thumbnails, side by side in one JPEG (src/lib/api.ts `Thumbs`).
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Thumbs {
    pub path: String,
    pub count: u32,
    /// Seconds between two thumbnails.
    pub step: f64,
    /// One thumbnail's size in pixels.
    pub width: u32,
    pub height: u32,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Prepared {
    /// A copy the window can play, when it can't play the original.
    pub proxy: Option<String>,
    pub thumbs: Option<Thumbs>,
    /// The waveform of the whole file, as wide as `duration * WAVE_PX_PER_SEC` (capped).
    pub wave: Option<String>,
}

pub const THUMB_HEIGHT: u32 = 96;
const MAX_THUMBS: u32 = 60;
const WAVE_PX_PER_SEC: f64 = 40.0;
const WAVE_MAX_PX: f64 = 8000.0;
const PROXY_SIZE: u32 = 720;

/// Whether the window plays this as it is. WebView2 (Windows) is Chromium:
/// H.264, VP8/9, AV1 in MP4 or WebM. WKWebView (macOS) adds HEVC but not WebM.
/// 10-bit H.264 plays nowhere. Everything else gets a preview copy; the
/// export always reads the original.
pub fn plays_natively(p: &Probe) -> bool {
    if p.kind != Kind::Video {
        return true;
    }
    let mp4 = p.format.contains("mp4");
    let webm = p.format.contains("webm");
    let ten_bit = p.pixel_format.contains("10") || p.pixel_format.contains("12");
    match p.video_codec.as_str() {
        "h264" => mp4 && !ten_bit,
        "hevc" => mp4 && cfg!(target_os = "macos"),
        "vp8" | "vp9" | "av1" => (mp4 || webm) && !cfg!(target_os = "macos"),
        _ => false,
    }
}

/// The cache folder for one file: by path, size and modification time, so
/// an edited file gets new previews.
pub fn cache_dir(root: &Path, file: &Path) -> PathBuf {
    let mut h = std::collections::hash_map::DefaultHasher::new();
    file.hash(&mut h);
    if let Ok(m) = fs::metadata(file) {
        m.len().hash(&mut h);
        if let Ok(t) = m.modified() {
            t.hash(&mut h);
        }
    }
    root.join(format!("{:016x}", h.finish()))
}

fn s(p: &Path) -> String {
    p.to_string_lossy().into_owned()
}

/// Thumbnails every `step` seconds; at most MAX_THUMBS for the whole file.
pub fn thumb_plan(duration: f64) -> (u32, f64) {
    let step = (duration / MAX_THUMBS as f64).max(1.0);
    let count = ((duration / step).ceil() as u32).clamp(1, MAX_THUMBS);
    (count, step)
}

/// Makes what's missing in `dir` and returns all of it. `progress` gets
/// 0..1 for the preview copy (the slow part).
pub fn prepare(
    file: &Path,
    probe: &Probe,
    dir: &Path,
    force_proxy: bool,
    cancel: &Cancel,
    mut progress: impl FnMut(f64),
) -> Result<Prepared, RunError> {
    let mut out = Prepared::default();
    if probe.kind != Kind::Video {
        return Ok(out);
    }
    fs::create_dir_all(dir).map_err(|e| RunError::Failed(e.to_string()))?;

    // Thumbnails: one input per picture, each seeked to its key frame, so
    // even a long 4K file is quick (nothing in between is decoded).
    let (count, step) = thumb_plan(probe.duration);
    let width = ((THUMB_HEIGHT as f64 * probe.width as f64 / probe.height.max(1) as f64).round()
        as u32)
        .max(2)
        & !1;
    let thumbs = dir.join("thumbs.jpg");
    if !thumbs.is_file() {
        let part = dir.join("thumbs.part.jpg");
        let mut args: Vec<String> = Vec::new();
        let mut graph = Vec::new();
        for i in 0..count {
            let t = (i as f64 * step).min((probe.duration - 0.1).max(0.0));
            args.extend([
                "-noaccurate_seek".into(),
                "-ss".into(),
                format!("{t:.3}"),
                "-i".into(),
                s(file),
            ]);
            graph.push(format!("[{i}:v]trim=end_frame=1,scale={width}:{THUMB_HEIGHT},setsar=1,format=yuvj420p[t{i}]"));
        }
        let labels: String = (0..count).map(|i| format!("[t{i}]")).collect();
        graph.push(if count > 1 {
            format!("{labels}hstack=inputs={count}[out]")
        } else {
            "[t0]null[out]".into()
        });
        args.extend([
            "-filter_complex".into(),
            graph.join(";"),
            "-map".into(),
            "[out]".into(),
            "-frames:v".into(),
            "1".into(),
            "-q:v".into(),
            "5".into(),
            "-y".into(),
            s(&part),
        ]);
        ffmpeg::run(&args, cancel, |_| {})?;
        fs::rename(&part, &thumbs).map_err(|e| RunError::Failed(e.to_string()))?;
    }
    out.thumbs = Some(Thumbs {
        path: s(&thumbs),
        count,
        step,
        width,
        height: THUMB_HEIGHT,
    });

    if probe.has_audio {
        let wave = dir.join("wave.png");
        if !wave.is_file() {
            let part = dir.join("wave.part.png");
            let px = (probe.duration * WAVE_PX_PER_SEC)
                .clamp(64.0, WAVE_MAX_PX)
                .round() as u32;
            let args: Vec<String> = vec![
                "-i".into(),
                s(file),
                "-vn".into(),
                "-filter_complex".into(),
                format!(
                    "aformat=channel_layouts=mono,showwavespic=s={px}x80:colors=#c9d8ff:scale=sqrt"
                ),
                "-frames:v".into(),
                "1".into(),
                "-y".into(),
                s(&part),
            ];
            // A broken audio track only costs the picture.
            match ffmpeg::run(&args, cancel, |_| {}) {
                Ok(()) => fs::rename(&part, &wave).map_err(|e| RunError::Failed(e.to_string()))?,
                Err(RunError::Cancelled) => return Err(RunError::Cancelled),
                Err(e) => log::warn!("waveform of {}: {e}", file.display()),
            }
        }
        if wave.is_file() {
            out.wave = Some(s(&wave));
        }
    }

    if force_proxy || !plays_natively(probe) {
        let proxy = dir.join("preview.mp4");
        if !proxy.is_file() {
            let part = dir.join("preview.part.mp4");
            // Only ever smaller: the long side's short side to PROXY_SIZE.
            let scale = if probe.width >= probe.height {
                format!("scale=-2:'min({PROXY_SIZE},ih)'")
            } else {
                format!("scale='min({PROXY_SIZE},iw)':-2")
            };
            let mut args: Vec<String> = vec!["-i".into(), s(file), "-map".into(), "0:v:0".into()];
            if probe.has_audio {
                args.extend([
                    "-map".into(),
                    "0:a:0".into(),
                    "-c:a".into(),
                    "aac".into(),
                    "-b:a".into(),
                    "128k".into(),
                ]);
            }
            args.extend([
                "-vf".into(),
                format!("{scale},format=yuv420p"),
                "-c:v".into(),
                "libx264".into(),
                "-preset".into(),
                "veryfast".into(),
                "-crf".into(),
                "24".into(),
                // A key frame every half second: seeking while scrubbing stays quick.
                "-g".into(),
                "15".into(),
                "-movflags".into(),
                "+faststart".into(),
                "-y".into(),
                s(&part),
            ]);
            let total = probe.duration.max(0.001);
            ffmpeg::run(&args, cancel, |t| progress((t / total).min(1.0)))?;
            fs::rename(&part, &proxy).map_err(|e| RunError::Failed(e.to_string()))?;
        }
        out.proxy = Some(s(&proxy));
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn video(codec: &str, format: &str, pix: &str) -> Probe {
        Probe {
            kind: Kind::Video,
            duration: 10.0,
            width: 1920,
            height: 1080,
            fps: 30.0,
            has_audio: true,
            format: format.into(),
            video_codec: codec.into(),
            pixel_format: pix.into(),
        }
    }

    #[test]
    fn what_plays_without_a_copy() {
        let mp4 = "mov,mp4,m4a,3gp,3g2,mj2";
        assert!(plays_natively(&video("h264", mp4, "yuv420p")));
        assert!(!plays_natively(&video("h264", mp4, "yuv420p10le")));
        assert!(!plays_natively(&video("h264", "mpegts", "yuv420p")));
        assert!(!plays_natively(&video("prores", mp4, "yuv422p10le")));
        assert_eq!(
            plays_natively(&video("hevc", mp4, "yuv420p")),
            cfg!(target_os = "macos")
        );
        assert_eq!(
            plays_natively(&video("vp9", "matroska,webm", "yuv420p")),
            !cfg!(target_os = "macos")
        );
    }

    #[test]
    fn thumbnails_cover_the_file() {
        assert_eq!(thumb_plan(0.5), (1, 1.0));
        assert_eq!(thumb_plan(10.0), (10, 1.0));
        let (count, step) = thumb_plan(600.0);
        assert_eq!((count, step), (60, 10.0));
    }
}

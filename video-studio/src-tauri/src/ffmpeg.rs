//! The bundled ffmpeg (tauri.conf.json bundle.externalBin): where it is, how
//! to start it, reading what a file holds, and following a long run.

use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

/// The sidecar next to the app's executable (Tauri drops the target triple
/// when it bundles it, and `tauri dev` copies it there too). Tests run from
/// target/<profile>/deps, one folder down. Otherwise the one on PATH.
pub fn binary() -> PathBuf {
    let name = if cfg!(windows) {
        "ffmpeg.exe"
    } else {
        "ffmpeg"
    };
    if let Ok(exe) = std::env::current_exe() {
        for dir in exe.ancestors().skip(1).take(2) {
            let p = dir.join(name);
            if p.is_file() {
                return p;
            }
        }
    }
    PathBuf::from(name)
}

/// ffmpeg with the options every run shares. No console window on Windows.
pub fn command() -> Command {
    let mut c = Command::new(binary());
    c.args(["-hide_banner", "-nostdin"]);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        c.creation_flags(CREATE_NO_WINDOW);
    }
    c
}

/// `ffmpeg -version`'s first line, for the log.
pub fn version() -> Option<String> {
    let out = command().arg("-version").output().ok()?;
    String::from_utf8_lossy(&out.stdout)
        .lines()
        .next()
        .map(str::to_string)
}

// ---------------------------------------------------------------- probe

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Video,
    Image,
    Audio,
}

/// What a file holds, as the editor needs it (src/lib/api.ts `Probe`).
#[derive(Clone, Debug, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Probe {
    pub kind: Kind,
    /// Seconds; 0 for a still image.
    pub duration: f64,
    /// As shown: a phone video recorded upright has its rotation applied.
    pub width: u32,
    pub height: u32,
    pub fps: f64,
    pub has_audio: bool,
    /// "mov,mp4,m4a,3gp,3g2,mj2", "matroska,webm", "image2", "png_pipe"…
    pub format: String,
    /// "h264", "hevc"…; empty without video.
    pub video_codec: String,
    /// "yuv420p", "yuv420p10le"…
    pub pixel_format: String,
}

/// Reads a file's streams. ffmpeg with only an input prints them and exits
/// with an error ("At least one output file must be specified"); that is
/// expected, the listing is what is wanted.
pub fn probe(path: &Path) -> Result<Probe, String> {
    if !path.is_file() {
        return Err(format!("ファイルが見つかりません: {}", path.display()));
    }
    let out = command()
        .arg("-i")
        .arg(path)
        .output()
        .map_err(|e| format!("ffmpeg を起動できませんでした: {e}"))?;
    let text = String::from_utf8_lossy(&out.stderr);
    parse_probe(&text).ok_or_else(|| {
        let last = text
            .lines()
            .rev()
            .find(|l| !l.trim().is_empty())
            .unwrap_or("")
            .trim();
        format!("動画・画像として読めないファイルです（{last}）")
    })
}

fn seconds(hms: &str) -> Option<f64> {
    let mut total = 0.0;
    for part in hms.trim().split(':') {
        total = total * 60.0 + part.parse::<f64>().ok()?;
    }
    Some(total)
}

/// "1920x1080 [SAR 1:1 DAR 16:9]" → (1920, 1080).
fn size(field: &str) -> Option<(u32, u32)> {
    let token = field.split_whitespace().next()?;
    let (w, h) = token.split_once('x')?;
    Some((w.parse().ok()?, h.parse().ok()?))
}

/// Pulled out of ffmpeg's listing. Pure, for the tests.
pub fn parse_probe(text: &str) -> Option<Probe> {
    let mut format = String::new();
    let mut duration = 0.0;
    let mut video: Option<(String, String, u32, u32, f64)> = None;
    let mut rotation = 0.0_f64;
    let mut in_video = false;
    let mut has_audio = false;
    for line in text.lines() {
        let l = line.trim();
        if let Some(rest) = l.strip_prefix("Input #0, ") {
            format = rest.split(", from ").next().unwrap_or("").to_string();
        } else if let Some(rest) = l.strip_prefix("Duration: ") {
            duration = rest.split(',').next().and_then(seconds).unwrap_or(0.0);
        } else if l.starts_with("Stream #0:") {
            in_video = false;
            let Some((_, desc)) = l.split_once(": ") else {
                continue;
            };
            if let Some(v) = desc.strip_prefix("Video: ") {
                // Cover art in a music file is not a picture to edit.
                if video.is_some() || v.contains("(attached pic)") {
                    continue;
                }
                let codec = v.split([' ', ',']).next().unwrap_or("").to_string();
                let fields: Vec<&str> = split_fields(v);
                let pix = fields
                    .get(1)
                    .map(|f| f.split(['(', ' ']).next().unwrap_or("").to_string())
                    .unwrap_or_default();
                let Some((w, h)) = fields.iter().find_map(|f| size(f)) else {
                    continue;
                };
                let fps = fields
                    .iter()
                    .find_map(|f| {
                        f.strip_suffix(" fps")
                            .and_then(|n| n.trim().parse::<f64>().ok())
                    })
                    .or_else(|| {
                        fields.iter().find_map(|f| {
                            f.strip_suffix(" tbr")
                                .and_then(|n| n.trim().parse::<f64>().ok())
                        })
                    })
                    .unwrap_or(30.0);
                video = Some((codec, pix, w, h, fps));
                in_video = true;
            } else if desc.starts_with("Audio: ") {
                has_audio = true;
            }
        } else if in_video && l.starts_with("displaymatrix: rotation of ") {
            rotation = l["displaymatrix: rotation of ".len()..]
                .split_whitespace()
                .next()?
                .parse()
                .unwrap_or(0.0);
        }
    }
    if format.is_empty() {
        return None;
    }
    let still = format == "image2" || format.ends_with("_pipe") || format == "webp_pipe";
    match video {
        Some((codec, pix, w, h, fps)) => {
            let quarter = ((rotation.abs() / 90.0).round() as i64) % 2 == 1;
            let (width, height) = if quarter { (h, w) } else { (w, h) };
            // A GIF that moves is a video; one frame is a picture.
            let kind = if still || duration <= 0.0 {
                Kind::Image
            } else {
                Kind::Video
            };
            Some(Probe {
                kind,
                duration: if kind == Kind::Image { 0.0 } else { duration },
                width,
                height,
                fps: if fps > 0.0 && fps < 1000.0 { fps } else { 30.0 },
                has_audio: kind == Kind::Video && has_audio,
                format,
                video_codec: codec,
                pixel_format: pix,
            })
        }
        None if has_audio && duration > 0.0 => Some(Probe {
            kind: Kind::Audio,
            duration,
            width: 0,
            height: 0,
            fps: 0.0,
            has_audio: true,
            format,
            video_codec: String::new(),
            pixel_format: String::new(),
        }),
        None => None,
    }
}

/// A stream description's fields, split on the commas outside brackets
/// ("yuv420p(tv, bt709, progressive)" stays one).
fn split_fields(s: &str) -> Vec<&str> {
    let mut out = Vec::new();
    let (mut depth, mut start) = (0i32, 0usize);
    for (i, ch) in s.char_indices() {
        match ch {
            '(' | '[' => depth += 1,
            ')' | ']' => depth -= 1,
            ',' if depth == 0 => {
                out.push(s[start..i].trim());
                start = i + 1;
            }
            _ => {}
        }
    }
    out.push(s[start..].trim());
    out
}

// ---------------------------------------------------------------- runs

/// Stops a run from another thread (書き出しの中止).
#[derive(Clone, Default)]
pub struct Cancel(Arc<AtomicBool>);

impl Cancel {
    pub fn cancel(&self) {
        self.0.store(true, Ordering::Release);
    }
    pub fn is_cancelled(&self) -> bool {
        self.0.load(Ordering::Acquire)
    }
    pub fn reset(&self) {
        self.0.store(false, Ordering::Release);
    }
}

/// The ffmpeg processes running now, so the app can stop them when it quits
/// (they are processes of their own and would carry on).
static RUNNING: Mutex<Vec<Arc<Mutex<Child>>>> = Mutex::new(Vec::new());

/// One entry of RUNNING, taken out when dropped.
struct Running(Arc<Mutex<Child>>);

impl Running {
    fn add(child: Child) -> Self {
        let c = Arc::new(Mutex::new(child));
        RUNNING
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .push(c.clone());
        Running(c)
    }
}

impl Drop for Running {
    fn drop(&mut self) {
        RUNNING
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .retain(|c| !Arc::ptr_eq(c, &self.0));
    }
}

/// Stops every ffmpeg the app started (the app is quitting).
pub fn kill_all() {
    let list: Vec<_> = RUNNING.lock().unwrap_or_else(|e| e.into_inner()).clone();
    for c in list {
        if let Ok(mut c) = c.try_lock() {
            let _ = c.kill();
        }
    }
}

#[derive(Debug, PartialEq)]
pub enum RunError {
    Cancelled,
    Failed(String),
}

impl std::fmt::Display for RunError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            RunError::Cancelled => f.write_str("中止しました"),
            RunError::Failed(m) => f.write_str(m),
        }
    }
}

/// Runs ffmpeg with `args` (output and all), calling `progress` with the
/// seconds written so far (`-progress pipe:1`). Ends early on `cancel`.
pub fn run(
    args: &[String],
    cancel: &Cancel,
    mut progress: impl FnMut(f64),
) -> Result<(), RunError> {
    let mut child = command()
        .args(["-v", "error", "-nostats", "-progress", "pipe:1"])
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| RunError::Failed(format!("ffmpeg を起動できませんでした: {e}")))?;

    // stderr in the background, so a chatty ffmpeg never blocks on a full pipe.
    let errors = Arc::new(Mutex::new(String::new()));
    let reader = {
        let errors = errors.clone();
        let mut stderr = child.stderr.take().expect("stderr");
        std::thread::spawn(move || {
            let mut s = String::new();
            let _ = stderr.read_to_string(&mut s);
            *errors.lock().unwrap_or_else(|e| e.into_inner()) = s;
        })
    };

    let stdout = child.stdout.take().expect("stdout");
    let child = Running::add(child);
    for line in BufReader::new(stdout).lines() {
        if cancel.is_cancelled() {
            let _ = child.0.lock().unwrap_or_else(|e| e.into_inner()).kill();
            break;
        }
        let Ok(line) = line else { break };
        if let Some(us) = line.strip_prefix("out_time_us=") {
            if let Ok(us) = us.trim().parse::<i64>() {
                progress(us.max(0) as f64 / 1_000_000.0);
            }
        }
    }
    let status = child
        .0
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .wait()
        .map_err(|e| RunError::Failed(e.to_string()))?;
    drop(child);
    let _ = reader.join();
    if cancel.is_cancelled() {
        return Err(RunError::Cancelled);
    }
    if status.success() {
        return Ok(());
    }
    let text = errors.lock().unwrap_or_else(|e| e.into_inner()).clone();
    let tail = summary(&text);
    log::warn!("ffmpeg failed ({status}): {args:?}\n{text}");
    Err(RunError::Failed(if tail.is_empty() {
        format!("ffmpeg が失敗しました（{status}）")
    } else {
        tail
    }))
}

/// What to show of ffmpeg's errors: the first lines (where it went wrong;
/// the rest is usually the encoders giving up after it) and the last ones.
fn summary(text: &str) -> String {
    let lines: Vec<&str> = text.lines().filter(|l| !l.trim().is_empty()).collect();
    if lines.len() <= 8 {
        return lines.join("\n");
    }
    [&lines[..4], &["…"], &lines[lines.len() - 3..]]
        .concat()
        .join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    const PHONE: &str = r#"Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'IMG_0001.MOV':
  Metadata:
    major_brand     : qt
  Duration: 00:01:02.50, start: 0.000000, bitrate: 15000 kb/s
  Stream #0:0[0x1](und): Video: hevc (Main 10) (hvc1 / 0x31637668), yuv420p10le(tv, bt2020nc/bt2020/arib-std-b67), 1920x1080, 14000 kb/s, 29.97 fps, 29.97 tbr, 600 tbn (default)
      Metadata:
        handler_name    : Core Media Video
      Side data:
        displaymatrix: rotation of -90.00 degrees
  Stream #0:1[0x2](und): Audio: aac (LC) (mp4a / 0x6134706D), 44100 Hz, stereo, fltp, 160 kb/s (default)
At least one output file must be specified"#;

    #[test]
    fn reads_a_phone_video() {
        let p = parse_probe(PHONE).unwrap();
        assert_eq!(p.kind, Kind::Video);
        assert!((p.duration - 62.5).abs() < 1e-9);
        // Recorded upright: shown 1080 wide.
        assert_eq!((p.width, p.height), (1080, 1920));
        assert!((p.fps - 29.97).abs() < 1e-9);
        assert!(p.has_audio);
        assert_eq!(p.video_codec, "hevc");
        assert_eq!(p.pixel_format, "yuv420p10le");
        assert_eq!(p.format, "mov,mp4,m4a,3gp,3g2,mj2");
    }

    #[test]
    fn reads_pictures_and_music() {
        let png = "Input #0, png_pipe, from 'a.png':\n  Duration: N/A, bitrate: N/A\n  Stream #0:0: Video: png, rgba(pc), 640x480, 25 fps, 25 tbr, 25 tbn\n";
        let p = parse_probe(png).unwrap();
        assert_eq!(
            (p.kind, p.width, p.height, p.duration, p.has_audio),
            (Kind::Image, 640, 480, 0.0, false)
        );

        let mp3 = "Input #0, mp3, from 'a.mp3':\n  Duration: 00:03:00.00, start: 0.025057, bitrate: 320 kb/s\n  Stream #0:0: Audio: mp3, 44100 Hz, stereo, fltp, 320 kb/s\n  Stream #0:1: Video: mjpeg (Baseline), yuvj420p(pc, bt470bg/unknown/unknown), 500x500 [SAR 1:1 DAR 1:1], 90k tbr, 90k tbn (attached pic)\n";
        let p = parse_probe(mp3).unwrap();
        assert_eq!((p.kind, p.duration), (Kind::Audio, 180.0));

        assert!(parse_probe("a.txt: Invalid data found when processing input").is_none());
    }

    #[test]
    fn fields_keep_brackets_together() {
        assert_eq!(
            split_fields("h264 (High), yuv420p(tv, bt709), 1280x720 [SAR 1:1 DAR 16:9], 30 fps"),
            vec![
                "h264 (High)",
                "yuv420p(tv, bt709)",
                "1280x720 [SAR 1:1 DAR 16:9]",
                "30 fps"
            ]
        );
    }
}

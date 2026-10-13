//! Commands invoked from the frontend (src/lib/api.ts). All return
//! `Result<_, String>` with a message the user can read.

use crate::ffmpeg::{self, Cancel, Probe, RunError};
use crate::media::{self, Prepared};
use crate::render::{self, ExportJob};
use crate::settings::{self, AppSettings};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Condvar, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, Runtime, State};

pub type CmdResult<T> = Result<T, String>;

pub(crate) fn err(e: impl ToString) -> String {
    e.to_string()
}

fn settings_path<R: Runtime>(app: &AppHandle<R>) -> CmdResult<PathBuf> {
    Ok(settings::path(&app.path().app_config_dir().map_err(err)?))
}

#[tauri::command]
pub fn get_app_settings<R: Runtime>(app: AppHandle<R>) -> CmdResult<AppSettings> {
    Ok(settings::load(&settings_path(&app)?))
}

#[tauri::command]
pub fn set_app_settings<R: Runtime>(
    app: AppHandle<R>,
    settings: AppSettings,
) -> CmdResult<AppSettings> {
    let _guard = settings::LOCK.lock().unwrap_or_else(|e| e.into_inner());
    settings::save(&settings_path(&app)?, &settings)
        .map_err(|e| format!("設定を保存できませんでした: {e}"))?;
    Ok(settings)
}

/// The proxy the OS would use for `url` (PAC included), for the updater
/// (src/lib/update.ts). None = direct.
#[tauri::command]
pub async fn system_proxy(url: String) -> Option<String> {
    tauri::async_runtime::spawn_blocking(move || crate::proxy::for_url(&url))
        .await
        .ok()
        .flatten()
}

/// ヘルプ › ログを表示: the log file in Finder / Explorer.
#[tauri::command]
pub fn reveal_log<R: Runtime>(app: AppHandle<R>) -> CmdResult<()> {
    let dir = app.path().app_log_dir().map_err(err)?;
    let file = dir.join(format!("{}.log", crate::LOG_FILE));
    if file.is_file() {
        tauri_plugin_opener::reveal_item_in_dir(file).map_err(err)
    } else {
        std::fs::create_dir_all(&dir).map_err(err)?;
        tauri_plugin_opener::open_path(dir, None::<&str>).map_err(err)
    }
}

// ---------------------------------------------------------------- state

/// At most this many ffmpeg runs make previews at once; the rest wait.
const PREPARE_AT_ONCE: usize = 2;

#[derive(Default)]
pub struct AppState {
    /// Stops the previews being made (the app is closing).
    pub prepare_cancel: Cancel,
    pub export_cancel: Cancel,
    /// An export is running: one at a time.
    pub exporting: AtomicBool,
    preparing: Mutex<usize>,
    prepared_one: Condvar,
}

/// A place among the PREPARE_AT_ONCE, given back when dropped.
struct Slot<'a>(&'a AppState);

impl<'a> Slot<'a> {
    fn take(state: &'a AppState) -> Self {
        let mut n = state.preparing.lock().unwrap_or_else(|e| e.into_inner());
        while *n >= PREPARE_AT_ONCE {
            n = state
                .prepared_one
                .wait(n)
                .unwrap_or_else(|e| e.into_inner());
        }
        *n += 1;
        Slot(state)
    }
}

impl Drop for Slot<'_> {
    fn drop(&mut self) {
        *self.0.preparing.lock().unwrap_or_else(|e| e.into_inner()) -= 1;
        self.0.prepared_one.notify_one();
    }
}

/// Holds `exporting` for the export's lifetime.
struct Busy<'a>(&'a AtomicBool);

impl<'a> Busy<'a> {
    fn take(flag: &'a AtomicBool) -> CmdResult<Self> {
        if flag.swap(true, Ordering::AcqRel) {
            return Err("書き出しの途中です".into());
        }
        Ok(Busy(flag))
    }
}

impl Drop for Busy<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}

/// Lets the page play the file (convertFileSrc). Only files the user added
/// and the app's own cache are reachable this way (tauri.conf.json:
/// assetProtocol.scope is empty).
fn allow<R: Runtime>(app: &AppHandle<R>, path: &Path) {
    if let Err(e) = app.asset_protocol_scope().allow_file(path) {
        log::warn!("asset scope {}: {e}", path.display());
    }
}

pub fn media_cache_root<R: Runtime>(app: &AppHandle<R>) -> CmdResult<PathBuf> {
    Ok(app.path().app_cache_dir().map_err(err)?.join("media"))
}

async fn blocking<T: Send + 'static>(f: impl FnOnce() -> T + Send + 'static) -> CmdResult<T> {
    tauri::async_runtime::spawn_blocking(f).await.map_err(err)
}

// ---------------------------------------------------------------- media

/// What `path` holds. Also lets the page play it.
#[tauri::command]
pub async fn probe_media<R: Runtime>(app: AppHandle<R>, path: String) -> CmdResult<Probe> {
    let p = PathBuf::from(&path);
    let probe = blocking(move || ffmpeg::probe(&p)).await??;
    if probe.kind == ffmpeg::Kind::Audio {
        return Err("音声だけのファイルは、まだ使えません".into());
    }
    allow(&app, Path::new(&path));
    Ok(probe)
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct MediaProgress {
    id: String,
    ratio: f64,
}

/// Thumbnails, waveform, and a preview copy when the window can't play the
/// file (or `force_proxy`: it tried and failed). Kept in the cache folder.
#[tauri::command]
pub async fn prepare_media<R: Runtime>(
    app: AppHandle<R>,
    id: String,
    path: String,
    force_proxy: bool,
) -> CmdResult<Prepared> {
    let root = media_cache_root(&app)?;
    let app2 = app.clone();
    blocking(move || {
        let state = app2.state::<AppState>();
        let file = PathBuf::from(&path);
        let probe = ffmpeg::probe(&file)?;
        let _slot = Slot::take(&state);
        let dir = media::cache_dir(&root, &file);
        let mut last = Instant::now();
        let result = media::prepare(
            &file,
            &probe,
            &dir,
            force_proxy,
            &state.prepare_cancel,
            |ratio| {
                if last.elapsed() >= Duration::from_millis(250) {
                    last = Instant::now();
                    let _ = app2.emit(
                        "media-progress",
                        MediaProgress {
                            id: id.clone(),
                            ratio,
                        },
                    );
                }
            },
        );
        result.map_err(|e| match e {
            RunError::Cancelled => "中止しました".to_string(),
            RunError::Failed(m) => format!("{}: {m}", file.display()),
        })
    })
    .await?
}

// ---------------------------------------------------------------- export

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ExportProgress {
    /// Seconds of the video written.
    done: f64,
    total: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Exported {
    pub path: String,
    pub elapsed_ms: u64,
}

/// Writes `job` to `output` (an .mp4). Through a ".part.mp4" next to it, so a
/// failed or cancelled export never leaves half a file under the real name.
#[tauri::command]
pub async fn export_video<R: Runtime>(
    app: AppHandle<R>,
    job: ExportJob,
    output: String,
) -> CmdResult<Exported> {
    render::validate(&job)?;
    let work = app
        .path()
        .app_cache_dir()
        .map_err(err)?
        .join(format!("export-{}", std::process::id()));
    let app2 = app.clone();
    blocking(move || {
        let state = app2.state::<AppState>();
        let _busy = Busy::take(&state.exporting)?;
        state.export_cancel.reset();
        let started = Instant::now();
        let output = PathBuf::from(output);
        let result = export_in(&app2, &state.export_cancel, &job, &work, &output);
        let _ = std::fs::remove_dir_all(&work);
        match result {
            Ok(()) => {
                log::info!("exported {} in {:?}", output.display(), started.elapsed());
                Ok(Exported {
                    path: output.to_string_lossy().into_owned(),
                    elapsed_ms: started.elapsed().as_millis() as u64,
                })
            }
            Err(RunError::Cancelled) => Err("中止しました".into()),
            Err(RunError::Failed(m)) => Err(m),
        }
    })
    .await?
}

fn export_in<R: Runtime>(
    app: &AppHandle<R>,
    cancel: &Cancel,
    job: &ExportJob,
    work: &Path,
    output: &Path,
) -> Result<(), RunError> {
    let mut last = Instant::now();
    render::export(job, work, output, cancel, |done, total| {
        if last.elapsed() >= Duration::from_millis(200) {
            last = Instant::now();
            let _ = app.emit("export-progress", ExportProgress { done, total });
        }
    })
}

#[tauri::command]
pub fn cancel_export(state: State<'_, AppState>) {
    state.export_cancel.cancel();
}

// ---------------------------------------------------------------- files

/// The project file's extension (ファイル › 保存).
pub const PROJECT_EXT: &str = "cutter";

fn project_path(path: &str) -> CmdResult<PathBuf> {
    let p = PathBuf::from(path);
    if p.extension().and_then(|e| e.to_str()) != Some(PROJECT_EXT) {
        return Err(format!(
            "プロジェクトのファイル（.{PROJECT_EXT}）ではありません"
        ));
    }
    Ok(p)
}

/// Saved through a temporary file, so a crash mid-write keeps the old one.
#[tauri::command]
pub fn save_project(path: String, text: String) -> CmdResult<()> {
    let p = project_path(&path)?;
    let tmp = p.with_extension(format!("{PROJECT_EXT}.tmp"));
    std::fs::write(&tmp, text).map_err(|e| format!("保存できませんでした: {e}"))?;
    std::fs::rename(&tmp, &p).map_err(|e| format!("保存できませんでした: {e}"))
}

#[tauri::command]
pub fn load_project(path: String) -> CmdResult<String> {
    std::fs::read_to_string(project_path(&path)?).map_err(|e| format!("開けませんでした: {e}"))
}

/// A picture's bytes, for the page to draw (the preview and the export's
/// PNG). Read through here, not the asset protocol, so the page's canvas
/// stays readable. Only files the user added (`probe_media`).
#[tauri::command]
pub async fn read_image<R: Runtime>(
    app: AppHandle<R>,
    path: String,
) -> CmdResult<tauri::ipc::Response> {
    if !app.asset_protocol_scope().is_allowed(&path) {
        return Err(format!("追加していないファイルです: {path}"));
    }
    let bytes = blocking(move || std::fs::read(&path))
        .await?
        .map_err(|e| format!("画像を読めませんでした: {e}"))?;
    Ok(tauri::ipc::Response::new(bytes))
}

#[tauri::command]
pub fn reveal_path(path: String) -> CmdResult<()> {
    tauri_plugin_opener::reveal_item_in_dir(path).map_err(err)
}

/// ffmpeg's version line, or why it can't run.
#[tauri::command]
pub async fn ffmpeg_version() -> CmdResult<String> {
    blocking(|| {
        ffmpeg::version().ok_or_else(|| {
            format!(
                "ffmpeg を起動できませんでした（{}）",
                ffmpeg::binary().display()
            )
        })
    })
    .await?
}

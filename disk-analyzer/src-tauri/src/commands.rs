//! Commands invoked from the frontend (src/lib/api.ts). All return
//! `Result<_, String>` with a message the user can read.

use crate::places::{self, Kind, Place, Space};
use crate::scan::{self, Notes, Scan, Tree};
use crate::settings::{self, AppSettings};
use crate::view::{self, Folder, ViewNode};
use serde::Serialize;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, RwLock};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, Runtime, State};

pub type CmdResult<T> = Result<T, String>;

pub(crate) fn err(e: impl ToString) -> String {
    e.to_string()
}

fn settings_path<R: Runtime>(app: &AppHandle<R>) -> CmdResult<std::path::PathBuf> {
    Ok(settings::path(&app.path().app_config_dir().map_err(err)?))
}

#[tauri::command]
pub fn get_app_settings<R: Runtime>(app: AppHandle<R>) -> CmdResult<AppSettings> {
    Ok(settings::load(&settings_path(&app)?))
}

#[tauri::command]
pub fn set_app_settings<R: Runtime>(app: AppHandle<R>, settings: AppSettings) -> CmdResult<AppSettings> {
    let _guard = settings::LOCK.lock().unwrap_or_else(|e| e.into_inner());
    settings::save(&settings_path(&app)?, &settings).map_err(|e| format!("設定を保存できませんでした: {e}"))?;
    Ok(settings)
}

/// The proxy the OS would use for `url` (PAC included), for the updater
/// (src/lib/update.ts). None = direct.
#[tauri::command]
pub async fn system_proxy(url: String) -> Option<String> {
    tauri::async_runtime::spawn_blocking(move || crate::proxy::for_url(&url)).await.ok().flatten()
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

// ---------------------------------------------------------------- scan

/// The last scan. The tree lives here; the frontend asks for the parts it
/// draws (Platform Stack: 状態管理).
#[derive(Default)]
pub struct AppState {
    pub tree: RwLock<Option<Arc<Tree>>>,
    /// Set by `cancel_scan`; the scan stops at its next folder.
    pub cancel: AtomicBool,
    /// A scan is running: one at a time.
    pub busy: AtomicBool,
}

impl AppState {
    fn tree(&self) -> CmdResult<Arc<Tree>> {
        self.tree.read().map_err(err)?.clone().ok_or_else(|| "スキャンした結果がありません".into())
    }
}

/// Holds `busy` for the scan's lifetime.
struct Busy<'a>(&'a AtomicBool);
impl<'a> Busy<'a> {
    fn take(flag: &'a AtomicBool) -> CmdResult<Self> {
        if flag.swap(true, Ordering::AcqRel) {
            return Err("スキャンが終わるまでお待ちください".into());
        }
        Ok(Self(flag))
    }
}
impl Drop for Busy<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}

/// The drives for the start screen, then the home folder.
#[tauri::command]
pub async fn list_places<R: Runtime>(app: AppHandle<R>) -> CmdResult<Vec<Place>> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut out = places::list();
        if let Ok(home) = app.path().home_dir() {
            out.push(Place {
                space: places::space(&home),
                path: home.display().to_string(),
                label: String::new(),
                kind: Kind::Home,
            });
        }
        out
    })
    .await
    .map_err(err)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanSummary {
    pub path: String,
    pub network: bool,
    pub files: u64,
    pub dirs: u64,
    pub bytes: u64,
    pub cancelled: bool,
    pub elapsed_ms: u64,
    #[serde(flatten)]
    pub notes: Notes,
    /// The volume the folder is on.
    pub space: Option<Space>,
}

/// Threads for one scan. Reading a folder mostly waits (on the disk, on
/// the network), so more threads than cores pay off.
fn threads() -> usize {
    std::thread::available_parallelism().map_or(4, |n| n.get()).clamp(4, 16) * 2
}

/// Reads `path` and everything under it (docs/SPEC.md §3). `scan-progress`
/// reports the counts a few times a second. A cancelled scan keeps the
/// result there was before.
#[tauri::command]
pub async fn scan_folder<R: Runtime>(app: AppHandle<R>, path: String) -> CmdResult<ScanSummary> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let _busy = Busy::take(&state.busy)?;
        state.cancel.store(false, Ordering::Relaxed);
        let root = PathBuf::from(&path);
        let started = Instant::now();
        let network = crate::volume::is_network(&root);
        log::info!("スキャン開始: {path}{}", if network { "（ネットワーク）" } else { "" });

        let s = Scan::new(&root, &state.cancel);
        let done = AtomicBool::new(false);
        let pool = rayon::ThreadPoolBuilder::new().num_threads(threads()).build().map_err(err)?;
        let tree = std::thread::scope(|scope| {
            scope.spawn(|| {
                while !done.load(Ordering::Relaxed) {
                    let _ = app.emit("scan-progress", s.counts());
                    std::thread::sleep(Duration::from_millis(150));
                }
            });
            let tree = pool.install(|| scan::scan(&root, &s));
            done.store(true, Ordering::Relaxed);
            tree
        })?;

        let counts = s.counts();
        let notes = s.notes();
        let cancelled = s.cancelled();
        let elapsed_ms = started.elapsed().as_millis() as u64;
        if cancelled {
            log::info!("スキャンを中止しました: {path}");
        } else {
            log::info!(
                "スキャン完了: {path}: {} ファイル, {} フォルダ, {} バイト, {} ms, 読めないフォルダ {}",
                counts.files,
                counts.dirs,
                counts.bytes,
                elapsed_ms,
                notes.unreadable
            );
            for e in &notes.errors {
                log::warn!("読めませんでした: {e}");
            }
            *state.tree.write().map_err(err)? = Some(Arc::new(tree));
        }
        Ok(ScanSummary {
            path,
            network,
            files: counts.files,
            dirs: counts.dirs,
            bytes: counts.bytes,
            cancelled,
            elapsed_ms,
            notes,
            space: places::space(&root),
        })
    })
    .await
    .map_err(err)?
}

#[tauri::command]
pub fn cancel_scan(state: State<AppState>) {
    state.cancel.store(true, Ordering::Relaxed);
}

/// Back to the start screen: the tree is let go.
#[tauri::command]
pub fn close_scan(state: State<AppState>) -> CmdResult<()> {
    *state.tree.write().map_err(err)? = None;
    Ok(())
}

/// What a chart draws under `id` (view.rs).
#[tauri::command]
pub async fn view_tree<R: Runtime>(app: AppHandle<R>, id: u32, depth: u32, min_share: f64) -> CmdResult<ViewNode> {
    let tree = app.state::<AppState>().tree()?;
    tauri::async_runtime::spawn_blocking(move || {
        view::view(&tree, id, depth, min_share).ok_or_else(|| "その項目はもうありません".to_string())
    })
    .await
    .map_err(err)?
}

/// One folder for the list (view.rs).
#[tauri::command]
pub async fn folder_info<R: Runtime>(app: AppHandle<R>, id: u32, limit: usize) -> CmdResult<Folder> {
    let tree = app.state::<AppState>().tree()?;
    tauri::async_runtime::spawn_blocking(move || {
        view::folder(&tree, id, limit).ok_or_else(|| "その項目はもうありません".to_string())
    })
    .await
    .map_err(err)?
}

fn path_of(state: &AppState, id: u32) -> CmdResult<PathBuf> {
    let tree = state.tree()?;
    tree.get(id).ok_or("その項目はもうありません")?;
    Ok(tree.path_of(id))
}

/// The item's full path (パスをコピー).
#[tauri::command]
pub fn item_path(state: State<AppState>, id: u32) -> CmdResult<String> {
    Ok(path_of(&state, id)?.display().to_string())
}

/// Shows the item in Explorer / Finder. The app itself never deletes or
/// moves anything (docs/SPEC.md §1); that is done there.
#[tauri::command]
pub fn reveal_item(state: State<AppState>, id: u32) -> CmdResult<()> {
    let path = path_of(&state, id)?;
    if !path.exists() {
        return Err(format!("{} は見つかりません（スキャンのあとで移動か削除された）", path.display()));
    }
    tauri_plugin_opener::reveal_item_in_dir(&path)
        .map_err(|e| format!("{} を表示できませんでした: {e}", path.display()))
}

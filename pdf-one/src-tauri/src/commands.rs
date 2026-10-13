//! Commands invoked from the frontend (src/lib/api.ts). All return
//! `Result<_, String>` with a message the user can read.

use crate::files;
use crate::pdf::compose::{self, FormEntry, PageSpec};
use crate::pdf::image::{read_image, ImageStore};
use crate::pdf::open::{open_bytes, PageAnnot};
use crate::settings::{self, AppSettings};
use lopdf::Document;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use tauri::ipc::{InvokeBody, Request, Response};
use tauri::{AppHandle, Manager, Runtime, State};

pub type CmdResult<T> = Result<T, String>;

pub(crate) fn err(e: impl ToString) -> String {
    e.to_string()
}

/// Files larger than this aren't opened (they are read into memory whole,
/// twice: here and in pdf.js).
const MAX_PDF: u64 = 1024 * 1024 * 1024;

#[derive(Default)]
pub struct AppState {
    next: AtomicU32,
    /// The opened documents saving starts from (open.rs), by id.
    docs: Mutex<HashMap<u32, Arc<Document>>>,
    /// What pdf.js is to show, until it has fetched it (`pdf_view_bytes`).
    views: Mutex<HashMap<u32, Vec<u8>>>,
    images: Mutex<ImageStore>,
    /// Files the OS asked us to open (double-click, "Open with"), until the
    /// frontend takes them.
    pending: Mutex<Vec<String>>,
}

impl AppState {
    pub fn queue_open(&self, paths: impl IntoIterator<Item = String>) {
        let mut p = self.pending.lock().unwrap_or_else(|e| e.into_inner());
        p.extend(paths);
    }
}

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

fn settings_path<R: Runtime>(app: &AppHandle<R>) -> CmdResult<PathBuf> {
    Ok(settings::path(&app.path().app_config_dir().map_err(err)?))
}

fn data_dir<R: Runtime>(app: &AppHandle<R>, sub: &str) -> CmdResult<PathBuf> {
    Ok(app.path().app_data_dir().map_err(err)?.join(sub))
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

fn remember_recent<R: Runtime>(app: &AppHandle<R>, path: &str) {
    let _guard = settings::LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let Ok(p) = settings_path(app) else { return };
    let mut s = settings::load(&p);
    s.remember(path);
    if let Err(e) = settings::save(&p, &s) {
        log::warn!("最近使ったファイルを保存できません: {e}");
    }
}

/// The name written on annotations when the settings leave it empty.
#[tauri::command]
pub fn os_user_name() -> String {
    std::env::var("USERNAME").or_else(|_| std::env::var("USER")).unwrap_or_default()
}

/// The CSS family of the font typed text is embedded in (font.rs), so the
/// screen shows the same letters as the file. None: no Japanese font found.
#[tauri::command]
pub fn text_font_family() -> Option<String> {
    crate::pdf::font::system_font().map(|f| f.family.clone())
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

/// ファイル › バックアップのフォルダを開く.
#[tauri::command]
pub fn reveal_backups<R: Runtime>(app: AppHandle<R>) -> CmdResult<()> {
    let dir = data_dir(&app, "backups")?;
    std::fs::create_dir_all(&dir).map_err(err)?;
    tauri_plugin_opener::open_path(dir, None::<&str>).map_err(err)
}

/// A saved file in Finder / Explorer.
#[tauri::command]
pub fn reveal_file(path: String) -> CmdResult<()> {
    tauri_plugin_opener::reveal_item_in_dir(path).map_err(err)
}

/// Files the OS asked us to open since the last call.
#[tauri::command]
pub fn take_open_requests(state: State<'_, AppState>) -> Vec<String> {
    std::mem::take(&mut *lock(&state.pending))
}

// ------------------------------------------------------------------ PDF

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenedPdf {
    pub id: u32,
    pub path: String,
    pub name: String,
    pub size: u64,
    /// Why it can only be viewed; None when it can be edited.
    pub read_only: Option<String>,
    /// It has a digital signature, which saving would break.
    pub signed: bool,
    /// The annotations taken off the pages for editing.
    pub annots: Vec<PageAnnot>,
}

fn read_pdf(path: &Path) -> CmdResult<Vec<u8>> {
    let meta = std::fs::metadata(path).map_err(|e| format!("ファイルを開けませんでした: {e}"))?;
    if !meta.is_file() {
        return Err("ファイルではありません".into());
    }
    if meta.len() > MAX_PDF {
        return Err("1 GB を超える PDF は開けません".into());
    }
    std::fs::read(path).map_err(|e| format!("ファイルを読めませんでした: {e}"))
}

/// Opens a PDF: for viewing and editing, or for its pages to be inserted
/// into another document (the same thing here).
#[tauri::command]
pub async fn open_pdf<R: Runtime>(app: AppHandle<R>, path: String) -> CmdResult<OpenedPdf> {
    let state = app.state::<AppState>();
    let file = PathBuf::from(&path);
    let started = std::time::Instant::now();
    let (opened, size) = {
        let app = app.clone();
        tauri::async_runtime::spawn_blocking(move || -> CmdResult<_> {
            let bytes = read_pdf(&file)?;
            let size = bytes.len() as u64;
            let mut images = ImageStore::default();
            let opened = open_bytes(bytes, &mut images)?;
            lock(&app.state::<AppState>().images).merge(images);
            Ok((opened, size))
        })
        .await
        .map_err(err)??
    };
    let id = state.next.fetch_add(1, Ordering::Relaxed) + 1;
    if let Some(doc) = opened.doc {
        lock(&state.docs).insert(id, Arc::new(doc));
    }
    lock(&state.views).insert(id, opened.view_bytes);
    log::info!(
        "開きました: {path}（{size} バイト、注釈 {} 件、{} ms{}）",
        opened.annots.len(),
        started.elapsed().as_millis(),
        if opened.read_only.is_some() { "、表示のみ" } else { "" }
    );
    remember_recent(&app, &path);
    let name = Path::new(&path).file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    Ok(OpenedPdf { id, path, name, size, read_only: opened.read_only, signed: opened.signed, annots: opened.annots })
}

/// The bytes pdf.js loads for document `id`; handed over once.
#[tauri::command]
pub fn pdf_view_bytes(state: State<'_, AppState>, id: u32) -> CmdResult<Response> {
    let bytes = lock(&state.views).remove(&id).ok_or("PDF がもう閉じられています")?;
    Ok(Response::new(bytes))
}

#[tauri::command]
pub fn close_pdf(state: State<'_, AppState>, id: u32) {
    lock(&state.docs).remove(&id);
    lock(&state.views).remove(&id);
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveRequest {
    pub path: String,
    pub pages: Vec<PageSpec>,
    #[serde(default)]
    pub forms: Vec<FormEntry>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Saved {
    pub path: String,
    pub size: u64,
    /// The previous file, kept before it was overwritten.
    pub backup: Option<String>,
}

/// The file as it would be saved, as bytes: the pages in order with the
/// annotations and form values written in. Heavy, so on another thread.
async fn compose_bytes<R: Runtime>(
    app: &AppHandle<R>,
    pages: Vec<PageSpec>,
    forms: Vec<FormEntry>,
) -> CmdResult<Vec<u8>> {
    let state = app.state::<AppState>();
    let sources = lock(&state.docs).clone();
    for p in &pages {
        if let Some(s) = p.source {
            if !sources.contains_key(&s) {
                return Err("表示だけの PDF のページは保存できません".into());
            }
        }
    }
    // A copy of the store (pictures are shared, not copied), so pictures
    // can still be shown while the file is written.
    let images = lock(&state.images).clone();
    tauri::async_runtime::spawn_blocking(move || {
        compose::compose(compose::Input {
            sources: &sources,
            pages: &pages,
            forms: &forms,
            font: crate::pdf::font::system_font(),
            images: &images,
        })
    })
    .await
    .map_err(err)?
}

/// Writes the pages and edits to `path`. An existing file there is copied
/// to the backups first (docs/SPEC.md「保存」).
#[tauri::command]
pub async fn save_pdf<R: Runtime>(app: AppHandle<R>, request: SaveRequest) -> CmdResult<Saved> {
    let target = PathBuf::from(&request.path);
    if target.extension().map(|e| e.to_ascii_lowercase()) != Some("pdf".into()) {
        return Err("保存するファイルの名前は .pdf で終わるようにしてください".into());
    }
    let backups = data_dir(&app, "backups")?;
    let started = std::time::Instant::now();
    let bytes = compose_bytes(&app, request.pages, request.forms).await?;
    let path = request.path;
    let saved = tauri::async_runtime::spawn_blocking(move || -> CmdResult<Saved> {
        let backup = if target.is_file() { Some(files::backup(&target, &backups)?) } else { None };
        files::write_atomic(&target, &bytes)?;
        Ok(Saved { path, size: bytes.len() as u64, backup: backup.map(|b| b.to_string_lossy().into_owned()) })
    })
    .await
    .map_err(err)??;
    log::info!("保存しました: {}（{} バイト、{} ms）", saved.path, saved.size, started.elapsed().as_millis());
    remember_recent(&app, &saved.path);
    Ok(saved)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComposeRequest {
    pub pages: Vec<PageSpec>,
    #[serde(default)]
    pub forms: Vec<FormEntry>,
}

/// The file as it would be saved, without saving it: for printing
/// (src/lib/print.ts draws it with pdf.js, annotations and all).
#[tauri::command]
pub async fn compose_pdf<R: Runtime>(app: AppHandle<R>, request: ComposeRequest) -> CmdResult<Response> {
    let bytes = compose_bytes(&app, request.pages, request.forms).await?;
    Ok(Response::new(bytes))
}

// --------------------------------------------------------------- images

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageInfo {
    pub id: u32,
    pub width: u32,
    pub height: u32,
}

fn store_image(state: &AppState, bytes: Vec<u8>) -> CmdResult<ImageInfo> {
    let img = read_image(bytes)?;
    let (width, height) = (img.width, img.height);
    let id = lock(&state.images).add(img);
    Ok(ImageInfo { id, width, height })
}

fn read_small(path: &Path) -> CmdResult<Vec<u8>> {
    let len = std::fs::metadata(path).map_err(|e| format!("画像を開けませんでした: {e}"))?.len();
    if len > crate::pdf::image::MAX_FILE as u64 {
        return Err("画像が大きすぎます（40 MB まで）".into());
    }
    std::fs::read(path).map_err(|e| format!("画像を読めませんでした: {e}"))
}

/// A picture file to put on a page.
#[tauri::command]
pub async fn add_image<R: Runtime>(app: AppHandle<R>, path: String) -> CmdResult<ImageInfo> {
    tauri::async_runtime::spawn_blocking(move || store_image(&app.state::<AppState>(), read_small(Path::new(&path))?))
        .await
        .map_err(err)?
}

/// A pasted picture (the clipboard), sent as raw bytes.
#[tauri::command]
pub fn add_image_bytes(state: State<'_, AppState>, request: Request<'_>) -> CmdResult<ImageInfo> {
    match request.body() {
        InvokeBody::Raw(bytes) => store_image(&state, bytes.clone()),
        InvokeBody::Json(_) => Err("画像のデータがありません".into()),
    }
}

/// A stored picture's file, for the screen.
#[tauri::command]
pub fn image_bytes(state: State<'_, AppState>, id: u32) -> CmdResult<Response> {
    let img = lock(&state.images).get(id).ok_or("画像が見つかりません")?;
    Ok(Response::new(img.bytes.clone()))
}

#[tauri::command]
pub fn list_stamps<R: Runtime>(app: AppHandle<R>) -> CmdResult<Vec<files::Stamp>> {
    Ok(files::list_stamps(&data_dir(&app, "stamps")?))
}

/// Keeps a picture in the stamp library, for use in any document.
#[tauri::command]
pub fn add_stamp<R: Runtime>(app: AppHandle<R>, path: String) -> CmdResult<files::Stamp> {
    let file = Path::new(&path);
    let bytes = read_small(file)?;
    let img = read_image(bytes)?;
    let name = file.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
    files::add_stamp(&data_dir(&app, "stamps")?, &name, &img.bytes, img.mime)
}

/// A picture drawn in the app (a signature), sent as PNG bytes, into the library.
#[tauri::command]
pub fn add_stamp_bytes<R: Runtime>(app: AppHandle<R>, request: Request<'_>) -> CmdResult<files::Stamp> {
    let bytes = match request.body() {
        InvokeBody::Raw(bytes) => bytes.clone(),
        InvokeBody::Json(_) => return Err("画像のデータがありません".into()),
    };
    let img = read_image(bytes)?;
    files::add_stamp(&data_dir(&app, "stamps")?, "署名", &img.bytes, img.mime)
}

#[tauri::command]
pub fn remove_stamp<R: Runtime>(app: AppHandle<R>, id: String) -> CmdResult<()> {
    let p = files::stamp_path(&data_dir(&app, "stamps")?, &id)?;
    std::fs::remove_file(p).map_err(|e| format!("スタンプを消せませんでした: {e}"))
}

/// A library picture into the image store, to be put on a page.
#[tauri::command]
pub fn use_stamp<R: Runtime>(app: AppHandle<R>, id: String) -> CmdResult<ImageInfo> {
    let p = files::stamp_path(&data_dir(&app, "stamps")?, &id)?;
    store_image(&app.state::<AppState>(), read_small(&p)?)
}

// --------------------------------------------------------------- drafts

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DraftRequest {
    /// The file the tab was opened from (names the draft).
    pub path: String,
    /// The tab's state (src/lib/drafts.ts).
    pub json: String,
    /// The pictures the state refers to (image store ids).
    #[serde(default)]
    pub images: Vec<u32>,
}

/// Writes a tab's draft (docs/SPEC.md「下書き」). Returns its id.
#[tauri::command]
pub fn write_draft<R: Runtime>(app: AppHandle<R>, request: DraftRequest) -> CmdResult<String> {
    let dir = data_dir(&app, "drafts")?;
    let state = app.state::<AppState>();
    let images: Vec<(u32, Arc<crate::pdf::image::StoredImage>)> = {
        let store = lock(&state.images);
        request.images.iter().filter_map(|&id| store.get(id).map(|img| (id, img))).collect()
    };
    let refs: Vec<(u32, &[u8], &str)> = images
        .iter()
        .map(|(id, img)| (*id, img.bytes.as_slice(), if img.mime == "image/png" { "png" } else { "jpg" }))
        .collect();
    files::write_draft(&dir, &request.path, &request.json, &refs)
}

#[tauri::command]
pub fn list_drafts<R: Runtime>(app: AppHandle<R>) -> CmdResult<Vec<files::Draft>> {
    Ok(files::list_drafts(&data_dir(&app, "drafts")?))
}

#[tauri::command]
pub fn remove_draft<R: Runtime>(app: AppHandle<R>, id: String) -> CmdResult<()> {
    files::remove_draft(&data_dir(&app, "drafts")?, &id)
}

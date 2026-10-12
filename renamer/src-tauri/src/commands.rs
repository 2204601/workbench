//! Commands invoked from the frontend (src/lib/api.ts). All return
//! `Result<_, String>` with a message the user can read.

use crate::execute::{self, Outcome, RealFs, Run, UndoReport};
use crate::journal::{self, End, Journal};
use crate::plan::{self, Move, Stage};
use crate::preview::{self, Listing, Query, Status};
use crate::scan::{FileSet, Progress, ScanSummary};
use crate::settings::{self, AppSettings};
use serde::Serialize;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
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

// ---------------------------------------------------------------- files

/// What the window works on. The file list lives here; the frontend keeps
/// only the last listing it asked for (Platform Stack: 状態管理).
#[derive(Default)]
pub struct AppState {
    pub files: Mutex<FileSet>,
    /// Set by `cancel_task`; the running task stops at its next check.
    pub cancel: AtomicBool,
    /// A long task (reading, renaming) is running: one at a time.
    pub busy: AtomicBool,
    /// A run stopped by a failure or the user, waiting for what to do next.
    pub run: Mutex<Option<Run>>,
}

/// Holds `busy` for the task's lifetime.
struct Busy<'a>(&'a AtomicBool);
impl<'a> Busy<'a> {
    fn take(flag: &'a AtomicBool) -> CmdResult<Self> {
        if flag.swap(true, Ordering::AcqRel) {
            return Err("ほかの処理が終わるまでお待ちください".into());
        }
        Ok(Self(flag))
    }
}
impl Drop for Busy<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}

/// `{ done, total }` events a few times a second, and the cancel flag.
struct Reporter<'a, R: Runtime> {
    app: &'a AppHandle<R>,
    event: &'static str,
    total: Option<usize>,
    cancel: &'a AtomicBool,
    last: Mutex<Instant>,
}
impl<'a, R: Runtime> Reporter<'a, R> {
    fn new(app: &'a AppHandle<R>, event: &'static str, total: Option<usize>, cancel: &'a AtomicBool) -> Self {
        cancel.store(false, Ordering::Relaxed);
        Self { app, event, total, cancel, last: Mutex::new(Instant::now()) }
    }
}
impl<R: Runtime> Progress for Reporter<'_, R> {
    fn tick(&self, done: usize) -> bool {
        let mut last = self.last.lock().unwrap_or_else(|e| e.into_inner());
        if last.elapsed() >= Duration::from_millis(150) {
            *last = Instant::now();
            let _ = self.app.emit(self.event, serde_json::json!({ "done": done, "total": self.total }));
        }
        !self.cancel.load(Ordering::Relaxed)
    }
}

/// Reads folders / files into the list (docs/SPEC.md §4). `replace` starts
/// a new list; None (a drop) does when a folder is among `paths`. Runs off
/// the main thread; `scan-progress` reports how many names were looked at.
#[tauri::command]
pub async fn add_paths<R: Runtime>(
    app: AppHandle<R>,
    paths: Vec<String>,
    replace: Option<bool>,
    include_hidden: bool,
) -> CmdResult<ScanSummary> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let _busy = Busy::take(&state.busy)?;
        // Read into a copy, so listing the current files isn't held up meanwhile.
        let paths: Vec<PathBuf> = paths.into_iter().map(PathBuf::from).collect();
        let replace = replace.unwrap_or_else(|| paths.iter().any(|p| p.is_dir()));
        let mut set = if replace { FileSet::default() } else { state.files.lock().map_err(err)?.clone() };
        let reporter = Reporter::new(&app, "scan-progress", None, &state.cancel);
        let mut summary = set.add(&paths, include_hidden, &reporter);
        summary.replaced = replace && !summary.cancelled;
        for f in &summary.failed {
            log::warn!("読み込めませんでした: {f}");
        }
        // Cancelled: what was there before stays.
        if !summary.cancelled {
            *state.files.lock().map_err(err)? = set;
        }
        Ok(summary)
    })
    .await
    .map_err(err)?
}

#[tauri::command]
pub fn clear_files(state: State<AppState>) -> CmdResult<()> {
    state.files.lock().map_err(err)?.clear();
    Ok(())
}

/// The list as the window shows it (docs/SPEC.md §6).
#[tauri::command]
pub async fn list_files<R: Runtime>(app: AppHandle<R>, query: Query) -> CmdResult<Listing> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let set = state.files.lock().map_err(err)?;
        Ok(preview::listing(&set, &query))
    })
    .await
    .map_err(err)?
}

#[tauri::command]
pub fn cancel_task(state: State<AppState>) {
    state.cancel.store(true, Ordering::Relaxed);
}

// ---------------------------------------------------------------- rename

fn journal_path<R: Runtime>(app: &AppHandle<R>) -> CmdResult<PathBuf> {
    Ok(journal::path(&app.path().app_data_dir().map_err(err)?))
}

/// Brings the list up to date with what the journal did: each file under
/// its new name if that step stands, under its old one otherwise.
fn sync_files(set: &mut FileSet, j: &Journal) {
    let mut seen = std::collections::HashSet::new();
    for (i, step) in j.steps.iter().enumerate().rev() {
        if !step.is_final() || !seen.insert(step.item) {
            continue;
        }
        let original = &j.steps.iter().find(|s| s.item == step.item).expect("first step").from;
        if j.done[i] && !j.undone[i] {
            set.moved(original, &step.to);
        } else {
            set.moved(&step.to, original);
        }
    }
}

fn log_outcome(o: &Outcome) {
    match o {
        Outcome::Completed { renamed, .. } => log::info!("{renamed} 件の名前を変更しました"),
        Outcome::Stopped { renamed, remaining, failure, .. } => match failure {
            Some(f) => log::warn!(
                "{renamed} 件で止まりました（残り {remaining} 件）: {}/{} → {}: {}",
                f.folder,
                f.name,
                f.new_name,
                f.reason
            ),
            None => log::info!("{renamed} 件で中止しました（残り {remaining} 件）"),
        },
    }
}

/// Renames what the list shows with this query (docs/SPEC.md §7). Refused
/// while any row has a problem. A failure or a cancel stops the run and
/// keeps it for `resume_rename` / `finish_rename` / `undo_rename`.
#[tauri::command]
pub async fn run_rename<R: Runtime>(app: AppHandle<R>, query: Query) -> CmdResult<Outcome> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let _busy = Busy::take(&state.busy)?;
        if state.run.lock().map_err(err)?.is_some() {
            return Err("止まっている変更があります。続けるか終えるかを選んでください".into());
        }
        let set = state.files.lock().map_err(err)?.clone();
        let listing = preview::listing(&set, &query);
        if let Some(e) = listing.rule_error {
            return Err(e);
        }
        if listing.summary.errors > 0 {
            return Err("問題のある行があります。解消してから実行してください".into());
        }
        let moves: Vec<Move> = listing
            .rows
            .iter()
            .filter(|r| r.checked && matches!(r.status, Status::Change | Status::Warn))
            .map(|r| {
                let dir = PathBuf::from(&r.dir);
                Move { from: dir.join(&r.name), to: dir.join(&r.new_name), size: r.size, modified: r.modified }
            })
            .collect();
        if moves.is_empty() {
            return Err("名前の変わる行がありません".into());
        }
        let steps = plan::plan(&moves, &mut |p| plan::temp_name(p, &uuid::Uuid::new_v4().simple().to_string()[..8]));
        let total = moves.len();
        let journal = Journal::create(&journal_path(&app)?, steps)
            .map_err(|e| format!("変更の記録を作れませんでした（{e}）。何も変更していません"))?;
        log::info!("{total} 件の名前を変更します（記録 {}）", journal.path().display());
        let mut run = Run::new(journal);
        let reporter = Reporter::new(&app, "run-progress", Some(total), &state.cancel);
        let outcome = run.go(&RealFs, false, &reporter);
        log_outcome(&outcome);
        sync_files(&mut *state.files.lock().map_err(err)?, &run.journal);
        if matches!(outcome, Outcome::Stopped { .. }) {
            *state.run.lock().map_err(err)? = Some(run);
        }
        Ok(outcome)
    })
    .await
    .map_err(err)?
}

/// Goes on with a stopped run; `skip` leaves out the file that failed.
#[tauri::command]
pub async fn resume_rename<R: Runtime>(app: AppHandle<R>, skip: bool) -> CmdResult<Outcome> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let _busy = Busy::take(&state.busy)?;
        let mut run = state.run.lock().map_err(err)?.take().ok_or("続ける変更がありません")?;
        let total = run.journal.steps.iter().filter(|s| s.is_final()).count();
        let reporter = Reporter::new(&app, "run-progress", Some(total), &state.cancel);
        let outcome = run.go(&RealFs, skip, &reporter);
        log_outcome(&outcome);
        sync_files(&mut *state.files.lock().map_err(err)?, &run.journal);
        if matches!(outcome, Outcome::Stopped { .. }) {
            *state.run.lock().map_err(err)? = Some(run);
        }
        Ok(outcome)
    })
    .await
    .map_err(err)?
}

/// Ends a stopped run here: what was renamed stays (and can still be
/// undone). Returns files that couldn't leave their temporary names.
#[tauri::command]
pub async fn finish_rename<R: Runtime>(app: AppHandle<R>) -> CmdResult<Vec<String>> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let _busy = Busy::take(&state.busy)?;
        let left = match state.run.lock().map_err(err)?.take() {
            Some(mut run) => {
                let left = run.finish(&RealFs);
                sync_files(&mut *state.files.lock().map_err(err)?, &run.journal);
                left
            }
            // After a crash: the journal on disk, without an end.
            None => match Journal::load(&journal_path(&app)?).map_err(err)? {
                Some(j) if j.end.is_none() => Run::new(j).finish(&RealFs),
                _ => Vec::new(),
            },
        };
        Ok(left)
    })
    .await
    .map_err(err)?
}

/// Puts the last run's files back under their old names (docs/SPEC.md §8).
#[tauri::command]
pub async fn undo_rename<R: Runtime>(app: AppHandle<R>) -> CmdResult<UndoReport> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let _busy = Busy::take(&state.busy)?;
        let mut journal = match state.run.lock().map_err(err)?.take() {
            Some(run) => run.journal,
            None => Journal::load(&journal_path(&app)?)
                .map_err(|e| format!("変更の記録を読めませんでした（{e}）"))?
                .ok_or("元に戻せる変更がありません")?,
        };
        if journal.end == Some(End::Undone) || journal.standing().next().is_none() {
            return Err("元に戻せる変更がありません".into());
        }
        let total = journal.renamed();
        let reporter = Reporter::new(&app, "run-progress", Some(total), &state.cancel);
        let report = execute::undo(&mut journal, &RealFs, &reporter);
        log::info!("{} 件を元に戻しました（戻せなかったもの {} 件）", report.restored, report.failed.len());
        for f in &report.failed {
            log::warn!("戻せませんでした: {}/{} → {}: {}", f.folder, f.name, f.new_name, f.reason);
        }
        sync_files(&mut *state.files.lock().map_err(err)?, &journal);
        Ok(report)
    })
    .await
    .map_err(err)?
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JournalStatus {
    /// The last run can be undone.
    pub can_undo: bool,
    /// The last run never ended (the app closed or crashed during it).
    pub interrupted: bool,
    /// Files under their new names now.
    pub renamed: usize,
    /// Steps halfway (files under a temporary name).
    pub halfway: usize,
    /// ms
    pub started: i64,
}

/// What the last run left, for ⌘Z and the question at launch.
#[tauri::command]
pub async fn journal_status<R: Runtime>(app: AppHandle<R>) -> CmdResult<JournalStatus> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let status = |j: &Journal, interrupted: bool| {
            let halfway = j
                .standing()
                .filter(|&i| j.steps[i].stage == Stage::ToTemp)
                .filter(|&i| {
                    !j.steps.iter().enumerate().any(|(k, s)| {
                        s.item == j.steps[i].item && s.stage == Stage::FromTemp && j.done[k] && !j.undone[k]
                    })
                })
                .count();
            JournalStatus {
                can_undo: j.end != Some(End::Undone) && j.standing().next().is_some(),
                interrupted,
                renamed: j.renamed(),
                halfway,
                started: j.started,
            }
        };
        if let Some(run) = state.run.lock().map_err(err)?.as_ref() {
            return Ok(status(&run.journal, false));
        }
        // A run in progress holds `busy`; its journal has no end yet but isn't interrupted.
        if state.busy.load(Ordering::Acquire) {
            return Ok(JournalStatus::default());
        }
        Ok(match Journal::load(&journal_path(&app)?) {
            Ok(Some(j)) => status(&j, j.end.is_none()),
            Ok(None) => JournalStatus::default(),
            Err(e) => {
                log::warn!("変更の記録を読めません: {e}");
                JournalStatus::default()
            }
        })
    })
    .await
    .map_err(err)?
}

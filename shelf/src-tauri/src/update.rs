//! In-app updates via tauri-plugin-updater.
//!
//! The installers are not Apple / Windows code-signed, so a freshly downloaded
//! .dmg / -setup.exe meets Gatekeeper / SmartScreen. Files written by the app
//! itself carry no quarantine attribute, so an update applied from here starts
//! without that warning; only the first install still shows it.
//!
//! The check runs a few seconds after launch and then once a day while the
//! app keeps running (release builds only), and from the tray menu. The tray
//! menu item also shows the download's progress.

use std::{
    sync::atomic::{AtomicBool, Ordering},
    thread,
    time::{Duration, SystemTime},
};

use tauri::{async_runtime::block_on, menu::MenuItem, AppHandle, Manager, Url, Wry};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use tauri_plugin_updater::{Update, UpdaterExt};

use crate::proxy;

/// Same as `plugins.updater.endpoints` in tauri.conf.json. Other tools'
/// releases share this repository, so the feed lives on its own fixed release
/// instead of `releases/latest`.
const FEED: &str =
    "https://github.com/2204601/workbench/releases/download/shelf-updater/latest.json";

pub const MENU_LABEL: &str = "アップデートを確認…";

/// How often the app checks while it keeps running. Shelf lives in the menu
/// bar and is rarely quit, so a check at launch alone could go stale for
/// days. An update put off with "あとで" is offered again on the next one.
const INTERVAL: Duration = Duration::from_secs(24 * 60 * 60);

/// Set while a check or a download is running.
static BUSY: AtomicBool = AtomicBool::new(false);

/// The tray menu item that starts a manual check.
pub struct MenuEntry(pub MenuItem<Wry>);

/// Checks a few seconds after launch and then every [`INTERVAL`], in release
/// builds.
pub fn check_periodically(app: &AppHandle) {
    if cfg!(debug_assertions) {
        return;
    }
    let app = app.clone();
    thread::spawn(move || {
        thread::sleep(Duration::from_secs(4));
        let mut last = SystemTime::now();
        check(&app, false);
        loop {
            // Measured on the wall clock, checked hourly: `thread::sleep` can
            // stand still while the computer sleeps, so sleeping a whole day
            // at once could take several days of laptop use to run out.
            thread::sleep(Duration::from_secs(60 * 60));
            if last.elapsed().map_or(true, |e| e >= INTERVAL) {
                last = SystemTime::now();
                check(&app, false);
            }
        }
    });
}

/// Checks GitHub Releases for a newer version. `manual` reports "up to date"
/// and errors; the automatic check stays silent unless an update exists.
pub fn check(app: &AppHandle, manual: bool) {
    if BUSY.swap(true, Ordering::SeqCst) {
        return;
    }
    let app = app.clone();
    thread::spawn(move || {
        if manual {
            set_menu(&app, "アップデートを確認しています…", false);
        }
        match find(&app) {
            Ok(Some(update)) => offer(&app, update),
            Ok(None) if manual => {
                let version = app.package_info().version.to_string();
                show(
                    &app,
                    MessageDialogKind::Info,
                    format!("Shelf v{version} は最新版です。"),
                );
            }
            Ok(None) => {}
            Err(e) if manual => show(
                &app,
                MessageDialogKind::Error,
                format!("アップデートを確認できませんでした。\n{e}"),
            ),
            Err(e) => eprintln!("update check failed: {e}"),
        }
        set_menu(&app, MENU_LABEL, true);
        BUSY.store(false, Ordering::SeqCst);
    });
}

fn find(app: &AppHandle) -> tauri_plugin_updater::Result<Option<Update>> {
    let mut builder = app.updater_builder().timeout(Duration::from_secs(15));
    // The updater's HTTP client can't evaluate PAC scripts, so behind a
    // company proxy it would try to connect directly and fail. The proxy also
    // applies to the download (the Update keeps it).
    if let Some(proxy) = proxy::for_url(FEED).and_then(|p| Url::parse(&p).ok()) {
        builder = builder.proxy(proxy);
    }
    block_on(builder.build()?.check())
}

fn offer(app: &AppHandle, update: Update) {
    let mut text = format!(
        "新しいバージョン v{} があります（現在 v{}）。",
        update.version, update.current_version
    );
    if let Some(notes) = update.body.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        text.push_str("\n\n");
        text.extend(notes.chars().take(600));
    }
    text.push_str("\n\nダウンロードして再起動しますか？");
    bring_to_front(app);
    let ok = app
        .dialog()
        .message(text)
        .title("アップデート")
        .kind(MessageDialogKind::Info)
        .buttons(MessageDialogButtons::OkCancelCustom(
            "更新して再起動".into(),
            "あとで".into(),
        ))
        .blocking_show();
    if !ok {
        return;
    }

    let mut done = 0u64;
    let mut shown = None;
    set_menu(app, "アップデートをダウンロードしています…", false);
    let result = block_on(update.download_and_install(
        |chunk, total| {
            done += chunk as u64;
            if let Some(total) = total.filter(|&t| t > 0) {
                let percent = (done * 100 / total).min(100);
                // Chunks arrive hundreds of times a second.
                if shown != Some(percent) {
                    shown = Some(percent);
                    set_menu(app, &format!("アップデートをダウンロードしています… {percent}%"), false);
                }
            }
        },
        || set_menu(app, "アップデートをインストールしています…", false),
    ));
    if let Err(e) = result {
        show(app, MessageDialogKind::Error, format!("アップデートに失敗しました。\n{e}"));
        return;
    }
    // Windows: the installer has already been started and this process asked
    // to exit by now. macOS: the .app was swapped in place; restart into it.
    app.restart();
}

fn show(app: &AppHandle, kind: MessageDialogKind, text: String) {
    bring_to_front(app);
    app.dialog()
        .message(text)
        .title("アップデート")
        .kind(kind)
        .buttons(MessageDialogButtons::Ok)
        .blocking_show();
}

fn set_menu(app: &AppHandle, text: &str, enabled: bool) {
    if let Some(entry) = app.try_state::<MenuEntry>() {
        let _ = entry.0.set_text(text);
        let _ = entry.0.set_enabled(enabled);
    }
}

/// A menu-bar app isn't active on its own, so its dialogs would open behind
/// other apps' windows.
fn bring_to_front(app: &AppHandle) {
    #[cfg(target_os = "macos")]
    let _ = app.run_on_main_thread(|| {
        use objc2_app_kit::NSApplication;
        use objc2_foundation::MainThreadMarker;
        if let Some(mtm) = MainThreadMarker::new() {
            #[allow(deprecated)] // `activate` needs macOS 14.
            NSApplication::sharedApplication(mtm).activateIgnoringOtherApps(true);
        }
    });
    #[cfg(not(target_os = "macos"))]
    let _ = app;
}

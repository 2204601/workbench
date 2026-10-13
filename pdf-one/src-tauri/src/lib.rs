pub mod commands;
pub mod files;
pub mod pdf;
pub mod proxy;
pub mod settings;

use commands::*;
use tauri::{Emitter, Manager, Runtime};

/// The log file's name in the app's log folder (without ".log").
pub const LOG_FILE: &str = "pdf-one";

/// Panics into the log too: release builds abort on panic, so stderr is all
/// that would be left, and nobody sees it.
fn log_panics() {
    let default = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        log::error!("{info}");
        default(info);
    }));
}

fn show_main_window<R: Runtime>(app: &tauri::AppHandle<R>) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

/// PDF files among a launch's arguments (Windows: a double-click or "Open
/// with" starts the app with the file's path).
fn pdf_args(args: impl IntoIterator<Item = String>) -> Vec<String> {
    args.into_iter()
        .filter(|a| !a.starts_with('-') && a.to_ascii_lowercase().ends_with(".pdf"))
        .filter(|a| std::path::Path::new(a).is_file())
        .collect()
}

/// Files the OS wants opened: queued, and the page told to come and take
/// them (src/lib/actions.ts). Queued rather than sent, so none is lost
/// while the page is still loading.
fn request_open<R: Runtime>(app: &tauri::AppHandle<R>, paths: Vec<String>) {
    if paths.is_empty() {
        return;
    }
    app.state::<AppState>().queue_open(paths);
    let _ = app.emit("open-requested", ());
    show_main_window(app);
}

/// The app's state and commands, on any runtime (the tests use the mock one).
pub fn with_commands<R: Runtime>(builder: tauri::Builder<R>) -> tauri::Builder<R> {
    builder.manage(AppState::default()).invoke_handler(tauri::generate_handler![
        get_app_settings,
        set_app_settings,
        os_user_name,
        text_font_family,
        system_proxy,
        reveal_log,
        reveal_backups,
        reveal_file,
        take_open_requests,
        open_pdf,
        pdf_view_bytes,
        close_pdf,
        save_pdf,
        add_image,
        add_image_bytes,
        image_bytes,
        list_stamps,
        add_stamp,
        add_stamp_bytes,
        remove_stamp,
        use_stamp,
        write_draft,
        list_drafts,
        remove_draft,
    ])
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // The menu bar is made by the frontend from its command table
    // (src/lib/menuBar.ts); until it loads, macOS shows Tauri's default menu.
    let app = with_commands(tauri::Builder::default())
        // First, so a second launch quits before setting anything up. Its
        // files open in this one.
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            show_main_window(app);
            request_open(app, pdf_args(args.into_iter().skip(1)));
        }))
        // log::* from Rust and the frontend's warnings (src/lib/log.ts), into
        // the app's log folder (ヘルプ › ログを表示) and stdout.
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(log::LevelFilter::Info)
                .targets([
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Stdout),
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::LogDir {
                        file_name: Some(LOG_FILE.into()),
                    }),
                ])
                .max_file_size(1_000_000)
                .rotation_strategy(tauri_plugin_log::RotationStrategy::KeepSome(2))
                .timezone_strategy(tauri_plugin_log::TimezoneStrategy::UseLocal)
                .build(),
        )
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        // Size, place and maximized, kept between launches. Not fullscreen
        // or hidden: the app always opens as a visible, ordinary window.
        .plugin(
            tauri_plugin_window_state::Builder::new()
                .with_state_flags(
                    tauri_plugin_window_state::StateFlags::SIZE
                        | tauri_plugin_window_state::StateFlags::POSITION
                        | tauri_plugin_window_state::StateFlags::MAXIMIZED,
                )
                .build(),
        )
        .setup(|app| {
            log_panics();
            log::info!("PDF One {} ({} {})", app.package_info().version, std::env::consts::OS, std::env::consts::ARCH);
            app.state::<AppState>().queue_open(pdf_args(std::env::args().skip(1)));
            // Look for the Japanese font now, not on the first save.
            std::thread::spawn(|| {
                let _ = pdf::font::system_font();
            });
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application");
    app.run(|_app, _event| {
        // macOS hands files over as an event (a double-click in Finder, a
        // drop on the Dock icon), also at launch.
        #[cfg(target_os = "macos")]
        if let tauri::RunEvent::Opened { urls } = _event {
            let paths =
                urls.into_iter().filter_map(|u| u.to_file_path().ok()).map(|p| p.to_string_lossy().into_owned());
            request_open(_app, pdf_args(paths));
        }
    });
}

#[cfg(test)]
mod tests {
    #[test]
    fn launch_arguments() {
        let dir = tempfile::tempdir().unwrap();
        let pdf = dir.path().join("a.PDF");
        std::fs::write(&pdf, b"%PDF-1.7").unwrap();
        let p = pdf.to_string_lossy().into_owned();
        let missing = dir.path().join("b.pdf").to_string_lossy().into_owned();
        assert_eq!(super::pdf_args([p.clone(), "--flag".into(), missing, "x.txt".into()]), [p]);
    }
}

pub mod commands;
pub mod places;
pub mod proxy;
pub mod scan;
pub mod settings;
pub mod view;
pub mod volume;

use commands::*;
use tauri::{Manager, Runtime};

/// The log file's name in the app's log folder (without ".log").
pub const LOG_FILE: &str = "disk-analyzer";

/// Panics into the log too: release builds abort on panic, so stderr is all
/// that would be left, and nobody sees it.
fn log_panics() {
    let default = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        log::error!("{info}");
        default(info);
    }));
}

/// A second launch: bring up the running window instead.
fn show_main_window(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

/// The app's state and commands, on any runtime (the tests use the mock one).
pub fn with_commands<R: Runtime>(builder: tauri::Builder<R>) -> tauri::Builder<R> {
    builder.manage(AppState::default()).invoke_handler(tauri::generate_handler![
        get_app_settings,
        set_app_settings,
        system_proxy,
        reveal_log,
        list_places,
        scan_folder,
        cancel_scan,
        close_scan,
        view_tree,
        folder_info,
        item_path,
        reveal_item,
    ])
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // The menu bar is made by the frontend from its command table
    // (src/lib/menuBar.ts); until it loads, macOS shows Tauri's default menu.
    with_commands(tauri::Builder::default())
        // First, so a second launch quits before setting anything up.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| show_main_window(app)))
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
            log::info!(
                "Disk Analyzer {} ({} {})",
                app.package_info().version,
                std::env::consts::OS,
                std::env::consts::ARCH
            );
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

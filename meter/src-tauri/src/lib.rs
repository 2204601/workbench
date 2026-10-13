mod badge;
mod format;
mod login_item;
mod monitor;
mod popup;
mod proxy;
mod sampler;
mod settings;
mod tray;
mod update;

use tauri::{AppHandle, Manager, WindowEvent};

/// The log file's name in the app's log folder (without ".log").
const LOG_FILE: &str = "meter";

/// Panics into the log too: release builds abort on panic, so stderr is all
/// that would be left, and nobody sees it.
fn log_panics() {
    let default = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        log::error!("{info}");
        default(info);
    }));
}

/// Everything the popup shows when it opens; later readings come as
/// "sample" events. Async so that reading the processes and drives runs off
/// the main thread (Architecture §4).
#[tauri::command]
async fn snapshot(app: AppHandle) -> monitor::Snapshot {
    let version = app.package_info().version.to_string();
    let interval = app.state::<settings::Store>().get().interval_secs;
    let monitor = app.state::<monitor::State>();
    let mut monitor = monitor.0.lock().unwrap();
    monitor.snapshot(interval, version)
}

#[tauri::command]
fn hide_popup(app: AppHandle) {
    popup::hide(&app);
}

/// Opens the log folder with the log file selected (tray menu › ログを表示).
fn reveal_log(app: &AppHandle) {
    let result = app.path().app_log_dir().map_err(|e| e.to_string()).and_then(|dir| {
        let file = dir.join(format!("{LOG_FILE}.log"));
        if file.is_file() {
            tauri_plugin_opener::reveal_item_in_dir(file).map_err(|e| e.to_string())
        } else {
            std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
            tauri_plugin_opener::open_path(dir, None::<&str>).map_err(|e| e.to_string())
        }
    });
    if let Err(e) = result {
        log::warn!("reveal log: {e}");
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // First, so a second launch exits before setting anything else up.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| popup::show(app, None)))
        // log::* from Rust and the popup's warnings (src/log.ts), into the
        // app's log folder (tray menu › ログを表示) and stdout.
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
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(login_item::plugin())
        .setup(|app| {
            log_panics();
            log::info!("Meter {} ({} {})", app.package_info().version, std::env::consts::OS, std::env::consts::ARCH);
            // Menu-bar utility on macOS: no Dock icon, just the menu bar.
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            app.manage(settings::Store::load(&app.path().app_config_dir()?));
            app.manage(monitor::State(std::sync::Mutex::new(monitor::Monitor::new())));

            login_item::enable_once(app.handle());
            tray::setup(app.handle())?;
            monitor::start(app.handle());
            update::check_periodically(app.handle());

            // Opened by hand: show the popup once, so people see where Meter
            // went. At login it waits in the tray.
            if !login_item::launched_at_login() {
                popup::show(app.handle(), None);
            }
            Ok(())
        })
        .on_window_event(|window, event| match event {
            // Closing the popup only hides it; quit from the tray menu.
            WindowEvent::CloseRequested { api, .. } => {
                api.prevent_close();
                popup::hide(window.app_handle());
            }
            // The popup goes away when another app is clicked, like a menu.
            WindowEvent::Focused(false) => popup::blurred(window.app_handle()),
            _ => {}
        })
        .invoke_handler(tauri::generate_handler![snapshot, hide_popup])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

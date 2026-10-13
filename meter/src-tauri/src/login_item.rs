//! Launching Meter at login.
//!
//! The tray only shows the numbers while Meter is running, so launch at login
//! is turned on by itself once, the first time a release build runs. From
//! then on only the tray menu's checkbox changes it.

use std::fs;

use tauri::{menu::CheckMenuItem, AppHandle, Manager, Wry};
use tauri_plugin_autostart::ManagerExt;

pub const MENU_LABEL: &str = "ログイン時に起動";
/// Left in the app data folder once launch at login has been set up.
const MARKER: &str = "launch-at-login-set";
/// Passed when launched at login, so Meter starts quietly in the tray instead
/// of opening its popup.
const LOGIN_ARG: &str = "--at-login";

pub fn plugin() -> tauri::plugin::TauriPlugin<Wry> {
    tauri_plugin_autostart::Builder::new().args([LOGIN_ARG]).build()
}

/// Whether this launch is the one at login.
pub fn launched_at_login() -> bool {
    std::env::args().any(|arg| arg == LOGIN_ARG)
}

pub fn is_enabled(app: &AppHandle) -> bool {
    app.autolaunch().is_enabled().unwrap_or(false)
}

/// Turns launch at login on, unless that was done before. Skipped in dev
/// builds, which would register the dev binary.
pub fn enable_once(app: &AppHandle) {
    if cfg!(debug_assertions) || !installed() {
        return;
    }
    let Ok(dir) = app.path().app_data_dir() else {
        return;
    };
    let marker = dir.join(MARKER);
    if marker.exists() {
        return;
    }
    match app.autolaunch().enable() {
        Ok(()) => {
            let _ = fs::create_dir_all(&dir).and_then(|()| fs::write(&marker, ""));
        }
        Err(e) => log::warn!("launch at login: {e}"),
    }
}

/// Whether this copy of the app is the one that stays put. On macOS, an app
/// opened straight from the .dmg or from a quarantined download runs from a
/// temporary path that would be gone by the next login.
fn installed() -> bool {
    if !cfg!(target_os = "macos") {
        return true;
    }
    std::env::current_exe().is_ok_and(|exe| {
        let exe = exe.to_string_lossy();
        !exe.starts_with("/Volumes/") && !exe.contains("/AppTranslocation/")
    })
}

/// Flips launch at login from the tray menu, then shows the actual state.
pub fn toggle(app: &AppHandle, item: &CheckMenuItem<Wry>) {
    let autolaunch = app.autolaunch();
    let result = if is_enabled(app) { autolaunch.disable() } else { autolaunch.enable() };
    if let Err(e) = result {
        log::warn!("launch at login: {e}");
    }
    let _ = item.set_checked(is_enabled(app));
}

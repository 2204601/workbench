//! The global shortcut that brings up Clip. It can be picked in the
//! settings from a few that rarely clash with other apps (`store::SHORTCUTS`).

use tauri::AppHandle;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

pub fn plugin() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    tauri_plugin_global_shortcut::Builder::new().build()
}

/// Makes `accelerator` (e.g. "Ctrl+Alt+C") the one shortcut that toggles the
/// popup. Returns false if it cannot be used, e.g. because another app has
/// already taken it; nothing is registered then.
pub fn register(app: &AppHandle, accelerator: &str) -> bool {
    let shortcuts = app.global_shortcut();
    let _ = shortcuts.unregister_all();
    let result = shortcuts.on_shortcut(accelerator, |app, _, event| {
        if event.state() == ShortcutState::Pressed {
            crate::toggle_popup(app);
        }
    });
    match result {
        Ok(()) => true,
        Err(e) => {
            eprintln!("shortcut {accelerator}: {e}");
            false
        }
    }
}

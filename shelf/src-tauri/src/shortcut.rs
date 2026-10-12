//! The global shortcut, Ctrl+Alt+S (⌃⌥S on macOS).
//!
//! Like Yoink's F5: pressed once, it shows or hides the shelf; pressed twice
//! in quick succession, it also puts the files copied in Finder / Explorer
//! onto the shelf.

use std::{
    sync::Mutex,
    time::{Duration, Instant},
};

use tauri::AppHandle;
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

/// How the shortcut is shown next to the tray menu item.
pub const ACCELERATOR: &str = "Ctrl+Alt+S";
/// The second press must come within this long of the first.
const DOUBLE_PRESS: Duration = Duration::from_millis(500);

pub fn plugin() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    tauri_plugin_global_shortcut::Builder::new().build()
}

/// Registers the shortcut. Returns false if it cannot be used, e.g. because
/// another app has already taken it.
pub fn register(app: &AppHandle) -> bool {
    let shortcut = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::KeyS);
    let last_press = Mutex::new(None::<Instant>);
    let result = app
        .global_shortcut()
        .on_shortcut(shortcut, move |app, _, event| {
            if event.state() != ShortcutState::Pressed {
                return;
            }
            let now = Instant::now();
            let double = {
                let mut last = last_press.lock().unwrap();
                let double = last.is_some_and(|at| now.duration_since(at) < DOUBLE_PRESS);
                // A third press starts over rather than counting as another double.
                *last = (!double).then_some(now);
                double
            };
            if double {
                crate::paste_and_show(app);
            } else {
                crate::toggle_main_window(app);
            }
        });
    match result {
        Ok(()) => true,
        Err(e) => {
            eprintln!("shortcut {ACCELERATOR}: {e}");
            false
        }
    }
}

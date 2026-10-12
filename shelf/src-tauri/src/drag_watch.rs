//! Showing the shelf while files are being dragged around the system.
//!
//! Two triggers bring the shelf up mid-drag:
//! - everywhere: a drag touching the thin strip window at the screen edge
//!   (see `edge.html`), which calls [`drag_reached_edge`];
//! - macOS only: any file drag starting in another app (Finder, the Dock,
//!   …), detected by watching the system drag pasteboard (see
//!   [`macos::install`]).
//!
//! Either way the shelf is shown without taking focus, and if it was hidden
//! before and the drag ends without anything being dropped on it, it is
//! hidden again. Windows has no way to observe other apps starting a drag, so it
//! relies on the edge strip alone.

use std::{
    sync::atomic::{AtomicBool, Ordering},
    thread,
    time::Duration,
};

use tauri::{AppHandle, Manager};

/// Set while a drag that brought up the shelf is still in progress.
static TRACKING: AtomicBool = AtomicBool::new(false);
/// Set when files land on the shelf during that drag.
static DROPPED: AtomicBool = AtomicBool::new(false);

/// Records that files were added to the shelf, so a shelf that was brought
/// up by the current drag stays open afterwards.
pub fn note_drop() {
    DROPPED.store(true, Ordering::SeqCst);
}

/// Called when a drag enters the edge strip.
pub fn drag_reached_edge(app: &AppHandle) {
    on_drag_started(app);
}

fn on_drag_started(app: &AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let was_visible = window.is_visible().unwrap_or(false);
    if !was_visible {
        let _ = window.show();
    }
    // One watcher per drag; later triggers during the same drag are no-ops.
    if TRACKING.swap(true, Ordering::SeqCst) {
        return;
    }
    DROPPED.store(false, Ordering::SeqCst);
    let app = app.clone();
    thread::spawn(move || {
        while primary_button_down() {
            thread::sleep(Duration::from_millis(50));
        }
        // Give the drop event time to reach the shelf before deciding.
        thread::sleep(Duration::from_millis(600));
        TRACKING.store(false, Ordering::SeqCst);
        if !was_visible && !DROPPED.load(Ordering::SeqCst) {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.hide();
            }
        }
    });
}

/// Whether the button that drags things (left, or right when swapped) is held.
#[cfg(target_os = "macos")]
fn primary_button_down() -> bool {
    // Bit 0 is the primary button; macOS already accounts for swapped buttons.
    objc2_app_kit::NSEvent::pressedMouseButtons() & 1 != 0
}

#[cfg(windows)]
fn primary_button_down() -> bool {
    use windows_sys::Win32::UI::{
        Input::KeyboardAndMouse::{GetAsyncKeyState, VK_LBUTTON, VK_RBUTTON},
        WindowsAndMessaging::{GetSystemMetrics, SM_SWAPBUTTON},
    };
    // GetAsyncKeyState reports physical buttons, so honour a swapped mouse.
    let key = if unsafe { GetSystemMetrics(SM_SWAPBUTTON) } != 0 {
        VK_RBUTTON
    } else {
        VK_LBUTTON
    };
    (unsafe { GetAsyncKeyState(key as i32) } as u16 & 0x8000) != 0
}

#[cfg(not(any(target_os = "macos", windows)))]
fn primary_button_down() -> bool {
    false
}

#[cfg(target_os = "macos")]
pub mod macos {
    use std::{thread, time::Duration};

    use objc2::rc::autoreleasepool;
    use objc2_app_kit::{NSPasteboard, NSPasteboardNameDrag};
    use tauri::AppHandle;

    /// How often the mouse button is checked.
    const POLL: Duration = Duration::from_millis(100);

    /// Watches for file drags starting in other apps and shows the shelf as
    /// soon as one does.
    ///
    /// Every new drag session writes to the shared drag pasteboard, so a
    /// change in its `changeCount` while the mouse button is held marks a
    /// drag start. Only the pasteboard's types are inspected, never its
    /// contents.
    ///
    /// This polls rather than listening for other apps' mouse-dragged
    /// events, which did not catch every drag: one out of a Dock stack never
    /// brought up the shelf. Shelf's own drags are seen too, but the shelf
    /// is already showing then, so they change nothing.
    pub fn install(app: AppHandle) {
        thread::spawn(move || {
            let drag_pasteboard = NSPasteboard::pasteboardWithName(unsafe { NSPasteboardNameDrag });
            let mut last_change = drag_pasteboard.changeCount();
            let mut was_down = false;
            loop {
                thread::sleep(POLL);
                // This thread has no run loop to drain autoreleased objects.
                autoreleasepool(|_| {
                    let down = super::primary_button_down();
                    if down {
                        let change = drag_pasteboard.changeCount();
                        if change != last_change {
                            last_change = change;
                            if has_files(&drag_pasteboard) {
                                super::on_drag_started(&app);
                            }
                        }
                    } else if was_down {
                        // A drag too quick to catch while the button was held
                        // must not count as one at the next click.
                        last_change = drag_pasteboard.changeCount();
                    }
                    was_down = down;
                });
            }
        });
    }

    fn has_files(pasteboard: &NSPasteboard) -> bool {
        pasteboard.types().is_some_and(|types| {
            types.iter().any(|t| {
                // Some sources, such as the Dock, may only declare the
                // legacy file-name list.
                let t = t.to_string();
                t == "public.file-url" || t == "NSFilenamesPboardType"
            })
        })
    }
}

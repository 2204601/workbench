//! Showing the shelf while files are being dragged around the system.
//!
//! Two triggers bring the shelf up mid-drag:
//! - everywhere: a drag touching the thin strip window at the screen edge
//!   (see `edge.html`), which calls [`drag_reached_edge`];
//! - macOS only: any file drag starting in another app, detected by
//!   watching the system drag pasteboard (see [`macos::install`]).
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
    use std::{cell::Cell, ptr::NonNull};

    use block2::RcBlock;
    use objc2_app_kit::{
        NSEvent, NSEventMask, NSPasteboard, NSPasteboardNameDrag, NSPasteboardTypeFileURL,
    };
    use tauri::AppHandle;

    /// Watches mouse drags in other apps and shows the shelf as soon as one
    /// of them starts dragging files. Must be called on the main thread.
    ///
    /// Every new drag session writes to the shared drag pasteboard, so a
    /// change in its `changeCount` during a mouse drag marks a drag start.
    /// Only the pasteboard's types are inspected, never its contents.
    pub fn install(app: AppHandle) {
        let drag_pasteboard = NSPasteboard::pasteboardWithName(unsafe { NSPasteboardNameDrag });
        let last_change = Cell::new(drag_pasteboard.changeCount());

        let handler = RcBlock::new(move |_event: NonNull<NSEvent>| {
            let change = drag_pasteboard.changeCount();
            if change == last_change.get() {
                return;
            }
            last_change.set(change);
            let has_files = drag_pasteboard.types().is_some_and(|types| {
                types
                    .iter()
                    .any(|t| &*t == unsafe { NSPasteboardTypeFileURL })
            });
            if has_files {
                super::on_drag_started(&app);
            }
        });

        // The monitor lives for the rest of the process, so it is leaked on
        // purpose rather than kept around to be removed later.
        std::mem::forget(NSEvent::addGlobalMonitorForEventsMatchingMask_handler(
            NSEventMask::LeftMouseDragged,
            &handler,
        ));
    }
}

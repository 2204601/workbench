//! The popup with the details and graphs: opened by clicking a tray icon,
//! placed next to it like the system's own flyouts, and gone again when
//! another app is clicked.

use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
    time::{Duration, Instant},
};

use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, Rect, WebviewWindow};

pub const LABEL: &str = "popup";

/// Gap between the popup and the taskbar / menu bar, in logical pixels.
const MARGIN: f64 = 8.0;

/// Whether the popup is up, so the sampler reads the apps and sends updates
/// only then.
pub static OPEN: AtomicBool = AtomicBool::new(false);

/// When the popup last went away because another window took the focus.
/// Clicking the tray icon to close the popup takes the focus first, and that
/// click must not open it again straight away.
static LAST_BLUR: Mutex<Option<Instant>> = Mutex::new(None);

/// A rectangle in physical pixels: x, y, width, height.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Area {
    pub x: i32,
    pub y: i32,
    pub w: i32,
    pub h: i32,
}

/// The tray icon was clicked: opens the popup next to `icon`, or closes it.
pub fn toggle(app: &AppHandle, icon: Option<Rect>) {
    let Some(window) = app.get_webview_window(LABEL) else {
        return;
    };
    if window.is_visible().unwrap_or(false) {
        hide(app);
        return;
    }
    let just_closed = LAST_BLUR.lock().unwrap().is_some_and(|at| at.elapsed() < Duration::from_millis(300));
    if !just_closed {
        show(app, icon);
    }
}

pub fn show(app: &AppHandle, icon: Option<Rect>) {
    let Some(window) = app.get_webview_window(LABEL) else {
        return;
    };
    if let Err(e) = place(&window, icon) {
        log::warn!("popup placement: {e}");
    }
    OPEN.store(true, Ordering::SeqCst);
    let _ = window.show();
    let _ = window.set_focus();
    crate::update::bring_to_front(app);
    let _ = window.emit("popup-shown", ());
}

pub fn hide(app: &AppHandle) {
    OPEN.store(false, Ordering::SeqCst);
    if let Some(window) = app.get_webview_window(LABEL) {
        let _ = window.hide();
    }
}

/// Another app was clicked.
pub fn blurred(app: &AppHandle) {
    if OPEN.load(Ordering::SeqCst) {
        *LAST_BLUR.lock().unwrap() = Some(Instant::now());
        hide(app);
    }
}

fn place(window: &WebviewWindow, icon: Option<Rect>) -> tauri::Result<()> {
    let app = window.app_handle();
    let icon = icon.map(|r| {
        let p = r.position.to_physical::<i32>(1.0);
        let s = r.size.to_physical::<i32>(1.0);
        Area { x: p.x, y: p.y, w: s.width, h: s.height }
    });
    // The screen the icon is on; without one (opened from the menu or a
    // second launch), the primary screen's tray corner.
    let monitor = match icon {
        Some(i) => app.monitor_from_point((i.x + i.w / 2) as f64, (i.y + i.h / 2) as f64)?,
        None => None,
    };
    let Some(monitor) = monitor.or(window.primary_monitor()?) else {
        return Ok(());
    };
    let scale = monitor.scale_factor();
    let work = monitor.work_area();
    let work = Area { x: work.position.x, y: work.position.y, w: work.size.width as i32, h: work.size.height as i32 };
    // The size it will have on that screen, which may differ in scaling from
    // the one it was last shown on.
    let logical = window.inner_size()?.to_logical::<f64>(window.scale_factor()?);
    let size = ((logical.width * scale).round() as i32, (logical.height * scale).round() as i32);
    let icon = icon.unwrap_or_else(|| default_corner(work));
    let (x, y) = position(icon, work, size, (MARGIN * scale).round() as i32);
    window.set_position(PhysicalPosition::new(x, y))
}

/// Where the tray is on each system when there is no icon to go by: the
/// bottom right on Windows, the top right on macOS.
fn default_corner(work: Area) -> Area {
    let right = work.x + work.w - 1;
    if cfg!(target_os = "macos") {
        Area { x: right, y: work.y - 1, w: 1, h: 1 }
    } else {
        Area { x: right, y: work.y + work.h, w: 1, h: 1 }
    }
}

/// The popup's top-left corner: beside the `icon`, on the side away from the
/// taskbar (above a taskbar at the bottom, below the menu bar, to the right
/// of a taskbar on the left…), and inside the work area.
pub fn position(icon: Area, work: Area, size: (i32, i32), margin: i32) -> (i32, i32) {
    let (w, h) = size;
    let (cx, cy) = (icon.x + icon.w / 2, icon.y + icon.h / 2);
    let (right, bottom) = (work.x + work.w, work.y + work.h);
    let (x, y) = if cy >= bottom {
        (cx - w / 2, bottom - h - margin)
    } else if cy < work.y {
        (cx - w / 2, work.y + margin)
    } else if cx < work.x {
        (work.x + margin, cy - h / 2)
    } else if cx >= right {
        (right - w - margin, cy - h / 2)
    } else if cy > work.y + work.h / 2 {
        // The icon is inside the work area (the overflow menu of hidden
        // icons, an auto-hiding taskbar): just above or below it.
        (cx - w / 2, icon.y - h - margin)
    } else {
        (cx - w / 2, icon.y + icon.h + margin)
    };
    let x = x.min(right - w - margin).max(work.x + margin);
    let y = y.min(bottom - h - margin).max(work.y + margin);
    (x, y)
}

#[cfg(test)]
mod tests {
    use super::*;

    const SCREEN: Area = Area { x: 0, y: 0, w: 1920, h: 1032 };
    const SIZE: (i32, i32) = (360, 600);

    #[test]
    fn above_a_taskbar_at_the_bottom() {
        let icon = Area { x: 1700, y: 1040, w: 24, h: 32 };
        assert_eq!(position(icon, SCREEN, SIZE, 8), (1532, 424));
    }

    #[test]
    fn kept_on_screen_at_the_right_edge() {
        let icon = Area { x: 1890, y: 1040, w: 24, h: 32 };
        assert_eq!(position(icon, SCREEN, SIZE, 8), (1920 - 360 - 8, 424));
    }

    #[test]
    fn below_the_menu_bar() {
        let work = Area { x: 0, y: 25, w: 1512, h: 957 };
        let icon = Area { x: 1200, y: 0, w: 80, h: 24 };
        assert_eq!(position(icon, work, SIZE, 8), (1060, 33));
    }

    #[test]
    fn beside_a_taskbar_on_the_left_or_right() {
        let work = Area { x: 62, y: 0, w: 1858, h: 1080 };
        let icon = Area { x: 20, y: 1000, w: 24, h: 24 };
        assert_eq!(position(icon, work, SIZE, 8), (70, 1080 - 600 - 8));

        let work = Area { x: 0, y: 0, w: 1858, h: 1080 };
        let icon = Area { x: 1880, y: 500, w: 24, h: 24 };
        assert_eq!(position(icon, work, SIZE, 8), (1858 - 360 - 8, 212));
    }

    #[test]
    fn above_an_icon_in_the_overflow_menu() {
        let icon = Area { x: 1600, y: 900, w: 32, h: 32 };
        assert_eq!(position(icon, SCREEN, SIZE, 8), (1436, 292));
    }

    #[test]
    fn on_a_second_screen() {
        let work = Area { x: 1920, y: 0, w: 2560, h: 1400 };
        let icon = Area { x: 4300, y: 1410, w: 32, h: 40 };
        assert_eq!(position(icon, work, SIZE, 8), (4480 - 360 - 8, 1400 - 600 - 8));
    }
}

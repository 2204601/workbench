//! The menu bar / tray icon: plain one-colour cards on a shelf, like the system's
//! own icons, rather than the coloured app icon (drawn in `tray-icon.svg`).
//!
//! macOS gets a template image, which the menu bar colours to match itself.
//! Windows gets white on a dark taskbar and black on a light one, and
//! switches when the taskbar's mode changes.

use tauri::{image::Image, tray::TrayIconBuilder, AppHandle, Runtime};

const TEMPLATE: &[u8] = include_bytes!("../icons/tray/template.png");
const WHITE: &[u8] = include_bytes!("../icons/tray/white.png");
const BLACK: &[u8] = include_bytes!("../icons/tray/black.png");

/// The tray's id, for finding it again when the icon has to change.
pub const ID: &str = "main";

/// Sets the icon on a tray being built.
pub fn apply<R: Runtime>(tray: TrayIconBuilder<R>) -> tauri::Result<TrayIconBuilder<R>> {
    let tray = tray.icon(current()?);
    #[cfg(target_os = "macos")]
    let tray = tray.icon_as_template(true);
    Ok(tray)
}

/// Picks the icon again after the system's light / dark mode changed.
pub fn refresh<R: Runtime>(app: &AppHandle<R>) {
    if cfg!(target_os = "macos") {
        // A template image follows the menu bar by itself.
        return;
    }
    if let (Some(tray), Ok(icon)) = (app.tray_by_id(ID), current()) {
        let _ = tray.set_icon(Some(icon));
    }
}

fn current() -> tauri::Result<Image<'static>> {
    let bytes = if cfg!(target_os = "macos") {
        TEMPLATE
    } else if taskbar_is_light() {
        BLACK
    } else {
        WHITE
    };
    Image::from_bytes(bytes)
}

/// Whether the Windows taskbar is light ("Choose your default Windows mode:
/// Light"). It is dark by default, and on other systems.
fn taskbar_is_light() -> bool {
    #[cfg(windows)]
    {
        use std::{ffi::c_void, iter, ptr};
        use windows_sys::Win32::System::Registry::{RegGetValueW, HKEY_CURRENT_USER, RRF_RT_REG_DWORD};

        let wide = |s: &str| s.encode_utf16().chain(iter::once(0)).collect::<Vec<u16>>();
        let key = wide(r"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize");
        let value = wide("SystemUsesLightTheme");
        let mut data = 0u32;
        let mut size = std::mem::size_of::<u32>() as u32;
        let status = unsafe {
            RegGetValueW(
                HKEY_CURRENT_USER,
                key.as_ptr(),
                value.as_ptr(),
                RRF_RT_REG_DWORD,
                ptr::null_mut(),
                &mut data as *mut u32 as *mut c_void,
                &mut size,
            )
        };
        status == 0 && data != 0
    }
    #[cfg(not(windows))]
    false
}

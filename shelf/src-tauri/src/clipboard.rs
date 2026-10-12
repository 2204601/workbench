//! Reading the files that were copied (⌘C / Ctrl+C) in Finder / Explorer.
//!
//! Only file references are read; text, images and anything else on the
//! clipboard are ignored, since the shelf only holds files.

use std::path::PathBuf;

/// The paths of the files on the clipboard, in clipboard order. Empty when
/// the clipboard holds no files or cannot be read.
#[cfg(target_os = "macos")]
pub fn file_paths() -> Vec<PathBuf> {
    use objc2_app_kit::{NSPasteboard, NSPasteboardTypeFileURL};
    use objc2_foundation::NSURL;

    let pasteboard = NSPasteboard::generalPasteboard();
    let Some(items) = pasteboard.pasteboardItems() else {
        return Vec::new();
    };
    items
        .iter()
        .filter_map(|item| item.stringForType(unsafe { NSPasteboardTypeFileURL }))
        .filter_map(|url| NSURL::URLWithString(&url))
        // Finder may hand out file reference URLs (file:///.file/id=…).
        .filter_map(|url| url.filePathURL())
        .filter_map(|url| url.path())
        .map(|path| PathBuf::from(path.to_string()))
        .collect()
}

#[cfg(windows)]
pub fn file_paths() -> Vec<PathBuf> {
    use std::{ffi::OsString, os::windows::ffi::OsStringExt, ptr, thread, time::Duration};
    use windows_sys::Win32::{
        System::{
            DataExchange::{CloseClipboard, GetClipboardData, OpenClipboard},
            Ole::CF_HDROP,
        },
        UI::Shell::DragQueryFileW,
    };

    // Another app may be holding the clipboard for a moment.
    let mut opened = false;
    for _ in 0..5 {
        if unsafe { OpenClipboard(ptr::null_mut()) } != 0 {
            opened = true;
            break;
        }
        thread::sleep(Duration::from_millis(20));
    }
    if !opened {
        return Vec::new();
    }

    let mut paths = Vec::new();
    let drop = unsafe { GetClipboardData(CF_HDROP as u32) };
    if !drop.is_null() {
        let count = unsafe { DragQueryFileW(drop, u32::MAX, ptr::null_mut(), 0) };
        for i in 0..count {
            let len = unsafe { DragQueryFileW(drop, i, ptr::null_mut(), 0) };
            let mut buf = vec![0u16; len as usize + 1];
            let written = unsafe { DragQueryFileW(drop, i, buf.as_mut_ptr(), buf.len() as u32) };
            if written > 0 {
                paths.push(PathBuf::from(OsString::from_wide(&buf[..written as usize])));
            }
        }
    }
    unsafe { CloseClipboard() };
    paths
}

#[cfg(not(any(target_os = "macos", windows)))]
pub fn file_paths() -> Vec<PathBuf> {
    Vec::new()
}

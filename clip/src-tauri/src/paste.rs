//! Going back to the app that was in front before Clip came up, and typing
//! ⌘V / Ctrl+V there.
//!
//! On macOS, sending keystrokes to other apps needs the Accessibility
//! permission. Without it Clip only puts the text on the clipboard, and the
//! popup says to press ⌘V.

use std::{thread, time::Duration};

/// How long to wait after giving the focus back before pasting, so the other
/// app is ready for the keystroke.
const SETTLE: Duration = Duration::from_millis(150);

pub use imp::{activate, frontmost, trusted, Target};

/// Types the paste shortcut into the app in front, after a moment.
pub fn paste_soon() {
    thread::spawn(|| {
        thread::sleep(SETTLE);
        imp::send_paste();
    });
}

/// Asks for the Accessibility permission (macOS): shows the system's prompt,
/// which also adds Clip to the list in System Settings.
pub fn request_trust() {
    imp::request_trust();
}

#[cfg(target_os = "macos")]
mod imp {
    use std::ffi::c_void;

    use core_foundation_sys::{
        base::{kCFAllocatorDefault, CFRelease},
        dictionary::{
            kCFTypeDictionaryKeyCallBacks, kCFTypeDictionaryValueCallBacks, CFDictionaryCreate, CFDictionaryRef,
        },
        number::kCFBooleanTrue,
        string::CFStringRef,
    };
    use objc2_app_kit::{NSApplicationActivationOptions, NSRunningApplication, NSWorkspace};

    /// The process id of an app.
    pub type Target = i32;

    #[link(name = "ApplicationServices", kind = "framework")]
    extern "C" {
        fn AXIsProcessTrusted() -> bool;
        fn AXIsProcessTrustedWithOptions(options: CFDictionaryRef) -> bool;
        static kAXTrustedCheckOptionPrompt: CFStringRef;
    }

    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGEventSourceCreate(state: i32) -> *mut c_void;
        fn CGEventCreateKeyboardEvent(source: *mut c_void, key: u16, down: bool) -> *mut c_void;
        fn CGEventSetFlags(event: *mut c_void, flags: u64);
        fn CGEventPost(tap: u32, event: *mut c_void);
    }

    const COMBINED_SESSION_STATE: i32 = 0;
    const SESSION_EVENT_TAP: u32 = 1;
    const FLAG_COMMAND: u64 = 0x0010_0000;
    /// kVK_ANSI_V: the V key on both US and JIS keyboards.
    const KEY_V: u16 = 9;

    /// The app in front, unless it is Clip itself.
    pub fn frontmost() -> Option<Target> {
        let app = NSWorkspace::sharedWorkspace().frontmostApplication()?;
        let pid = app.processIdentifier();
        (pid != std::process::id() as i32).then_some(pid)
    }

    pub fn activate(pid: Target) {
        if let Some(app) = NSRunningApplication::runningApplicationWithProcessIdentifier(pid) {
            app.activateWithOptions(NSApplicationActivationOptions(0));
        }
    }

    pub fn trusted() -> bool {
        unsafe { AXIsProcessTrusted() }
    }

    pub fn request_trust() {
        unsafe {
            let keys = [kAXTrustedCheckOptionPrompt as *const c_void];
            let values = [kCFBooleanTrue as *const c_void];
            let options = CFDictionaryCreate(
                kCFAllocatorDefault,
                keys.as_ptr(),
                values.as_ptr(),
                1,
                &kCFTypeDictionaryKeyCallBacks,
                &kCFTypeDictionaryValueCallBacks,
            );
            AXIsProcessTrustedWithOptions(options);
            CFRelease(options as *const c_void);
        }
    }

    pub fn send_paste() {
        if !trusted() {
            return;
        }
        unsafe {
            let source = CGEventSourceCreate(COMBINED_SESSION_STATE);
            for down in [true, false] {
                let event = CGEventCreateKeyboardEvent(source, KEY_V, down);
                if event.is_null() {
                    continue;
                }
                CGEventSetFlags(event, FLAG_COMMAND);
                CGEventPost(SESSION_EVENT_TAP, event);
                CFRelease(event as *const c_void);
            }
            if !source.is_null() {
                CFRelease(source as *const c_void);
            }
        }
    }
}

#[cfg(windows)]
mod imp {
    use std::mem::size_of;

    use windows_sys::Win32::UI::{
        Input::KeyboardAndMouse::{SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP, VK_CONTROL},
        WindowsAndMessaging::{GetForegroundWindow, GetWindowThreadProcessId, SetForegroundWindow},
    };

    /// A window handle (HWND), kept as a number so it can cross threads.
    pub type Target = isize;

    const KEY_V: u16 = 0x56;

    /// The window in front, unless it is one of Clip's.
    pub fn frontmost() -> Option<Target> {
        let hwnd = unsafe { GetForegroundWindow() };
        if hwnd.is_null() {
            return None;
        }
        let mut pid = 0;
        unsafe { GetWindowThreadProcessId(hwnd, &mut pid) };
        (pid != std::process::id()).then_some(hwnd as Target)
    }

    pub fn activate(hwnd: Target) {
        unsafe { SetForegroundWindow(hwnd as _) };
    }

    /// Windows lets any app send keystrokes (except into apps run as
    /// administrator).
    pub fn trusted() -> bool {
        true
    }

    pub fn request_trust() {}

    pub fn send_paste() {
        let key = |vk: u16, up: bool| INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: vk,
                    wScan: 0,
                    dwFlags: if up { KEYEVENTF_KEYUP } else { 0 },
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        };
        let inputs = [key(VK_CONTROL, false), key(KEY_V, false), key(KEY_V, true), key(VK_CONTROL, true)];
        unsafe { SendInput(inputs.len() as u32, inputs.as_ptr(), size_of::<INPUT>() as i32) };
    }
}

/// Other systems (development on Linux): nothing to go back to or paste into.
#[cfg(not(any(target_os = "macos", windows)))]
mod imp {
    pub type Target = ();

    pub fn frontmost() -> Option<Target> {
        None
    }

    pub fn activate(_target: Target) {}

    pub fn trusted() -> bool {
        false
    }

    pub fn request_trust() {}

    pub fn send_paste() {}
}

//! Whether a folder is on a network share (docs/SAFETY.md §8): the status
//! bar says so, and the confirmation before renaming warns about links
//! other people may have to these files.

use std::path::Path;

/// On a network share. False when it can't be told.
pub fn is_network(dir: &Path) -> bool {
    imp::is_network(dir)
}

#[cfg(windows)]
mod imp {
    use std::path::{Component, Path, Prefix};
    use windows::core::PCWSTR;
    use windows::Win32::Storage::FileSystem::GetDriveTypeW;

    /// `DRIVE_REMOTE` from GetDriveTypeW.
    const DRIVE_REMOTE: u32 = 4;

    pub fn is_network(dir: &Path) -> bool {
        let Some(Component::Prefix(prefix)) = dir.components().next() else { return false };
        match prefix.kind() {
            // \\server\share
            Prefix::UNC(..) | Prefix::VerbatimUNC(..) => true,
            // A drive letter, possibly mapped to a share.
            Prefix::Disk(letter) | Prefix::VerbatimDisk(letter) => {
                let root: Vec<u16> = format!("{}:\\", letter as char).encode_utf16().chain([0]).collect();
                unsafe { GetDriveTypeW(PCWSTR(root.as_ptr())) == DRIVE_REMOTE }
            }
            _ => false,
        }
    }
}

#[cfg(target_os = "macos")]
mod imp {
    use std::ffi::{CStr, CString};
    use std::os::unix::ffi::OsStrExt;
    use std::path::Path;

    /// File systems that reach another machine.
    const NETWORK: [&str; 5] = ["smbfs", "afpfs", "nfs", "webdav", "cifs"];

    pub fn is_network(dir: &Path) -> bool {
        let Ok(c) = CString::new(dir.as_os_str().as_bytes()) else { return false };
        let mut st: libc::statfs = unsafe { std::mem::zeroed() };
        if unsafe { libc::statfs(c.as_ptr(), &mut st) } != 0 {
            return false;
        }
        let name = unsafe { CStr::from_ptr(st.f_fstypename.as_ptr()) }.to_string_lossy();
        NETWORK.contains(&name.as_ref())
    }
}

/// Linux isn't a target (only CI's tests run there).
#[cfg(not(any(windows, target_os = "macos")))]
mod imp {
    use std::path::Path;

    pub fn is_network(_dir: &Path) -> bool {
        false
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn local_temp_is_not_network() {
        assert!(!super::is_network(&std::env::temp_dir()));
    }

    #[cfg(windows)]
    #[test]
    fn unc_is_network() {
        assert!(super::is_network(std::path::Path::new(r"\\server\share\folder")));
    }
}

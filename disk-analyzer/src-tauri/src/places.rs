//! The drives the start screen offers (docs/SPEC.md §2), and how much room
//! a volume has. Windows: the drive letters, network ones included. macOS:
//! the startup disk and what is mounted in /Volumes.

use serde::Serialize;

#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Kind {
    Drive,
    Removable,
    Network,
    Home,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Place {
    /// What to scan.
    pub path: String,
    /// The volume's label ("Windows", "Macintosh HD"); empty if it has none.
    pub label: String,
    pub kind: Kind,
    pub space: Option<Space>,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Space {
    pub total: u64,
    /// Free for this user.
    pub free: u64,
}

pub fn list() -> Vec<Place> {
    imp::list()
}

/// The size and free room of the volume `path` is on.
pub fn space(path: &std::path::Path) -> Option<Space> {
    imp::space(path)
}

#[cfg(windows)]
mod imp {
    use super::{Kind, Place, Space};
    use std::path::Path;
    use windows::core::PCWSTR;
    use windows::Win32::Storage::FileSystem::{
        GetDiskFreeSpaceExW, GetDriveTypeW, GetLogicalDriveStringsW, GetVolumeInformationW,
    };

    const DRIVE_REMOVABLE: u32 = 2;
    const DRIVE_FIXED: u32 = 3;
    const DRIVE_REMOTE: u32 = 4;
    const DRIVE_RAMDISK: u32 = 6;

    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain([0]).collect()
    }

    pub fn space(path: &Path) -> Option<Space> {
        let p = wide(&path.display().to_string());
        let (mut free, mut total) = (0u64, 0u64);
        unsafe { GetDiskFreeSpaceExW(PCWSTR(p.as_ptr()), Some(&mut free), Some(&mut total), None) }.ok()?;
        Some(Space { total, free })
    }

    pub fn list() -> Vec<Place> {
        let mut buf = [0u16; 512];
        let n = unsafe { GetLogicalDriveStringsW(Some(&mut buf)) } as usize;
        let mut out = Vec::new();
        // "C:\\\0D:\\\0\0"
        for root in buf[..n.min(buf.len())].split(|&c| c == 0).filter(|s| !s.is_empty()) {
            let root = String::from_utf16_lossy(root);
            let w = wide(&root);
            let kind = match unsafe { GetDriveTypeW(PCWSTR(w.as_ptr())) } {
                DRIVE_FIXED | DRIVE_RAMDISK => Kind::Drive,
                DRIVE_REMOVABLE => Kind::Removable,
                DRIVE_REMOTE => Kind::Network,
                // CD / DVD drives and unknown ones.
                _ => continue,
            };
            let mut label = [0u16; 261];
            let label =
                match unsafe { GetVolumeInformationW(PCWSTR(w.as_ptr()), Some(&mut label), None, None, None, None) } {
                    Ok(()) => String::from_utf16_lossy(&label[..label.iter().position(|&c| c == 0).unwrap_or(0)]),
                    Err(_) => String::new(),
                };
            out.push(Place { space: space(Path::new(&root)), path: root, label, kind });
        }
        out
    }
}

#[cfg(unix)]
mod imp {
    use super::{Kind, Place, Space};
    use std::ffi::CString;
    use std::os::unix::ffi::OsStrExt;
    use std::path::Path;

    pub fn space(path: &Path) -> Option<Space> {
        let c = CString::new(path.as_os_str().as_bytes()).ok()?;
        let mut st: libc::statvfs = unsafe { std::mem::zeroed() };
        if unsafe { libc::statvfs(c.as_ptr(), &mut st) } != 0 {
            return None;
        }
        #[allow(clippy::unnecessary_cast)]
        let unit = st.f_frsize as u64;
        #[allow(clippy::unnecessary_cast)]
        Some(Space { total: st.f_blocks as u64 * unit, free: st.f_bavail as u64 * unit })
    }

    /// The startup disk: since Catalina the user's files are on the data
    /// volume, and "/" is the read-only system one.
    #[cfg(target_os = "macos")]
    pub fn list() -> Vec<Place> {
        let data = Path::new("/System/Volumes/Data");
        let boot = if data.is_dir() { data } else { Path::new("/") };
        let mut boot_label = String::from("Macintosh HD");
        let mut others = Vec::new();
        if let Ok(entries) = std::fs::read_dir("/Volumes") {
            for e in entries.flatten() {
                let name = e.file_name().to_string_lossy().into_owned();
                if name.starts_with('.') {
                    continue;
                }
                let path = e.path();
                // /Volumes/Macintosh HD is a link to "/".
                if std::fs::read_link(&path).is_ok_and(|t| t == Path::new("/")) {
                    boot_label = name;
                    continue;
                }
                if !path.is_dir() {
                    continue;
                }
                let kind = if crate::volume::is_network(&path) { Kind::Network } else { Kind::Removable };
                others.push(Place { space: space(&path), path: path.display().to_string(), label: name, kind });
            }
        }
        let mut out =
            vec![Place { space: space(boot), path: boot.display().to_string(), label: boot_label, kind: Kind::Drive }];
        out.extend(others);
        out
    }

    /// Linux isn't a target (only CI's tests run there).
    #[cfg(not(target_os = "macos"))]
    pub fn list() -> Vec<Place> {
        vec![Place { space: space(Path::new("/")), path: "/".into(), label: String::new(), kind: Kind::Drive }]
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn there_is_a_drive_with_room() {
        let places = super::list();
        assert!(!places.is_empty());
        let s = super::space(&std::env::temp_dir()).unwrap();
        assert!(s.total > 0 && s.free <= s.total);
    }
}

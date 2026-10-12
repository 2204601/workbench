//! Renaming that never replaces a file (docs/SAFETY.md §1), and OS errors
//! put in words the user can act on (§2).
//!
//! `std::fs::rename` replaces whatever is at the destination on both Windows
//! and macOS. Between checking that a name is free and taking it, someone on
//! a share can put a file there; the OS's "fail if it exists" calls close
//! that gap.

use std::io;
use std::path::Path;

/// Renames `from` to `to`, failing with `AlreadyExists` if `to` is taken.
pub fn rename_noreplace(from: &Path, to: &Path) -> io::Result<()> {
    imp::rename_noreplace(from, to)
}

#[cfg(windows)]
mod imp {
    use std::io;
    use std::os::windows::ffi::OsStrExt;
    use std::path::{Component, Path, Prefix};
    use windows::core::PCWSTR;
    use windows::Win32::Storage::FileSystem::{MoveFileExW, MOVE_FILE_FLAGS};

    /// Paths past MAX_PATH need the `\\?\` form for the raw API (std adds
    /// it itself for its own calls).
    fn wide(p: &Path) -> Vec<u16> {
        let plain: Vec<u16> = p.as_os_str().encode_wide().collect();
        if plain.len() < 260 {
            return plain.into_iter().chain([0]).collect();
        }
        let prefixed = match p.components().next() {
            Some(Component::Prefix(pre)) => match pre.kind() {
                Prefix::Disk(_) => format!(r"\\?\{}", p.display()),
                Prefix::UNC(..) => format!(r"\\?\UNC\{}", p.display().to_string().trim_start_matches('\\')),
                _ => p.display().to_string(),
            },
            _ => p.display().to_string(),
        };
        prefixed.encode_utf16().chain([0]).collect()
    }

    pub fn rename_noreplace(from: &Path, to: &Path) -> io::Result<()> {
        let (f, t) = (wide(from), wide(to));
        // No MOVEFILE_REPLACE_EXISTING: fails with ERROR_ALREADY_EXISTS.
        unsafe { MoveFileExW(PCWSTR(f.as_ptr()), PCWSTR(t.as_ptr()), MOVE_FILE_FLAGS(0)) }
            .map_err(|e| io::Error::from_raw_os_error(e.code().0 & 0xFFFF))
    }
}

#[cfg(unix)]
mod imp {
    use std::ffi::CString;
    use std::io;
    use std::os::unix::ffi::OsStrExt;
    use std::path::Path;

    fn c(p: &Path) -> io::Result<CString> {
        CString::new(p.as_os_str().as_bytes()).map_err(|_| io::Error::from(io::ErrorKind::InvalidInput))
    }

    #[cfg(target_os = "macos")]
    fn exclusive(from: &CString, to: &CString) -> i32 {
        unsafe { libc::renamex_np(from.as_ptr(), to.as_ptr(), libc::RENAME_EXCL) }
    }

    #[cfg(target_os = "linux")]
    fn exclusive(from: &CString, to: &CString) -> i32 {
        unsafe { libc::renameat2(libc::AT_FDCWD, from.as_ptr(), libc::AT_FDCWD, to.as_ptr(), libc::RENAME_NOREPLACE) }
    }

    pub fn rename_noreplace(from: &Path, to: &Path) -> io::Result<()> {
        let (f, t) = (c(from)?, c(to)?);
        if exclusive(&f, &t) == 0 {
            return Ok(());
        }
        let e = io::Error::last_os_error();
        match e.raw_os_error() {
            // The file system can't do it (some SMB / NFS mounts): check, then
            // rename. The gap is back, but only there; logged so it shows.
            Some(libc::ENOTSUP) | Some(libc::EINVAL) | Some(libc::ENOSYS) => {
                log::info!("{}: 上書きしないリネームに対応していないため、確認してから変更します", to.display());
                if std::fs::symlink_metadata(to).is_ok() {
                    return Err(io::Error::from(io::ErrorKind::AlreadyExists));
                }
                std::fs::rename(from, to)
            }
            _ => Err(e),
        }
    }
}

/// What went wrong, for the user (docs/SAFETY.md §2).
pub fn explain(e: &io::Error) -> String {
    #[cfg(windows)]
    {
        match e.raw_os_error() {
            Some(32) | Some(33) => return "ほかの人が開いている可能性があります".into(),
            Some(5) => return "変更する権限がありません".into(),
            Some(53) | Some(59) | Some(64) | Some(67) | Some(1231) => {
                return "ネットワークの接続が切れました".into();
            }
            Some(80) | Some(183) => return "同じ名前のファイルがあります".into(),
            Some(2) | Some(3) => return "ファイルが見つかりません（移動・削除された可能性）".into(),
            Some(206) => return "パスが長すぎます".into(),
            _ => {}
        }
    }
    #[cfg(unix)]
    {
        match e.raw_os_error() {
            Some(libc::EBUSY) | Some(libc::ETXTBSY) => return "ほかのアプリが使用中です".into(),
            Some(libc::EHOSTDOWN) | Some(libc::ETIMEDOUT) | Some(libc::ENOTCONN) | Some(libc::EIO) => {
                return "ネットワークの接続が切れたか、読み書きできませんでした".into();
            }
            Some(libc::ENAMETOOLONG) => return "名前かパスが長すぎます".into(),
            _ => {}
        }
    }
    match e.kind() {
        io::ErrorKind::AlreadyExists => "同じ名前のファイルがあります".into(),
        io::ErrorKind::NotFound => "ファイルが見つかりません（移動・削除された可能性）".into(),
        io::ErrorKind::PermissionDenied => "変更する権限がありません".into(),
        _ => format!("変更できませんでした（{e}）"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn never_replaces() {
        let tmp = tempfile::tempdir().unwrap();
        let (a, b) = (tmp.path().join("a.txt"), tmp.path().join("b.txt"));
        fs::write(&a, "a").unwrap();
        fs::write(&b, "b").unwrap();
        let e = rename_noreplace(&a, &b).unwrap_err();
        assert_eq!(e.kind(), io::ErrorKind::AlreadyExists);
        assert_eq!(explain(&e), "同じ名前のファイルがあります");
        // Both files as they were.
        assert_eq!(fs::read_to_string(&a).unwrap(), "a");
        assert_eq!(fs::read_to_string(&b).unwrap(), "b");

        let c = tmp.path().join("名前 c.txt");
        rename_noreplace(&a, &c).unwrap();
        assert!(!a.exists());
        assert_eq!(fs::read_to_string(&c).unwrap(), "a");
    }

    #[test]
    fn missing_source() {
        let tmp = tempfile::tempdir().unwrap();
        let e = rename_noreplace(&tmp.path().join("nope"), &tmp.path().join("x")).unwrap_err();
        assert!(explain(&e).contains("見つかりません"), "{}", explain(&e));
    }
}

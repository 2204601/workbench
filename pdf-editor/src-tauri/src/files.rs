//! Writing files safely, the backups kept before overwriting, and the
//! stamp library (pictures of seals and signatures the user reuses).

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

/// How many backups are kept; the oldest go first.
const BACKUPS_KEPT: usize = 30;

/// Writes `bytes` to `path` through a temporary file in the same folder and
/// a rename, so a failure (disk full, crash) never leaves half a PDF where
/// the old one was.
pub fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let dir = path.parent().ok_or("保存先のフォルダが分かりません")?;
    let name = path.file_name().ok_or("保存先のファイル名が分かりません")?.to_string_lossy();
    let tmp = dir.join(format!(".{name}.{}.tmp", std::process::id()));
    let result = (|| {
        let mut f = fs::File::create(&tmp)?;
        f.write_all(bytes)?;
        f.sync_all()?;
        drop(f);
        fs::rename(&tmp, path)
    })();
    result.map_err(|e| {
        let _ = fs::remove_file(&tmp);
        describe_write_error(&e)
    })
}

fn describe_write_error(e: &std::io::Error) -> String {
    match e.kind() {
        std::io::ErrorKind::PermissionDenied => {
            "保存できませんでした。ほかのアプリで開いているか、書き込みが許可されていない場所です".into()
        }
        std::io::ErrorKind::StorageFull => "保存できませんでした。ディスクの空きが足りません".into(),
        _ => format!("保存できませんでした: {e}"),
    }
}

/// Copies `path` into `dir` before it is overwritten, named with the time,
/// and trims the folder to the newest `BACKUPS_KEPT`. Returns the copy.
pub fn backup(path: &Path, dir: &Path) -> Result<PathBuf, String> {
    fs::create_dir_all(dir).map_err(|e| format!("バックアップのフォルダを作れませんでした: {e}"))?;
    let stamp = super::pdf::pdf_date_now().trim_start_matches("D:").trim_end_matches('Z').to_string();
    let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| "file.pdf".into());
    let target = dir.join(format!("{stamp}_{name}"));
    fs::copy(path, &target).map_err(|e| format!("上書きする前のバックアップを作れませんでした: {e}"))?;
    let mut all: Vec<PathBuf> = fs::read_dir(dir)
        .map(|r| r.filter_map(|e| e.ok().map(|e| e.path())).filter(|p| p.is_file()).collect())
        .unwrap_or_default();
    // The names start with the time, so they sort oldest first.
    all.sort();
    let extra = all.len().saturating_sub(BACKUPS_KEPT);
    for old in &all[..extra] {
        let _ = fs::remove_file(old);
    }
    Ok(target)
}

/// A picture in the stamp library.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Stamp {
    /// The file name in the library folder.
    pub id: String,
    /// What the user called it (the original file's name).
    pub name: String,
}

/// The library: `<app data>/stamps/`, one picture file each, named
/// `<number>_<name>.<ext>`.
pub fn list_stamps(dir: &Path) -> Vec<Stamp> {
    let mut v: Vec<Stamp> = fs::read_dir(dir)
        .map(|r| {
            r.filter_map(|e| e.ok())
                .filter(|e| e.path().is_file())
                .filter_map(|e| {
                    let id = e.file_name().to_string_lossy().into_owned();
                    let stem = Path::new(&id).file_stem()?.to_string_lossy().into_owned();
                    let name = stem.split_once('_').map(|(_, n)| n.to_string()).unwrap_or(stem);
                    Some(Stamp { id, name })
                })
                .collect()
        })
        .unwrap_or_default();
    v.sort_by(|a, b| a.id.cmp(&b.id));
    v
}

/// Adds a picture (already checked to be a PNG or JPEG) to the library.
pub fn add_stamp(dir: &Path, name: &str, bytes: &[u8], mime: &str) -> Result<Stamp, String> {
    fs::create_dir_all(dir).map_err(|e| format!("スタンプを保存できませんでした: {e}"))?;
    let ext = if mime == "image/png" { "png" } else { "jpg" };
    let clean: String =
        name.chars().filter(|c| !matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|')).take(60).collect();
    let n = list_stamps(dir).iter().filter_map(|s| s.id.split('_').next()?.parse::<u32>().ok()).max().unwrap_or(0) + 1;
    let id = format!("{n:04}_{}.{ext}", if clean.is_empty() { "stamp" } else { &clean });
    write_atomic(&dir.join(&id), bytes)?;
    let name = Path::new(&id).file_stem().unwrap().to_string_lossy().split_once('_').map(|(_, n)| n.to_string());
    Ok(Stamp { id, name: name.unwrap_or_default() })
}

/// A stamp's file, refusing names that would leave the library folder.
pub fn stamp_path(dir: &Path, id: &str) -> Result<PathBuf, String> {
    if id.is_empty() || id.contains(['/', '\\']) || id.starts_with('.') {
        return Err("スタンプが見つかりません".into());
    }
    Ok(dir.join(id))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn atomic_write_and_backups() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("a.pdf");
        write_atomic(&file, b"one").unwrap();
        write_atomic(&file, b"two").unwrap();
        assert_eq!(fs::read(&file).unwrap(), b"two");
        // No temporary files left behind.
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 1);
        let backups = dir.path().join("backups");
        let b = backup(&file, &backups).unwrap();
        assert_eq!(fs::read(b).unwrap(), b"two");
        for i in 0..40 {
            fs::write(backups.join(format!("1999{i:02}_x.pdf")), b"old").unwrap();
        }
        backup(&file, &backups).unwrap();
        assert_eq!(fs::read_dir(&backups).unwrap().count(), BACKUPS_KEPT);
    }

    #[test]
    fn stamps() {
        let dir = tempfile::tempdir().unwrap();
        let a = add_stamp(dir.path(), "社印", b"png", "image/png").unwrap();
        let b = add_stamp(dir.path(), "a/b", b"jpg", "image/jpeg").unwrap();
        assert_eq!(a.id, "0001_社印.png");
        assert_eq!(b.id, "0002_ab.jpg");
        let names: Vec<String> = list_stamps(dir.path()).into_iter().map(|s| s.name).collect();
        assert_eq!(names, ["社印", "ab"]);
        assert!(stamp_path(dir.path(), "../x").is_err());
    }
}

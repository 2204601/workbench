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

// ---------------------------------------------------------------- drafts

/// A draft kept while editing (docs/SPEC.md「下書き」): what the frontend
/// holds for a tab, written every half minute to `<app data>/drafts/<id>/`,
/// so a crash or a forced quit loses at most that much. The original file
/// is never touched.
#[derive(serde::Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Draft {
    /// The folder's name: a hash of the file's path.
    pub id: String,
    /// The file the tab was opened from.
    pub path: String,
    /// When it was written, as milliseconds since 1970.
    pub saved_at: u64,
    /// The tab's state, as the frontend wrote it (src/lib/drafts.ts).
    pub json: String,
    /// The pictures the state refers to: image id → file in the folder.
    pub images: Vec<(u32, String)>,
}

/// The folder name for a file's draft: the same path always maps to the
/// same folder, so a new draft replaces the old one.
pub fn draft_id(path: &str) -> String {
    // FNV-1a, 64 bits: no dependency, and collisions don't matter here.
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in path.as_bytes() {
        h ^= *b as u64;
        h = h.wrapping_mul(0x0100_0000_01b3);
    }
    format!("{h:016x}")
}

fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

/// Writes a draft for `path`: its state and the pictures it uses (given as
/// id, bytes, extension). Returns the draft's id.
pub fn write_draft(dir: &Path, path: &str, json: &str, images: &[(u32, &[u8], &str)]) -> Result<String, String> {
    let id = draft_id(path);
    let folder = dir.join(&id);
    fs::create_dir_all(&folder).map_err(|e| format!("下書きのフォルダを作れませんでした: {e}"))?;
    for (img, bytes, ext) in images {
        let file = folder.join(format!("img_{img}.{ext}"));
        if !file.exists() {
            write_atomic(&file, bytes)?;
        }
    }
    let meta = serde_json::json!({ "path": path, "savedAt": now_ms() });
    write_atomic(&folder.join("meta.json"), meta.to_string().as_bytes())?;
    write_atomic(&folder.join("state.json"), json.as_bytes())?;
    Ok(id)
}

/// Every draft in `dir`, newest first. Folders without a readable state
/// are left out (a write that was cut short).
pub fn list_drafts(dir: &Path) -> Vec<Draft> {
    let Ok(entries) = fs::read_dir(dir) else { return Vec::new() };
    let mut out: Vec<Draft> = entries
        .filter_map(|e| e.ok())
        .filter(|e| e.path().is_dir())
        .filter_map(|e| {
            let folder = e.path();
            let id = e.file_name().to_string_lossy().into_owned();
            let meta: serde_json::Value = serde_json::from_slice(&fs::read(folder.join("meta.json")).ok()?).ok()?;
            let json = fs::read_to_string(folder.join("state.json")).ok()?;
            let mut images = Vec::new();
            for f in fs::read_dir(&folder).ok()?.filter_map(|f| f.ok()) {
                let name = f.file_name().to_string_lossy().into_owned();
                if let Some(rest) = name.strip_prefix("img_") {
                    if let Some(n) = rest.split('.').next().and_then(|n| n.parse::<u32>().ok()) {
                        images.push((n, f.path().to_string_lossy().into_owned()));
                    }
                }
            }
            Some(Draft {
                id,
                path: meta["path"].as_str()?.to_string(),
                saved_at: meta["savedAt"].as_u64().unwrap_or(0),
                json,
                images,
            })
        })
        .collect();
    out.sort_by_key(|d| std::cmp::Reverse(d.saved_at));
    out
}

/// Removes a draft's folder; refusing ids that would reach outside.
pub fn remove_draft(dir: &Path, id: &str) -> Result<(), String> {
    if id.is_empty() || !id.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err("下書きが見つかりません".into());
    }
    let folder = dir.join(id);
    if folder.is_dir() {
        fs::remove_dir_all(&folder).map_err(|e| format!("下書きを消せませんでした: {e}"))?;
    }
    Ok(())
}

#[cfg(test)]
mod draft_tests {
    use super::*;

    #[test]
    fn drafts_round_trip() {
        let dir = tempfile::tempdir().unwrap();
        let d = dir.path().join("drafts");
        assert!(list_drafts(&d).is_empty());
        let id = write_draft(&d, "/a/見積書.pdf", r#"{"pages":[]}"#, &[(7, b"png", "png")]).unwrap();
        assert_eq!(id, draft_id("/a/見積書.pdf"));
        // Written again: the same folder, the newer state.
        let id2 = write_draft(&d, "/a/見積書.pdf", r#"{"pages":[1]}"#, &[]).unwrap();
        assert_eq!(id, id2);
        let list = list_drafts(&d);
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].path, "/a/見積書.pdf");
        assert_eq!(list[0].json, r#"{"pages":[1]}"#);
        assert_eq!(list[0].images.len(), 1);
        assert_eq!(list[0].images[0].0, 7);
        assert!(Path::new(&list[0].images[0].1).is_file());
        assert!(remove_draft(&d, "../x").is_err());
        remove_draft(&d, &id).unwrap();
        assert!(list_drafts(&d).is_empty());
        // A folder with a half-written state is ignored.
        fs::create_dir_all(d.join("deadbeef")).unwrap();
        assert!(list_drafts(&d).is_empty());
    }
}

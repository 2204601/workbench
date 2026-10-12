//! Reading what to rename: the files directly in a folder, or files dropped
//! one by one (docs/SPEC.md §4). Sub-folders are not entered and folders
//! themselves are never renamed.
//!
//! Every name in each folder is kept, not only the files shown: a renamed
//! file must not take the name of anything already there, including files
//! the filter hides and sub-folders (docs/SAFETY.md §1).

use serde::Serialize;
use std::collections::{BTreeMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::UNIX_EPOCH;

/// A file that can be renamed.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub id: u32,
    pub dir: PathBuf,
    pub name: String,
    pub size: u64,
    /// ms since the epoch.
    pub modified: i64,
    /// ms since the epoch; None where the file system doesn't keep it.
    pub created: Option<i64>,
}

impl Entry {
    pub fn path(&self) -> PathBuf {
        self.dir.join(&self.name)
    }
}

/// A folder the entries are in.
#[derive(Clone, Debug, Default)]
pub struct Folder {
    /// Everything in it, files and folders, shown or not.
    pub names: Vec<String>,
    /// On a network share (NAS, `\\server\share`, a mapped drive).
    pub network: bool,
}

/// What is loaded: the files to rename and the folders they are in.
#[derive(Clone, Default)]
pub struct FileSet {
    pub entries: Vec<Entry>,
    pub folders: BTreeMap<PathBuf, Folder>,
    next_id: u32,
}

/// Names the OS or Office keep beside the user's files, left out unless
/// asked for (docs/SPEC.md §4).
pub fn is_system_name(name: &str) -> bool {
    let lower = name.to_lowercase();
    matches!(lower.as_str(), "desktop.ini" | "thumbs.db" | ".ds_store") || name.starts_with("~$")
}

#[derive(Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanSummary {
    /// Files added to the list.
    pub added: usize,
    /// Already in the list.
    pub duplicates: usize,
    /// Hidden or system files left out.
    pub excluded: usize,
    /// Paths that couldn't be read, with why.
    pub failed: Vec<String>,
    pub cancelled: bool,
    /// The list was started anew (its ids begin again).
    pub replaced: bool,
}

/// What is read about a file besides its name.
struct FileInfo {
    size: u64,
    modified: i64,
    created: Option<i64>,
    hidden: bool,
}

/// One file's details, or None for anything that isn't a plain file
/// (folders, symbolic links, devices).
fn file_info(path: &Path) -> std::io::Result<Option<FileInfo>> {
    let meta = fs::symlink_metadata(path)?;
    if !meta.file_type().is_file() {
        return Ok(None);
    }
    let ms = |t: std::io::Result<std::time::SystemTime>| {
        t.ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_millis() as i64)
    };
    Ok(Some(FileInfo {
        size: meta.len(),
        modified: ms(meta.modified()).unwrap_or(0),
        created: ms(meta.created()),
        hidden: hidden(path, &meta),
    }))
}

/// Hidden: a leading "." everywhere (macOS leaves "._name" files on shares
/// that Windows users see), and on Windows the hidden / system attributes.
fn hidden(path: &Path, meta: &fs::Metadata) -> bool {
    let dot = path.file_name().and_then(|n| n.to_str()).is_some_and(|n| n.starts_with('.'));
    dot || hidden_attr(meta)
}

#[cfg(windows)]
fn hidden_attr(meta: &fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    const HIDDEN: u32 = 0x2;
    const SYSTEM: u32 = 0x4;
    meta.file_attributes() & (HIDDEN | SYSTEM) != 0
}

#[cfg(not(windows))]
fn hidden_attr(_meta: &fs::Metadata) -> bool {
    false
}

/// Reports progress every so often; returning false stops the scan.
pub trait Progress {
    fn tick(&self, done: usize) -> bool;
}

/// Never stops (tests, small adds).
pub struct NoProgress;
impl Progress for NoProgress {
    fn tick(&self, _done: usize) -> bool {
        true
    }
}

/// A cancel flag shared with the `cancel` command.
pub struct Cancel<'a>(pub &'a AtomicBool);
impl Progress for Cancel<'_> {
    fn tick(&self, _done: usize) -> bool {
        !self.0.load(Ordering::Relaxed)
    }
}

impl FileSet {
    pub fn clear(&mut self) {
        *self = Self::default();
    }

    pub fn get(&self, id: u32) -> Option<&Entry> {
        self.entries.iter().find(|e| e.id == id)
    }

    /// After a rename on disk: the entry at `from` is now at `to` (same
    /// folder), and the folder's names follow.
    pub fn moved(&mut self, from: &Path, to: &Path) {
        let (Some(dir), Some(old), Some(new)) = (from.parent(), from.file_name(), to.file_name()) else { return };
        let (old, new) = (old.to_string_lossy(), new.to_string_lossy().into_owned());
        let Some(e) = self.entries.iter_mut().find(|e| e.dir == dir && e.name == old) else { return };
        e.name = new.clone();
        if let Some(f) = self.folders.get_mut(dir) {
            f.names.retain(|n| *n != old);
            f.names.push(new);
        }
    }

    /// Reads the folder's names (once per folder per scan).
    fn load_folder(&mut self, dir: &Path) -> std::io::Result<()> {
        let names =
            fs::read_dir(dir)?.filter_map(|e| e.ok()).map(|e| e.file_name().to_string_lossy().into_owned()).collect();
        self.folders.insert(dir.to_path_buf(), Folder { names, network: crate::volume::is_network(dir) });
        Ok(())
    }

    fn push(&mut self, dir: &Path, name: String, info: FileInfo) {
        self.next_id += 1;
        self.entries.push(Entry {
            id: self.next_id,
            dir: dir.to_path_buf(),
            name,
            size: info.size,
            modified: info.modified,
            created: info.created,
        });
    }

    /// Adds one file unless it is already listed. `filter`: leave out hidden
    /// and system files.
    fn add_file(&mut self, known: &mut HashSet<PathBuf>, s: &mut ScanSummary, dir: &Path, name: String, filter: bool) {
        let path = dir.join(&name);
        match file_info(&path) {
            Ok(Some(info)) => {
                if filter && (info.hidden || is_system_name(&name)) {
                    s.excluded += 1;
                } else if !known.insert(path) {
                    s.duplicates += 1;
                } else {
                    self.push(dir, name, info);
                    s.added += 1;
                }
            }
            Ok(None) => {}
            Err(e) => s.failed.push(format!("{}: {e}", path.display())),
        }
    }

    /// Adds `paths`: a folder adds the files directly in it, a file adds
    /// itself. `include_hidden` keeps hidden and system files in folders; a
    /// file dropped on its own is always wanted.
    pub fn add(&mut self, paths: &[PathBuf], include_hidden: bool, progress: &dyn Progress) -> ScanSummary {
        let mut s = ScanSummary::default();
        let mut known: HashSet<PathBuf> = self.entries.iter().map(Entry::path).collect();
        let mut seen = 0usize;
        // Each folder's names are read again once per scan: what is on disk now counts.
        let mut fresh: HashSet<PathBuf> = HashSet::new();
        'paths: for path in paths {
            if !progress.tick(seen) {
                s.cancelled = true;
                break;
            }
            let meta = match fs::metadata(path) {
                Ok(m) => m,
                Err(e) => {
                    s.failed.push(format!("{}: {e}", path.display()));
                    continue;
                }
            };
            if meta.is_dir() {
                if let Err(e) = self.load_folder(path) {
                    s.failed.push(format!("{}: {e}", path.display()));
                    continue;
                }
                fresh.insert(path.clone());
                let mut names = self.folders[path].names.clone();
                // A stable order before the list's own sorting.
                names.sort();
                for name in names {
                    seen += 1;
                    if seen.is_multiple_of(64) && !progress.tick(seen) {
                        s.cancelled = true;
                        break 'paths;
                    }
                    self.add_file(&mut known, &mut s, path, name, !include_hidden);
                }
            } else {
                let (Some(dir), Some(name)) = (path.parent(), path.file_name()) else {
                    s.failed.push(format!("{}: ファイル名がありません", path.display()));
                    continue;
                };
                if !fresh.contains(dir) {
                    if let Err(e) = self.load_folder(dir) {
                        s.failed.push(format!("{}: {e}", dir.display()));
                        continue;
                    }
                    fresh.insert(dir.to_path_buf());
                }
                seen += 1;
                self.add_file(&mut known, &mut s, dir, name.to_string_lossy().into_owned(), false);
            }
        }
        s
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn touch(dir: &Path, name: &str) {
        fs::write(dir.join(name), name).unwrap();
    }

    #[test]
    fn folder_adds_its_files_only() {
        let tmp = tempfile::tempdir().unwrap();
        let d = tmp.path();
        touch(d, "b.txt");
        touch(d, "a.jpg");
        touch(d, ".hidden");
        touch(d, "Thumbs.db");
        touch(d, "~$見積.xlsx");
        fs::create_dir(d.join("sub")).unwrap();
        touch(&d.join("sub"), "inner.txt");

        let mut set = FileSet::default();
        let s = set.add(&[d.to_path_buf()], false, &NoProgress);
        let names: Vec<_> = set.entries.iter().map(|e| e.name.as_str()).collect();
        assert_eq!(names, ["a.jpg", "b.txt"]);
        assert_eq!(s.added, 2);
        assert_eq!(s.excluded, 3);
        // Every name in the folder is known, for the conflict checks.
        let mut all = set.folders[d].names.clone();
        all.sort();
        assert_eq!(all, [".hidden", "Thumbs.db", "a.jpg", "b.txt", "sub", "~$見積.xlsx"]);

        // Again: nothing new.
        let s = set.add(&[d.to_path_buf()], false, &NoProgress);
        assert_eq!((s.added, s.duplicates), (0, 2));

        // Hidden files on request.
        let s = set.add(&[d.to_path_buf()], true, &NoProgress);
        assert_eq!(s.added, 3);
    }

    #[test]
    fn single_files_and_missing_paths() {
        let tmp = tempfile::tempdir().unwrap();
        let d = tmp.path();
        touch(d, "one.txt");
        touch(d, ".dotfile");
        let mut set = FileSet::default();
        let s = set.add(&[d.join("one.txt"), d.join(".dotfile"), d.join("nope.txt")], false, &NoProgress);
        assert_eq!(s.added, 2, "a file dropped on its own is kept even when hidden");
        assert_eq!(s.failed.len(), 1);
        assert!(set.folders.contains_key(d));
    }

    #[test]
    fn cancel_stops() {
        struct Stop;
        impl Progress for Stop {
            fn tick(&self, _done: usize) -> bool {
                false
            }
        }
        let tmp = tempfile::tempdir().unwrap();
        touch(tmp.path(), "a.txt");
        let mut set = FileSet::default();
        let s = set.add(&[tmp.path().to_path_buf()], false, &Stop);
        assert!(s.cancelled);
        assert!(set.entries.is_empty());
    }

    #[test]
    fn system_names() {
        assert!(is_system_name("desktop.ini"));
        assert!(is_system_name("Desktop.INI"));
        assert!(is_system_name("~$Book1.xlsx"));
        assert!(!is_system_name("thumbs.db.txt"));
    }
}

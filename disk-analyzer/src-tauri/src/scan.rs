//! Reading a folder and everything under it into a tree of sizes
//! (docs/SPEC.md §3). Nothing is ever written or changed: only names and
//! sizes are read.
//!
//! - Sub-folders are read in parallel (rayon), which is what makes network
//!   shares bearable: each folder takes a round trip, so many go at once.
//! - Links are not followed (symlinks, and on Windows junctions such as
//!   `Application Data`), so nothing is counted twice and loops can't happen.
//! - On macOS / Linux, other volumes mounted inside the folder are left out
//!   (Finder's `/Volumes`, a disk image), as DaisyDisk does.
//! - A file's size is what it takes on the disk where the OS tells us: cloud
//!   files not downloaded (OneDrive "online only", iCloud) count as 0, and a
//!   file with several hard links counts once. See `file_size`.

use rayon::prelude::*;
use serde::Serialize;
use std::collections::{HashSet, VecDeque};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;

/// No parent (the root).
pub const NONE: u32 = u32::MAX;

/// A file or folder in the tree.
#[derive(Clone, Debug)]
pub struct Node {
    pub name: Box<str>,
    /// Bytes: the file, or everything under the folder.
    pub size: u64,
    /// Files under it (1 for a file).
    pub files: u64,
    /// Folders under it, not counting itself.
    pub dirs: u64,
    pub parent: u32,
    /// The children are `nodes[first .. first + len]`, largest first.
    pub first: u32,
    pub len: u32,
    pub dir: bool,
    /// A folder that couldn't be read, whole or in part.
    pub unreadable: bool,
}

impl Node {
    pub fn children(&self) -> std::ops::Range<usize> {
        self.first as usize..(self.first + self.len) as usize
    }
}

/// The result of a scan. Node 0 is the folder scanned; its name is the full path.
#[derive(Debug)]
pub struct Tree {
    pub root: PathBuf,
    pub nodes: Vec<Node>,
}

impl Tree {
    pub fn get(&self, id: u32) -> Option<&Node> {
        self.nodes.get(id as usize)
    }

    /// The node and its parents up to the root, root first.
    pub fn ancestors(&self, id: u32) -> Vec<u32> {
        let mut chain = Vec::new();
        let mut at = id;
        while at != NONE {
            chain.push(at);
            at = self.nodes[at as usize].parent;
        }
        chain.reverse();
        chain
    }

    /// Where the node is on disk.
    pub fn path_of(&self, id: u32) -> PathBuf {
        let mut path = self.root.clone();
        for a in self.ancestors(id).into_iter().skip(1) {
            path.push(&*self.nodes[a as usize].name);
        }
        path
    }
}

/// How far a scan has got, read by the progress events while it runs.
#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Counts {
    pub files: u64,
    pub dirs: u64,
    pub bytes: u64,
    /// The folder being read just now.
    pub path: String,
}

/// What a scan found besides the tree.
#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Notes {
    /// Folders that couldn't be read, whole or in part.
    pub unreadable: u64,
    /// "path: reason" for the first few of them.
    pub errors: Vec<String>,
    /// Files only in the cloud (OneDrive "online only"): counted as 0 bytes.
    pub cloud_files: u64,
    /// What those files would take if downloaded.
    pub cloud_bytes: u64,
}

/// Shared by the threads of one scan.
pub struct Scan<'a> {
    cancel: &'a AtomicBool,
    files: AtomicU64,
    dirs: AtomicU64,
    bytes: AtomicU64,
    current: Mutex<PathBuf>,
    notes: Mutex<Notes>,
    /// Files with more than one hard link already counted, by (device, inode).
    #[cfg_attr(not(unix), allow(dead_code))]
    linked: Mutex<HashSet<(u64, u64)>>,
    /// The volume of the folder scanned; folders on other volumes are left out.
    #[cfg_attr(not(unix), allow(dead_code))]
    device: Option<u64>,
}

const MAX_ERRORS: usize = 20;

impl<'a> Scan<'a> {
    pub fn new(root: &Path, cancel: &'a AtomicBool) -> Self {
        Self {
            cancel,
            files: AtomicU64::new(0),
            dirs: AtomicU64::new(0),
            bytes: AtomicU64::new(0),
            current: Mutex::new(root.to_path_buf()),
            notes: Mutex::new(Notes::default()),
            linked: Mutex::new(HashSet::new()),
            device: device_of(root),
        }
    }

    pub fn counts(&self) -> Counts {
        Counts {
            files: self.files.load(Ordering::Relaxed),
            dirs: self.dirs.load(Ordering::Relaxed),
            bytes: self.bytes.load(Ordering::Relaxed),
            path: self.current.lock().map(|p| p.display().to_string()).unwrap_or_default(),
        }
    }

    pub fn notes(&self) -> Notes {
        self.notes.lock().map(|n| n.clone()).unwrap_or_default()
    }

    pub fn cancelled(&self) -> bool {
        self.cancel.load(Ordering::Relaxed)
    }

    fn failed(&self, path: &Path, e: &std::io::Error) {
        let mut notes = self.notes.lock().unwrap_or_else(|e| e.into_inner());
        notes.unreadable += 1;
        if notes.errors.len() < MAX_ERRORS {
            notes.errors.push(format!("{}: {}", path.display(), reason(e)));
        }
    }

    /// Bytes the file takes, see the module's comment.
    fn file_size(&self, md: &fs::Metadata) -> u64 {
        #[cfg(unix)]
        {
            use std::os::unix::fs::MetadataExt;
            if md.nlink() > 1 {
                let mut seen = self.linked.lock().unwrap_or_else(|e| e.into_inner());
                if !seen.insert((md.dev(), md.ino())) {
                    return 0;
                }
            }
            // Blocks: a sparse file or one evicted to iCloud takes less than its
            // length. Never more, though: block rounding isn't what people look for.
            md.len().min(md.blocks() * 512)
        }
        #[cfg(windows)]
        {
            use std::os::windows::fs::MetadataExt;
            const FILE_ATTRIBUTE_OFFLINE: u32 = 0x1000;
            const FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS: u32 = 0x0040_0000;
            if md.file_attributes() & (FILE_ATTRIBUTE_OFFLINE | FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS) != 0 {
                let mut notes = self.notes.lock().unwrap_or_else(|e| e.into_inner());
                notes.cloud_files += 1;
                notes.cloud_bytes += md.len();
                return 0;
            }
            md.len()
        }
        #[cfg(not(any(unix, windows)))]
        {
            md.len()
        }
    }

    /// Whether `dir` is on the same volume as the folder scanned.
    fn same_volume(&self, dir: &Path) -> bool {
        match self.device {
            Some(root) => device_of(dir).is_none_or(|d| d == root),
            None => true,
        }
    }
}

#[cfg(unix)]
fn device_of(path: &Path) -> Option<u64> {
    use std::os::unix::fs::MetadataExt;
    fs::symlink_metadata(path).ok().map(|m| m.dev())
}

#[cfg(not(unix))]
fn device_of(_path: &Path) -> Option<u64> {
    None
}

/// An error as the user would put it.
pub fn reason(e: &std::io::Error) -> String {
    match e.kind() {
        std::io::ErrorKind::PermissionDenied => "アクセスが許可されていません".into(),
        std::io::ErrorKind::NotFound => "見つかりません（読んでいる間に消えた）".into(),
        _ => e.to_string(),
    }
}

/// A folder or file while reading, before it goes into the tree.
struct Raw {
    name: Box<str>,
    size: u64,
    files: u64,
    dirs: u64,
    dir: bool,
    unreadable: bool,
    kids: Vec<Raw>,
}

impl Raw {
    fn file(name: Box<str>, size: u64) -> Self {
        Self { name, size, files: 1, dirs: 0, dir: false, unreadable: false, kids: Vec::new() }
    }

    fn dir(name: Box<str>) -> Self {
        Self { name, size: 0, files: 0, dirs: 0, dir: true, unreadable: false, kids: Vec::new() }
    }
}

/// Reads one folder, then its sub-folders in parallel. None: a folder on
/// another volume, left out.
fn read_dir(scan: &Scan, path: &Path, name: Box<str>) -> Option<Raw> {
    if !scan.same_volume(path) {
        return None;
    }
    let mut node = Raw::dir(name);
    if scan.cancelled() {
        return Some(node);
    }
    if let Ok(mut current) = scan.current.try_lock() {
        current.clear();
        current.push(path);
    }
    let entries = match fs::read_dir(path) {
        Ok(e) => e,
        Err(e) => {
            scan.failed(path, &e);
            node.unreadable = true;
            return Some(node);
        }
    };
    let mut subdirs = Vec::new();
    let mut part_failed = None;
    for entry in entries {
        let entry = match entry {
            Ok(e) => e,
            Err(e) => {
                part_failed.get_or_insert(e);
                continue;
            }
        };
        let kind = match entry.file_type() {
            Ok(k) => k,
            Err(e) => {
                part_failed.get_or_insert(e);
                continue;
            }
        };
        if kind.is_symlink() {
            continue;
        }
        let name: Box<str> = entry.file_name().to_string_lossy().into();
        if kind.is_dir() {
            subdirs.push((entry.path(), name));
            continue;
        }
        match entry.metadata() {
            Ok(md) => {
                let size = scan.file_size(&md);
                scan.bytes.fetch_add(size, Ordering::Relaxed);
                node.kids.push(Raw::file(name, size));
            }
            Err(e) => {
                part_failed.get_or_insert(e);
            }
        }
    }
    if let Some(e) = part_failed {
        scan.failed(path, &e);
        node.unreadable = true;
    }
    scan.files.fetch_add(node.kids.len() as u64, Ordering::Relaxed);
    scan.dirs.fetch_add(1, Ordering::Relaxed);

    let dirs: Vec<Raw> = subdirs.into_par_iter().filter_map(|(p, n)| read_dir(scan, &p, n)).collect();
    node.kids.extend(dirs);
    for k in &node.kids {
        node.size += k.size;
        node.files += k.files;
        node.dirs += if k.dir { 1 + k.dirs } else { 0 };
    }
    Some(node)
}

/// Reads `root` and everything under it. Stops early when `cancel` is set
/// (check `Scan::cancelled` afterwards: the tree is then incomplete).
pub fn scan(root: &Path, scan: &Scan) -> Result<Tree, String> {
    let md = fs::metadata(root).map_err(|e| format!("{}: {}", root.display(), reason(&e)))?;
    if !md.is_dir() {
        return Err(format!("{} はフォルダではありません", root.display()));
    }
    let raw = read_dir(scan, root, root.display().to_string().into()).unwrap_or_else(|| Raw::dir("".into()));
    Ok(Tree { root: root.to_path_buf(), nodes: flatten(raw) })
}

/// Lays the tree out breadth first, so each folder's children sit side by
/// side, largest first.
fn flatten(root: Raw) -> Vec<Node> {
    let node = |r: &Raw, parent: u32| Node {
        name: r.name.clone(),
        size: r.size,
        files: r.files,
        dirs: r.dirs,
        parent,
        first: 0,
        len: 0,
        dir: r.dir,
        unreadable: r.unreadable,
    };
    let mut nodes = vec![node(&root, NONE)];
    let mut queue = VecDeque::from([(0u32, root)]);
    while let Some((id, mut raw)) = queue.pop_front() {
        raw.kids.sort_by(|a, b| b.size.cmp(&a.size).then_with(|| a.name.cmp(&b.name)));
        nodes[id as usize].first = nodes.len() as u32;
        nodes[id as usize].len = raw.kids.len() as u32;
        for kid in raw.kids {
            let kid_id = nodes.len() as u32;
            nodes.push(node(&kid, id));
            if !kid.kids.is_empty() {
                queue.push_back((kid_id, kid));
            }
        }
    }
    nodes
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write(path: &Path, bytes: usize) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, vec![b'x'; bytes]).unwrap();
    }

    fn run(root: &Path) -> Tree {
        let cancel = AtomicBool::new(false);
        let s = Scan::new(root, &cancel);
        let t = scan(root, &s).unwrap();
        let c = s.counts();
        assert_eq!(c.files, t.nodes[0].files);
        assert_eq!(c.dirs, t.nodes[0].dirs + 1);
        assert_eq!(c.bytes, t.nodes[0].size);
        t
    }

    fn sample() -> tempfile::TempDir {
        let tmp = tempfile::tempdir().unwrap();
        let r = tmp.path();
        write(&r.join("video/a.mp4"), 50_000);
        write(&r.join("video/b.mp4"), 20_000);
        write(&r.join("video/old/c.mov"), 70_000);
        write(&r.join("docs/memo.txt"), 300);
        write(&r.join("top.bin"), 1_000);
        fs::create_dir_all(r.join("empty")).unwrap();
        tmp
    }

    #[test]
    fn sizes_add_up_and_children_are_largest_first() {
        let tmp = sample();
        let t = run(tmp.path());
        let root = &t.nodes[0];
        assert_eq!(root.size, 141_300);
        assert_eq!(root.files, 5);
        assert_eq!(root.dirs, 4);
        assert_eq!(&*root.name, tmp.path().display().to_string());

        let names: Vec<&str> = root.children().map(|i| &*t.nodes[i].name).collect();
        assert_eq!(names, ["video", "top.bin", "docs", "empty"]);
        let video = &t.nodes[root.first as usize];
        assert_eq!((video.size, video.files, video.dirs), (140_000, 3, 1));
        let kids: Vec<&str> = video.children().map(|i| &*t.nodes[i].name).collect();
        assert_eq!(kids, ["old", "a.mp4", "b.mp4"]);

        // Every child points back to its parent.
        for (id, n) in t.nodes.iter().enumerate() {
            for c in n.children() {
                assert_eq!(t.nodes[c].parent as usize, id);
            }
        }
    }

    #[test]
    fn paths_and_ancestors() {
        let tmp = sample();
        let t = run(tmp.path());
        let id = t.nodes.iter().position(|n| &*n.name == "c.mov").unwrap() as u32;
        assert_eq!(t.path_of(id), tmp.path().join("video").join("old").join("c.mov"));
        let chain: Vec<&str> = t.ancestors(id).iter().map(|&a| &*t.nodes[a as usize].name).skip(1).collect();
        assert_eq!(chain, ["video", "old", "c.mov"]);
        assert_eq!(t.path_of(0), tmp.path());
    }

    #[test]
    fn a_file_is_refused() {
        let tmp = sample();
        let cancel = AtomicBool::new(false);
        let file = tmp.path().join("top.bin");
        assert!(scan(&file, &Scan::new(&file, &cancel)).is_err());
    }

    #[test]
    fn cancelled_stops_early() {
        let tmp = sample();
        let cancel = AtomicBool::new(true);
        let s = Scan::new(tmp.path(), &cancel);
        let t = scan(tmp.path(), &s).unwrap();
        assert!(s.cancelled());
        assert_eq!(t.nodes.len(), 1);
    }

    #[cfg(unix)]
    #[test]
    fn links_are_not_followed_and_hard_links_count_once() {
        let tmp = sample();
        let r = tmp.path();
        std::os::unix::fs::symlink(r.join("video"), r.join("docs/link-to-video")).unwrap();
        std::os::unix::fs::symlink(r, r.join("docs/loop")).unwrap();
        fs::hard_link(r.join("video/a.mp4"), r.join("docs/a-again.mp4")).unwrap();
        let t = run(r);
        assert_eq!(t.nodes[0].size, 141_300);
        assert_eq!(t.nodes[0].files, 6);
    }

    #[cfg(unix)]
    #[test]
    fn unreadable_folders_are_noted() {
        use std::os::unix::fs::PermissionsExt;
        let tmp = sample();
        let locked = tmp.path().join("locked");
        write(&locked.join("secret.bin"), 10);
        fs::set_permissions(&locked, fs::Permissions::from_mode(0o000)).unwrap();
        // Root can read anything; nothing to check then.
        if fs::read_dir(&locked).is_ok() {
            fs::set_permissions(&locked, fs::Permissions::from_mode(0o755)).unwrap();
            return;
        }
        let cancel = AtomicBool::new(false);
        let s = Scan::new(tmp.path(), &cancel);
        let t = scan(tmp.path(), &s).unwrap();
        fs::set_permissions(&locked, fs::Permissions::from_mode(0o755)).unwrap();
        let n = t.nodes.iter().find(|n| &*n.name == "locked").unwrap();
        assert!(n.unreadable);
        let notes = s.notes();
        assert_eq!(notes.unreadable, 1);
        assert!(notes.errors[0].contains("アクセスが許可されていません"));
    }
}

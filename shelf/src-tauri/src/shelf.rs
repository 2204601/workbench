//! The shelf itself: an ordered list of file references persisted as JSON.
//!
//! Like Yoink, the shelf only remembers *where* files are. Nothing is copied
//! into the app; dragging an item out hands the original path to the drop
//! target, which then moves or copies it.

use std::{
    fs, io,
    path::{Path, PathBuf},
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShelfItem {
    pub path: String,
    pub name: String,
    pub is_dir: bool,
    pub size: Option<u64>,
    pub added_at: u64,
    /// Recomputed on every read; never trusted from disk.
    #[serde(default, skip_deserializing)]
    pub exists: bool,
}

impl ShelfItem {
    fn from_path(path: &Path) -> io::Result<Self> {
        let meta = fs::metadata(path)?;
        let name = path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| path.to_string_lossy().into_owned());
        Ok(Self {
            path: path.to_string_lossy().into_owned(),
            name,
            is_dir: meta.is_dir(),
            size: meta.is_file().then_some(meta.len()),
            added_at: now_millis(),
            exists: true,
        })
    }
}

pub struct Shelf {
    file: PathBuf,
    items: Mutex<Vec<ShelfItem>>,
}

impl Shelf {
    /// Loads the shelf from `file`, starting empty if it is missing or unreadable.
    pub fn load(file: PathBuf) -> Self {
        let items = fs::read(&file)
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or_default();
        Self {
            file,
            items: Mutex::new(items),
        }
    }

    /// Returns the items, newest first, with `exists` refreshed.
    pub fn list(&self) -> Vec<ShelfItem> {
        let items = self.items.lock().unwrap();
        items
            .iter()
            .cloned()
            .map(|mut item| {
                item.exists = Path::new(&item.path).exists();
                item
            })
            .collect()
    }

    /// Adds paths to the top of the shelf. A path already on the shelf moves
    /// to the top instead of being duplicated. Paths that cannot be read are
    /// skipped. Returns the paths that were actually added.
    pub fn add(&self, paths: &[PathBuf]) -> io::Result<Vec<PathBuf>> {
        let mut items = self.items.lock().unwrap();
        let mut added = Vec::new();
        // Iterate in reverse so the first dropped file ends up on top.
        for path in paths.iter().rev() {
            let Ok(item) = ShelfItem::from_path(path) else {
                continue;
            };
            items.retain(|existing| existing.path != item.path);
            items.insert(0, item);
            added.push(path.clone());
        }
        self.save(&items)?;
        Ok(added)
    }

    pub fn remove(&self, paths: &[String]) -> io::Result<()> {
        let mut items = self.items.lock().unwrap();
        items.retain(|item| !paths.contains(&item.path));
        self.save(&items)
    }

    /// Drops the given paths from the shelf if they no longer exist on disk,
    /// e.g. after they were moved elsewhere by a drag out.
    pub fn prune_missing(&self, paths: &[String]) -> io::Result<()> {
        let mut items = self.items.lock().unwrap();
        items.retain(|item| !paths.contains(&item.path) || Path::new(&item.path).exists());
        self.save(&items)
    }

    pub fn clear(&self) -> io::Result<()> {
        let mut items = self.items.lock().unwrap();
        items.clear();
        self.save(&items)
    }

    fn save(&self, items: &[ShelfItem]) -> io::Result<()> {
        if let Some(dir) = self.file.parent() {
            fs::create_dir_all(dir)?;
        }
        // Write then rename so a crash never leaves a half-written file.
        let tmp = self.file.with_extension("json.tmp");
        fs::write(&tmp, serde_json::to_vec_pretty(items)?)?;
        fs::rename(&tmp, &self.file)
    }
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("shelf-test-{name}-{}", now_millis()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn add_dedupes_and_orders_newest_first() {
        let dir = temp_dir("add");
        let a = dir.join("a.txt");
        let b = dir.join("b.txt");
        fs::write(&a, "a").unwrap();
        fs::write(&b, "bb").unwrap();

        let shelf = Shelf::load(dir.join("shelf.json"));
        shelf.add(&[a.clone(), b.clone()]).unwrap();
        shelf.add(std::slice::from_ref(&b)).unwrap();

        let names: Vec<_> = shelf.list().into_iter().map(|i| i.name).collect();
        assert_eq!(names, ["b.txt", "a.txt"]);
        assert_eq!(shelf.list()[0].size, Some(2));

        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn persists_and_prunes_moved_files() {
        let dir = temp_dir("persist");
        let a = dir.join("a.txt");
        fs::write(&a, "a").unwrap();
        let store = dir.join("shelf.json");

        Shelf::load(store.clone())
            .add(std::slice::from_ref(&a))
            .unwrap();
        let reloaded = Shelf::load(store.clone());
        assert_eq!(reloaded.list().len(), 1);
        assert!(reloaded.list()[0].exists);

        fs::rename(&a, dir.join("moved.txt")).unwrap();
        assert!(!reloaded.list()[0].exists);
        reloaded
            .prune_missing(&[a.to_string_lossy().into_owned()])
            .unwrap();
        assert!(Shelf::load(store).list().is_empty());

        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn skips_unreadable_paths() {
        let dir = temp_dir("missing");
        let shelf = Shelf::load(dir.join("shelf.json"));
        let added = shelf.add(&[dir.join("nope.txt")]).unwrap();
        assert!(added.is_empty());
        assert!(shelf.list().is_empty());
        fs::remove_dir_all(dir).unwrap();
    }
}

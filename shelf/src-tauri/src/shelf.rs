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
    /// Files dropped together share a stack id and are shown, and dragged
    /// out, as one stack.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stack: Option<u64>,
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
            stack: None,
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
    /// skipped. When more than one path is added, they become one stack.
    /// Returns the paths that were actually added.
    pub fn add(&self, paths: &[PathBuf]) -> io::Result<Vec<PathBuf>> {
        let mut items = self.items.lock().unwrap();
        let mut new: Vec<ShelfItem> = Vec::new();
        for item in paths
            .iter()
            .filter_map(|path| ShelfItem::from_path(path).ok())
        {
            if !new.iter().any(|seen| seen.path == item.path) {
                new.push(item);
            }
        }
        let stack = (new.len() > 1).then(|| {
            // Unique even for two drops within the same millisecond.
            let next = items
                .iter()
                .filter_map(|i| i.stack)
                .max()
                .map_or(0, |m| m + 1);
            now_millis().max(next)
        });
        items.retain(|existing| !new.iter().any(|item| item.path == existing.path));
        let added = new.iter().map(|item| PathBuf::from(&item.path)).collect();
        // The first dropped file ends up on top.
        items.splice(
            0..0,
            new.into_iter().map(|item| ShelfItem { stack, ..item }),
        );
        self.save(&items)?;
        Ok(added)
    }

    /// Takes the given paths out of their stacks, leaving them as separate
    /// items where they are.
    pub fn unstack(&self, paths: &[String]) -> io::Result<()> {
        let mut items = self.items.lock().unwrap();
        for item in items.iter_mut().filter(|i| paths.contains(&i.path)) {
            item.stack = None;
        }
        self.save(&items)
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
    fn stacks_files_dropped_together() {
        let dir = temp_dir("stack");
        let [a, b, c] = ["a.txt", "b.txt", "c.txt"].map(|n| dir.join(n));
        for p in [&a, &b, &c] {
            fs::write(p, "x").unwrap();
        }
        let shelf = Shelf::load(dir.join("shelf.json"));

        shelf.add(std::slice::from_ref(&a)).unwrap();
        assert_eq!(shelf.list()[0].stack, None);

        // Re-adding `a` with others pulls it into the new stack.
        shelf.add(&[b.clone(), a.clone()]).unwrap();
        shelf.add(&[c.clone()]).unwrap();
        let list = shelf.list();
        let names: Vec<_> = list.iter().map(|i| i.name.as_str()).collect();
        assert_eq!(names, ["c.txt", "b.txt", "a.txt"]);
        assert_eq!(list[0].stack, None);
        assert!(list[1].stack.is_some());
        assert_eq!(list[1].stack, list[2].stack);

        // A second stack in the same millisecond still gets its own id.
        shelf.add(&[a.clone(), c.clone()]).unwrap();
        let list = shelf.list();
        assert_eq!(list[0].stack, list[1].stack);
        assert_ne!(list[0].stack, list[2].stack);

        shelf.unstack(&[a.to_string_lossy().into_owned()]).unwrap();
        let reloaded = Shelf::load(dir.join("shelf.json")).list();
        assert_eq!(reloaded[0].name, "a.txt");
        assert_eq!(reloaded[0].stack, None);
        assert!(reloaded[1].stack.is_some());

        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn loads_shelves_saved_before_stacks() {
        let dir = temp_dir("old");
        let store = dir.join("shelf.json");
        fs::write(
            &store,
            r#"[{"path":"/x","name":"x","isDir":false,"size":1,"addedAt":1}]"#,
        )
        .unwrap();
        assert_eq!(Shelf::load(store).list()[0].stack, None);
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

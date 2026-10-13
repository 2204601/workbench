//! What the window asks of a scanned tree (docs/SPEC.md §4): the part of it
//! a chart draws, and the contents of one folder for the list. Pure
//! functions of the tree; the tree itself stays in Rust.

use crate::scan::{Tree, NONE};
use serde::Serialize;

/// A node as a chart draws it.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ViewNode {
    /// None for the gray item that stands for the small ones folded together.
    pub id: Option<u32>,
    pub name: String,
    pub size: u64,
    pub dir: bool,
    pub files: u64,
    /// Down to the depth asked for; None below it and for files.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub children: Option<Vec<ViewNode>>,
    /// How many items the folded item stands for (0 otherwise).
    pub folded: u32,
}

/// Deepest a chart may ask for, and the smallest share: together they keep
/// the answer to a few thousand nodes however large the tree.
pub const MAX_DEPTH: u32 = 6;
pub const MIN_SHARE: f64 = 0.0002;

/// The tree under `id`, `depth` levels down. In every folder, items smaller
/// than `min_share` of `id`'s size are folded into one item, so a folder
/// of 5,000 photos is one gray slice instead of 5,000 hairlines.
pub fn view(tree: &Tree, id: u32, depth: u32, min_share: f64) -> Option<ViewNode> {
    let top = tree.get(id)?;
    let min = ((top.size as f64 * min_share.max(MIN_SHARE)) as u64).max(1);
    Some(build(tree, id, depth.min(MAX_DEPTH), min))
}

fn build(tree: &Tree, id: u32, depth: u32, min: u64) -> ViewNode {
    let n = &tree.nodes[id as usize];
    let children = (n.dir && depth > 0).then(|| {
        let mut out = Vec::new();
        let (mut folded, mut folded_size, mut folded_files) = (0u32, 0u64, 0u64);
        // Largest first, so everything after the first small one is small too.
        for c in n.children() {
            let kid = &tree.nodes[c];
            if kid.size >= min {
                out.push(build(tree, c as u32, depth - 1, min));
            } else {
                folded += 1;
                folded_size += kid.size;
                folded_files += kid.files;
            }
        }
        if folded > 0 {
            out.push(ViewNode {
                id: None,
                name: String::new(),
                size: folded_size,
                dir: false,
                files: folded_files,
                children: None,
                folded,
            });
        }
        out
    });
    ViewNode { id: Some(id), name: n.name.to_string(), size: n.size, dir: n.dir, files: n.files, children, folded: 0 }
}

/// A row of the list.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Item {
    pub id: u32,
    pub name: String,
    pub size: u64,
    pub dir: bool,
    pub files: u64,
    pub unreadable: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Crumb {
    pub id: u32,
    pub name: String,
}

/// One folder: where it is, its totals and what is in it.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Folder {
    pub id: u32,
    pub name: String,
    pub path: String,
    pub size: u64,
    pub files: u64,
    pub dirs: u64,
    /// From the folder scanned down to this one (itself included).
    pub crumbs: Vec<Crumb>,
    /// Largest first, at most `limit`.
    pub items: Vec<Item>,
    /// Items past the limit, and their size together.
    pub more: u32,
    pub more_size: u64,
    pub parent: Option<u32>,
}

pub fn folder(tree: &Tree, id: u32, limit: usize) -> Option<Folder> {
    let n = tree.get(id)?;
    let item = |i: usize| {
        let k = &tree.nodes[i];
        Item {
            id: i as u32,
            name: k.name.to_string(),
            size: k.size,
            dir: k.dir,
            files: k.files,
            unreadable: k.unreadable,
        }
    };
    let items: Vec<Item> = n.children().take(limit).map(item).collect();
    let rest = n.children().skip(limit);
    Some(Folder {
        id,
        name: n.name.to_string(),
        path: tree.path_of(id).display().to_string(),
        size: n.size,
        files: n.files,
        dirs: n.dirs,
        crumbs: tree
            .ancestors(id)
            .into_iter()
            .map(|a| Crumb { id: a, name: tree.nodes[a as usize].name.to_string() })
            .collect(),
        more: rest.len() as u32,
        more_size: n.children().skip(limit).map(|i| tree.nodes[i].size).sum(),
        items,
        parent: (n.parent != NONE).then_some(n.parent),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::scan::Node;
    use std::path::PathBuf;

    /// root (1000) → big (900: f1 600, f2 300), small1 (60), small2 (40)
    fn tree() -> Tree {
        let n = |name: &str, size, parent, first, len, dir| Node {
            name: name.into(),
            size,
            files: if dir { 0 } else { 1 },
            dirs: 0,
            parent,
            first,
            len,
            dir,
            unreadable: false,
        };
        Tree {
            root: PathBuf::from("/data"),
            nodes: vec![
                n("/data", 1000, NONE, 1, 3, true),
                n("big", 900, 0, 4, 2, true),
                n("small1", 60, 0, 0, 0, false),
                n("small2", 40, 0, 0, 0, false),
                n("f1", 600, 1, 0, 0, false),
                n("f2", 300, 1, 0, 0, false),
            ],
        }
    }

    #[test]
    fn small_items_fold_into_one() {
        let t = tree();
        let v = view(&t, 0, 3, 0.1).unwrap();
        let kids = v.children.unwrap();
        assert_eq!(kids.len(), 2);
        assert_eq!(kids[0].name, "big");
        assert_eq!(kids[0].children.as_ref().unwrap().len(), 2);
        assert_eq!((kids[1].id, kids[1].folded, kids[1].size), (None, 2, 100));
    }

    #[test]
    fn depth_stops_the_tree() {
        let t = tree();
        let v = view(&t, 0, 1, 0.0).unwrap();
        let kids = v.children.unwrap();
        assert_eq!(kids.len(), 3);
        assert!(kids[0].children.is_none());
        // A sub-folder as the top: its size is the scale.
        let v = view(&t, 1, 2, 0.4).unwrap();
        let kids = v.children.unwrap();
        assert_eq!(kids.len(), 2);
        assert_eq!(kids[1].folded, 1);
        assert!(view(&t, 99, 1, 0.0).is_none());
    }

    #[test]
    fn folder_lists_and_cuts_at_the_limit() {
        let t = tree();
        let f = folder(&t, 1, 10).unwrap();
        assert_eq!(f.crumbs.iter().map(|c| c.name.as_str()).collect::<Vec<_>>(), ["/data", "big"]);
        assert_eq!(f.path, PathBuf::from("/data").join("big").display().to_string());
        assert_eq!(f.parent, Some(0));
        let f = folder(&t, 0, 1).unwrap();
        assert_eq!(f.items.len(), 1);
        assert_eq!((f.more, f.more_size), (2, 100));
        assert_eq!(f.parent, None);
    }
}

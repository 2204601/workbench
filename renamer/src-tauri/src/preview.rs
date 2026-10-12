//! The list the window shows: the loaded files, filtered and sorted, each
//! with its new name and whether it may be renamed (docs/SPEC.md §6).
//!
//! Everything here is pure: it reads the `FileSet` and touches no disk, so
//! it can run on every keystroke and be tested without files.

use crate::natural;
use crate::rules::{self, Context, Rule};
use crate::scan::{Entry, FileSet};
use crate::validate::{self, key};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::Path;

/// The name split at its extension (docs/SPEC.md §5.1): the last "." starts
/// it, except a leading one (".gitignore" is all name). The dot stays with
/// the extension: ("report", ".pdf").
pub fn split_ext(name: &str) -> (&str, &str) {
    match name.rfind('.') {
        Some(i) if i > 0 => name.split_at(i),
        _ => (name, ""),
    }
}

/// The extension as the filter lists it: lower case, no dot; "" for none.
pub fn ext_key(name: &str) -> String {
    split_ext(name).1.trim_start_matches('.').to_lowercase()
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SortBy {
    #[default]
    Name,
    Modified,
    Created,
    Size,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Query {
    /// Extensions to show (`ext_key`); empty shows all.
    pub exts: Vec<String>,
    /// Shown when the name contains this, ignoring case.
    pub contains: String,
    pub sort: SortBy,
    pub desc: bool,
    /// Rows the user unticked: they keep their names.
    pub unchecked: Vec<u32>,
    /// None: every name stays (nothing chosen yet).
    pub rule: Option<Rule>,
    /// The rule applies to the whole name, extension included (§5.1).
    pub include_ext: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Status {
    /// Keeps its name (no change, or unticked).
    Same,
    Change,
    /// Can be renamed, with a caution (docs/SPEC.md §6).
    Warn,
    /// Must not be renamed; blocks running.
    Error,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Row {
    pub id: u32,
    pub dir: String,
    pub name: String,
    pub new_name: String,
    pub status: Status,
    /// Why it is Warn or Error.
    pub message: Option<String>,
    pub checked: bool,
    pub size: u64,
    pub modified: i64,
    pub created: Option<i64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtCount {
    pub ext: String,
    pub count: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderInfo {
    pub path: String,
    pub network: bool,
    pub count: usize,
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Summary {
    /// Files loaded.
    pub total: usize,
    /// Rows after the filter.
    pub shown: usize,
    pub changed: usize,
    pub warnings: usize,
    pub errors: usize,
    /// Every extension loaded, for the filter.
    pub exts: Vec<ExtCount>,
    pub folders: Vec<FolderInfo>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Listing {
    pub rows: Vec<Row>,
    pub summary: Summary,
    /// The rule can't be used (a bad regular expression…): shown under its
    /// field, and the rows are those without the rule.
    pub rule_error: Option<String>,
}

fn shown(e: &Entry, q: &Query, needle: &str) -> bool {
    (q.exts.is_empty() || q.exts.contains(&ext_key(&e.name)))
        && (needle.is_empty() || e.name.to_lowercase().contains(needle))
}

/// The files to show, in the order they are listed (and numbered).
pub fn select<'a>(set: &'a FileSet, q: &Query) -> Vec<&'a Entry> {
    let needle = q.contains.to_lowercase();
    let mut out: Vec<&Entry> = set.entries.iter().filter(|e| shown(e, q, &needle)).collect();
    out.sort_by(|a, b| {
        let ord = match q.sort {
            SortBy::Name => natural::cmp(&a.name, &b.name),
            SortBy::Modified => a.modified.cmp(&b.modified),
            SortBy::Created => a.created.cmp(&b.created),
            SortBy::Size => a.size.cmp(&b.size),
        }
        // Same date or size: by name, then by folder, so the order is stable.
        .then_with(|| natural::cmp(&a.name, &b.name))
        .then_with(|| a.dir.cmp(&b.dir));
        if q.desc {
            ord.reverse()
        } else {
            ord
        }
    });
    out
}

/// The list with each row's new name and whether it may be used.
pub fn listing(set: &FileSet, q: &Query) -> Listing {
    let (compiled, rule_error) = match q.rule.as_ref().map(rules::compile) {
        Some(Ok(c)) => (Some(c), None),
        Some(Err(e)) => (None, Some(e)),
        None => (None, None),
    };
    let unchecked: HashSet<u32> = q.unchecked.iter().copied().collect();
    let mut index = 0usize;
    let mut rows: Vec<Row> = select(set, q)
        .into_iter()
        .map(|e| {
            let checked = !unchecked.contains(&e.id);
            let mut row = Row {
                id: e.id,
                dir: e.dir.to_string_lossy().into_owned(),
                name: e.name.clone(),
                new_name: e.name.clone(),
                status: Status::Same,
                message: None,
                checked,
                size: e.size,
                modified: e.modified,
                created: e.created,
            };
            if let (Some(rule), true) = (&compiled, checked) {
                let parent = e.dir.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
                let cx = Context { index, parent: &parent, modified: e.modified, created: e.created };
                index += 1;
                let (new_name, stem_empty) = if q.include_ext {
                    (rule.apply(&e.name, &cx), false)
                } else {
                    let (stem, ext) = split_ext(&e.name);
                    let new_stem = rule.apply(stem, &cx);
                    let empty = new_stem.is_empty() && !ext.is_empty();
                    (format!("{new_stem}{ext}"), empty)
                };
                row.new_name = new_name;
                check(&mut row, &e.dir, stem_empty);
            }
            row
        })
        .collect();
    conflicts(set, &mut rows);
    let summary = summarize(set, &rows);
    Listing { rows, summary, rule_error }
}

/// One row on its own: its new name's problems and cautions (§6).
fn check(row: &mut Row, dir: &Path, stem_empty: bool) {
    if row.new_name == row.name {
        return;
    }
    if let Some(p) = validate::problem(&row.new_name, stem_empty) {
        row.status = Status::Error;
        row.message = Some(p);
        return;
    }
    row.status = Status::Change;
    let full = dir.join(&row.new_name).to_string_lossy().encode_utf16().count();
    if split_ext(&row.new_name).1.to_lowercase() != split_ext(&row.name).1.to_lowercase() {
        row.status = Status::Warn;
        row.message = Some("拡張子が変わります".into());
    } else if full > validate::LONG_PATH {
        row.status = Status::Warn;
        row.message = Some(format!("パスが長くなります（{full} 文字）。開けないアプリがあります"));
    }
}

/// No two files may end up with one name (docs/SAFETY.md §1, §4): a new
/// name must not be taken by a file that stays (shown or not, sub-folders
/// too) or be given to two rows. A row that can't be renamed stays, which
/// can block the rows whose new name is its name, and so on down the chain:
/// those are followed one by one, so a long chain stays linear.
fn conflicts(set: &FileSet, rows: &mut [Row]) {
    let moving = |r: &Row| matches!(r.status, Status::Change | Status::Warn);
    // (folder, name key): rows carry their folder as text.
    type Key = (String, String);
    let mut staying: HashMap<Key, usize> = HashMap::new();
    for (dir, folder) in &set.folders {
        let dir = dir.to_string_lossy();
        for n in &folder.names {
            *staying.entry((dir.to_string(), key(n))).or_default() += 1;
        }
    }
    let mut targets: HashMap<Key, Vec<usize>> = HashMap::new();
    for (i, r) in rows.iter().enumerate().filter(|(_, r)| moving(r)) {
        if let Some(c) = staying.get_mut(&(r.dir.clone(), key(&r.name))) {
            *c = c.saturating_sub(1);
        }
        targets.entry((r.dir.clone(), key(&r.new_name))).or_default().push(i);
    }
    let mut blocked: Vec<(usize, &'static str)> = Vec::new();
    for (k, ids) in &targets {
        let why = if staying.get(k).copied().unwrap_or(0) > 0 {
            "同じ名前のファイルがあります"
        } else if ids.len() > 1 {
            "一覧のほかのファイルと同じ名前になります"
        } else {
            continue;
        };
        blocked.extend(ids.iter().map(|&i| (i, why)));
    }
    // Each blocked row keeps its name, which then blocks the rows heading for it.
    let mut queue: Vec<usize> = Vec::new();
    let mut done: HashSet<usize> = HashSet::new();
    let mut block = |rows: &mut [Row], i: usize, why: &str, queue: &mut Vec<usize>| {
        if done.insert(i) {
            rows[i].status = Status::Error;
            rows[i].message = Some(why.into());
            queue.push(i);
        }
    };
    for (i, why) in blocked {
        block(rows, i, why, &mut queue);
    }
    while let Some(i) = queue.pop() {
        let held = (rows[i].dir.clone(), key(&rows[i].name));
        for &j in targets.get(&held).into_iter().flatten() {
            if j != i {
                block(rows, j, "同じ名前のファイルがあります", &mut queue);
            }
        }
    }
}

fn summarize(set: &FileSet, rows: &[Row]) -> Summary {
    let mut exts: BTreeMap<String, usize> = BTreeMap::new();
    let mut per_folder: BTreeMap<&std::path::Path, usize> = BTreeMap::new();
    for e in &set.entries {
        *exts.entry(ext_key(&e.name)).or_default() += 1;
        *per_folder.entry(&e.dir).or_default() += 1;
    }
    let count = |s: Status| rows.iter().filter(|r| r.status == s).count();
    Summary {
        total: set.entries.len(),
        shown: rows.len(),
        changed: count(Status::Change) + count(Status::Warn),
        warnings: count(Status::Warn),
        errors: count(Status::Error),
        exts: exts.into_iter().map(|(ext, count)| ExtCount { ext, count }).collect(),
        folders: per_folder
            .into_iter()
            .map(|(dir, count)| FolderInfo {
                path: dir.to_string_lossy().into_owned(),
                network: set.folders.get(dir).is_some_and(|f| f.network),
                count,
            })
            .collect(),
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::scan::{FileSet, Folder};
    use std::path::PathBuf;

    /// A set without files on disk: (folder, name, modified, size).
    pub fn set_of(files: &[(&str, &str, i64, u64)]) -> FileSet {
        let mut set = FileSet::default();
        for (i, (dir, name, modified, size)) in files.iter().enumerate() {
            let dir = PathBuf::from(dir);
            set.folders.entry(dir.clone()).or_insert_with(Folder::default).names.push(name.to_string());
            set.entries.push(Entry {
                id: i as u32 + 1,
                dir,
                name: name.to_string(),
                size: *size,
                modified: *modified,
                created: None,
            });
        }
        set
    }

    #[test]
    fn extensions() {
        assert_eq!(split_ext("report.pdf"), ("report", ".pdf"));
        assert_eq!(split_ext("archive.tar.gz"), ("archive.tar", ".gz"));
        assert_eq!(split_ext(".gitignore"), (".gitignore", ""));
        assert_eq!(split_ext("README"), ("README", ""));
        assert_eq!(split_ext("末尾."), ("末尾", "."));
        assert_eq!(ext_key("Photo.JPG"), "jpg");
        assert_eq!(ext_key("README"), "");
    }

    #[test]
    fn filter_and_sort() {
        let set = set_of(&[
            ("/a", "img10.JPG", 3, 30),
            ("/a", "img2.jpg", 1, 10),
            ("/a", "memo.txt", 2, 20),
            ("/b", "IMG1.jpg", 4, 40),
        ]);
        let names = |q: &Query| select(&set, q).iter().map(|e| e.name.clone()).collect::<Vec<_>>();
        assert_eq!(names(&Query::default()), ["IMG1.jpg", "img2.jpg", "img10.JPG", "memo.txt"]);
        let jpg = Query { exts: vec!["jpg".into()], ..Default::default() };
        assert_eq!(names(&jpg), ["IMG1.jpg", "img2.jpg", "img10.JPG"]);
        let img = Query { contains: "Img".into(), sort: SortBy::Modified, desc: true, ..Default::default() };
        assert_eq!(names(&img), ["IMG1.jpg", "img10.JPG", "img2.jpg"]);
        let by_size = Query { sort: SortBy::Size, ..Default::default() };
        assert_eq!(names(&by_size), ["img2.jpg", "memo.txt", "img10.JPG", "IMG1.jpg"]);
    }

    fn rule(json: &str) -> Option<Rule> {
        Some(serde_json::from_str(json).unwrap())
    }

    fn run(set: &FileSet, q: Query) -> Vec<(String, String, Status)> {
        listing(set, &q).rows.into_iter().map(|r| (r.name, r.new_name, r.status)).collect()
    }

    fn statuses(set: &FileSet, q: Query) -> Vec<Status> {
        run(set, q).into_iter().map(|r| r.2).collect()
    }

    #[test]
    fn numbering_skips_unticked_rows() {
        let set = set_of(&[("/a", "c.jpg", 0, 0), ("/a", "a.jpg", 0, 0), ("/a", "b.jpg", 0, 0)]);
        let q = Query {
            rule: rule(r#"{"kind":"template","template":"写真_{n:2}","start":1,"step":1}"#),
            unchecked: vec![3],
            ..Default::default()
        };
        let rows = run(&set, q);
        assert_eq!(rows[0], ("a.jpg".into(), "写真_01.jpg".into(), Status::Change));
        assert_eq!(rows[1], ("b.jpg".into(), "b.jpg".into(), Status::Same));
        assert_eq!(rows[2], ("c.jpg".into(), "写真_02.jpg".into(), Status::Change));
    }

    #[test]
    fn extension_kept_or_included() {
        let set = set_of(&[("/a", "Photo.JPG", 0, 0)]);
        let lower = r#"{"kind":"normalize","case":"lower"}"#;
        let q = Query { rule: rule(lower), ..Default::default() };
        assert_eq!(run(&set, q)[0].1, "photo.JPG");
        let q = Query { rule: rule(lower), include_ext: true, ..Default::default() };
        // Only the case of the extension: not a caution.
        assert_eq!(run(&set, q)[0], ("Photo.JPG".into(), "photo.jpg".into(), Status::Change));
        let q = Query {
            rule: rule(
                r#"{"kind":"replace","find":"JPG","with":"png","regex":false,"caseSensitive":true,"firstOnly":false}"#,
            ),
            include_ext: true,
            ..Default::default()
        };
        assert_eq!(run(&set, q)[0].2, Status::Warn);
    }

    #[test]
    fn empty_and_forbidden_names_are_errors() {
        let set = set_of(&[("/a", "abc.txt", 0, 0)]);
        let q = Query { rule: rule(r#"{"kind":"trim","start":3,"end":0}"#), ..Default::default() };
        assert_eq!(statuses(&set, q), [Status::Error]);
        let q = Query { rule: rule(r#"{"kind":"insert","text":"a:","atEnd":false}"#), ..Default::default() };
        assert_eq!(statuses(&set, q), [Status::Error]);
    }

    #[test]
    fn bad_rule_keeps_names_and_says_why() {
        let set = set_of(&[("/a", "abc.txt", 0, 0)]);
        let q = Query {
            rule: rule(
                r#"{"kind":"replace","find":"(","with":"","regex":true,"caseSensitive":false,"firstOnly":false}"#,
            ),
            ..Default::default()
        };
        let l = listing(&set, &q);
        assert!(l.rule_error.unwrap().contains("正規表現"));
        assert_eq!(l.rows[0].status, Status::Same);
    }

    #[test]
    fn conflicts_with_files_that_stay() {
        // "b.txt" is filtered out of view, but it is still in the folder.
        let set = set_of(&[("/a", "a.txt", 0, 0), ("/a", "b.txt", 0, 0)]);
        let to_b = r#"{"kind":"replace","find":"a","with":"b","regex":false,"caseSensitive":false,"firstOnly":false}"#;
        let q = Query { rule: rule(to_b), contains: "a.".into(), ..Default::default() };
        assert_eq!(statuses(&set, q), [Status::Error]);
        // A sub-folder's name, in another case.
        let mut set = set_of(&[("/a", "x", 0, 0)]);
        set.folders.get_mut(Path::new("/a")).unwrap().names.push("SUB".into());
        let to_sub =
            r#"{"kind":"replace","find":"x","with":"sub","regex":false,"caseSensitive":false,"firstOnly":false}"#;
        assert_eq!(statuses(&set, Query { rule: rule(to_sub), ..Default::default() }), [Status::Error]);
    }

    #[test]
    fn two_rows_to_one_name() {
        let set = set_of(&[("/a", "a1.txt", 0, 0), ("/a", "a2.txt", 0, 0), ("/b", "a3.txt", 0, 0)]);
        let q = Query {
            rule: rule(
                r#"{"kind":"replace","find":"\\d","with":"","regex":true,"caseSensitive":false,"firstOnly":false}"#,
            ),
            ..Default::default()
        };
        // Same folder: both blocked. Another folder: fine.
        assert_eq!(statuses(&set, q), [Status::Error, Status::Error, Status::Change]);
    }

    #[test]
    fn swaps_chains_and_case_only_are_allowed() {
        // a→b, b→c: b is free once it moves on (M3 orders or uses a temporary name).
        let set = set_of(&[("/a", "a", 0, 0), ("/a", "b", 0, 0)]);
        let next = r#"{"kind":"template","template":"{n}","start":1,"step":1}"#;
        assert_eq!(statuses(&set, Query { rule: rule(next), ..Default::default() }), [Status::Change, Status::Change]);
        let set = set_of(&[("/a", "1", 0, 0), ("/a", "2", 0, 0)]);
        let swap = r#"{"kind":"template","template":"{n}","start":2,"step":-1}"#;
        assert_eq!(statuses(&set, Query { rule: rule(swap), ..Default::default() }), [Status::Change, Status::Change]);
        let set = set_of(&[("/a", "report", 0, 0)]);
        let upper = r#"{"kind":"normalize","case":"capitalize"}"#;
        assert_eq!(run(&set, Query { rule: rule(upper), ..Default::default() })[0].2, Status::Change);
    }

    #[test]
    fn a_blocked_row_blocks_the_one_behind_it() {
        // 1→2 and 2→3, but a "3" is already there: 2 can't move, so 1 can't either.
        let mut set = set_of(&[("/a", "1", 0, 0), ("/a", "2", 0, 0)]);
        set.folders.get_mut(Path::new("/a")).unwrap().names.push("3".into());
        let up = r#"{"kind":"template","template":"{n}","start":2,"step":1}"#;
        let rows = listing(&set, &Query { rule: rule(up), ..Default::default() }).rows;
        assert_eq!(rows[1].status, Status::Error);
        assert_eq!(rows[1].message.as_deref(), Some("同じ名前のファイルがあります"));
        assert_eq!(rows[0].status, Status::Error);
    }

    #[test]
    fn summary_counts_everything_loaded() {
        let set = set_of(&[("/a", "x.jpg", 0, 0), ("/a", "y.JPG", 0, 0), ("/b", "z", 0, 0)]);
        let l = listing(&set, &Query { exts: vec!["".into()], unchecked: vec![3], ..Default::default() });
        assert_eq!(l.rows.len(), 1);
        assert!(!l.rows[0].checked);
        assert_eq!(l.summary.total, 3);
        let exts: Vec<_> = l.summary.exts.iter().map(|e| (e.ext.as_str(), e.count)).collect();
        assert_eq!(exts, [("", 1), ("jpg", 2)]);
        assert_eq!(l.summary.folders.len(), 2);
    }
}

/// 10,000 files read and listed: run with
/// `cargo test --release -- --ignored --nocapture ten_thousand`.
#[cfg(test)]
mod perf {
    use crate::scan::{FileSet, NoProgress};
    use std::time::Instant;

    #[test]
    #[ignore]
    fn ten_thousand() {
        let tmp = tempfile::tempdir().unwrap();
        for i in 0..10_000 {
            std::fs::write(tmp.path().join(format!("現場写真 {i:05}.JPG")), "").unwrap();
        }
        let t = Instant::now();
        let mut set = FileSet::default();
        set.add(&[tmp.path().to_path_buf()], false, &NoProgress);
        let read = t.elapsed();
        let t = Instant::now();
        let l = super::listing(&set, &super::Query::default());
        println!("read {read:?}, listed {:?} ({} rows)", t.elapsed(), l.rows.len());
        assert_eq!(l.rows.len(), 10_000);

        let rule =
            r#"{"kind":"replace","find":"(\\d+)","with":"No.$1","regex":true,"caseSensitive":false,"firstOnly":false}"#;
        let q = super::Query { rule: Some(serde_json::from_str(rule).unwrap()), ..Default::default() };
        let t = Instant::now();
        let l = super::listing(&set, &q);
        println!("regex rule {:?} ({} changed)", t.elapsed(), l.summary.changed);
        assert_eq!(l.summary.changed, 10_000);
    }

    /// 1→2, 2→3, … 9999→10000 with a "10000" already there: every row is
    /// blocked, one after another. Linear, not 10,000 rounds over the list.
    #[test]
    fn long_blocked_chain() {
        let mut files: Vec<(String, i64)> = (1..10_000).map(|i| (i.to_string(), 0)).collect();
        files.push(("10000".into(), 0));
        let refs: Vec<(&str, &str, i64, u64)> = files.iter().map(|(n, m)| ("/a", n.as_str(), *m, 0)).collect();
        let mut set = super::tests::set_of(&refs);
        // "10000" stays: only 1..9999 are in the list.
        set.entries.pop();
        let q = super::Query {
            rule: Some(serde_json::from_str(r#"{"kind":"template","template":"{n}","start":2,"step":1}"#).unwrap()),
            ..Default::default()
        };
        let t = Instant::now();
        let l = super::listing(&set, &q);
        assert!(t.elapsed().as_secs() < 2, "{:?}", t.elapsed());
        assert_eq!(l.summary.errors, 9_999);
    }
}

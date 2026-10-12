//! Running the plan and undoing it (docs/SPEC.md §7, §8; docs/SAFETY.md
//! §1–§3, §6).
//!
//! - Before each rename the file is checked against what was listed, and
//!   the rename itself never replaces anything (fs_os.rs).
//! - Each step is in the journal once done, so a stop at any point — a
//!   failure, the user, a crash — can be undone.
//! - A failure stops the run and waits: undo what was done, skip the file
//!   and go on, or stop here (`Run::go`, `undo`, `Run::finish`).
//! - Nothing is left under a temporary name if it can be helped: skipping or
//!   stopping puts such files back under their old names.

use crate::fs_os;
use crate::journal::{End, Journal};
use crate::plan::{Stage, Step};
use crate::scan::Progress;
use serde::Serialize;
use std::collections::HashSet;
use std::io;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

/// The file system, so tests can make renames fail.
pub trait Fs {
    fn rename(&self, from: &Path, to: &Path) -> io::Result<()>;
    /// Size and modified time (ms), as the list read them.
    fn stat(&self, p: &Path) -> io::Result<(u64, i64)>;
}

pub struct RealFs;

impl Fs for RealFs {
    fn rename(&self, from: &Path, to: &Path) -> io::Result<()> {
        fs_os::rename_noreplace(from, to)
    }

    fn stat(&self, p: &Path) -> io::Result<(u64, i64)> {
        let m = std::fs::symlink_metadata(p)?;
        let modified =
            m.modified().ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map_or(0, |d| d.as_millis() as i64);
        Ok((m.len(), modified))
    }
}

/// A file that couldn't be renamed (or renamed back), and why.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Failure {
    pub name: String,
    pub new_name: String,
    pub folder: String,
    pub reason: String,
}

#[derive(Debug, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum Outcome {
    Completed {
        renamed: usize,
        /// Files that couldn't be put back from a temporary name (paths).
        left_in_temp: Vec<String>,
    },
    /// Waiting for the user: `failure` None means they stopped it.
    Stopped { renamed: usize, remaining: usize, failure: Option<Failure>, left_in_temp: Vec<String> },
}

#[derive(Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UndoReport {
    /// Files back under their old names.
    pub restored: usize,
    pub failed: Vec<Failure>,
    pub cancelled: bool,
}

fn file_name(p: &Path) -> String {
    p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default()
}

fn failure(step: &Step, original: &Path, reason: String) -> Failure {
    Failure {
        name: file_name(original),
        new_name: file_name(&step.to),
        folder: original.parent().map(|d| d.to_string_lossy().into_owned()).unwrap_or_default(),
        reason,
    }
}

/// A run in progress or stopped, held between `go` calls.
pub struct Run {
    pub journal: Journal,
    /// The next step to do.
    at: usize,
    skipped: HashSet<usize>,
    left_in_temp: Vec<String>,
}

impl Run {
    pub fn new(journal: Journal) -> Self {
        Self { journal, at: 0, skipped: HashSet::new(), left_in_temp: Vec::new() }
    }

    /// The step that first put `item`'s file somewhere: its name before the run.
    fn original(&self, item: usize) -> &Path {
        &self.journal.steps.iter().find(|s| s.item == item).expect("a step per item").from
    }

    fn pair(&self, i: usize) -> Option<usize> {
        let s = &self.journal.steps[i];
        let want = match s.stage {
            Stage::ToTemp => Stage::FromTemp,
            Stage::FromTemp => Stage::ToTemp,
            Stage::Direct => return None,
        };
        self.journal.steps.iter().position(|t| t.item == s.item && t.stage == want)
    }

    /// Puts a file left under a temporary name (step `to_temp` done, its
    /// second half not) back under its old name.
    fn put_back(&mut self, fs: &dyn Fs, to_temp: usize) {
        let s = self.journal.steps[to_temp].clone();
        match fs.rename(&s.to, &s.from) {
            Ok(()) => {
                let _ = self.journal.mark_undone(to_temp);
            }
            Err(e) => {
                log::error!("{} を {} に戻せませんでした: {e}", s.to.display(), s.from.display());
                self.left_in_temp.push(s.to.to_string_lossy().into_owned());
            }
        }
    }

    fn remaining(&self) -> usize {
        (self.at..self.journal.steps.len())
            .filter(|&i| self.journal.steps[i].is_final() && !self.journal.done[i] && !self.skipped.contains(&i))
            .count()
    }

    fn stopped(&self, failure: Option<Failure>) -> Outcome {
        Outcome::Stopped {
            renamed: self.journal.renamed(),
            remaining: self.remaining(),
            failure,
            left_in_temp: self.left_in_temp.clone(),
        }
    }

    /// Runs from where it stopped. `skip`: leave out the file that failed.
    pub fn go(&mut self, fs: &dyn Fs, skip: bool, progress: &dyn Progress) -> Outcome {
        if skip && self.at < self.journal.steps.len() {
            let i = self.at;
            self.skipped.insert(i);
            match (self.journal.steps[i].stage, self.pair(i)) {
                // Its second half has nothing to move.
                (Stage::ToTemp, Some(p)) => {
                    self.skipped.insert(p);
                }
                // The file is under its temporary name: back to the old one.
                (Stage::FromTemp, Some(p)) if self.journal.done[p] => self.put_back(fs, p),
                _ => {}
            }
            self.at += 1;
        }
        while self.at < self.journal.steps.len() {
            let i = self.at;
            if self.journal.done[i] || self.skipped.contains(&i) {
                self.at += 1;
                continue;
            }
            if !progress.tick(self.journal.renamed()) {
                return self.stopped(None);
            }
            let step = self.journal.steps[i].clone();
            let original = self.original(step.item).to_path_buf();
            if let (Some(size), Some(modified)) = (step.size, step.modified) {
                match fs.stat(&step.from) {
                    Ok(now) if now == (size, modified) => {}
                    Ok(_) => {
                        return self.stopped(Some(failure(&step, &original, "読み込んだ後に変更されています".into())))
                    }
                    Err(e) => return self.stopped(Some(failure(&step, &original, fs_os::explain(&e)))),
                }
            }
            if let Err(e) = fs.rename(&step.from, &step.to) {
                return self.stopped(Some(failure(&step, &original, fs_os::explain(&e))));
            }
            if let Err(e) = self.journal.mark_done(i) {
                // Renamed but not recorded on disk: this session still knows (done[i]).
                log::error!("ジャーナルに書けませんでした: {e}");
                self.at += 1;
                return self.stopped(Some(failure(&step, &original, format!("記録を書けませんでした（{e}）"))));
            }
            self.at += 1;
        }
        let _ = self.journal.finish(End::Completed);
        Outcome::Completed { renamed: self.journal.renamed(), left_in_temp: self.left_in_temp.clone() }
    }

    /// Stops here for good: what was done stays (and can be undone), files
    /// halfway through go back to their old names.
    pub fn finish(&mut self, fs: &dyn Fs) -> Vec<String> {
        let dangling: Vec<usize> = (0..self.journal.steps.len())
            .filter(|&i| {
                self.journal.steps[i].stage == Stage::ToTemp
                    && self.journal.done[i]
                    && !self.journal.undone[i]
                    && self.pair(i).is_some_and(|p| !self.journal.done[p])
            })
            .collect();
        for i in dangling {
            self.put_back(fs, i);
        }
        let _ = self.journal.finish(End::Stopped);
        self.left_in_temp.clone()
    }
}

/// Puts every file of the journal back under its old name, last step first.
/// A file someone has since moved, or whose old name is taken now, stays as
/// it is and is reported (docs/SAFETY.md §3).
pub fn undo(journal: &mut Journal, fs: &dyn Fs, progress: &dyn Progress) -> UndoReport {
    let mut report = UndoReport::default();
    let mut stuck: HashSet<usize> = HashSet::new();
    let standing: Vec<usize> = journal.standing().collect();
    let originals: Vec<PathBuf> = (0..journal.steps.len())
        .map(|i| journal.steps.iter().find(|s| s.item == journal.steps[i].item).unwrap().from.clone())
        .collect();
    for i in standing.into_iter().rev() {
        let step = journal.steps[i].clone();
        // Its second half couldn't be undone: the file isn't at the temporary name.
        if stuck.contains(&step.item) {
            continue;
        }
        if !progress.tick(report.restored) {
            report.cancelled = true;
            break;
        }
        match fs.rename(&step.to, &step.from) {
            Ok(()) => {
                let _ = journal.mark_undone(i);
                if step.stage != Stage::FromTemp {
                    report.restored += 1;
                }
            }
            Err(e) => {
                stuck.insert(step.item);
                report.failed.push(Failure {
                    name: file_name(&step.to),
                    new_name: file_name(&originals[i]),
                    folder: step.to.parent().map(|d| d.to_string_lossy().into_owned()).unwrap_or_default(),
                    reason: fs_os::explain(&e),
                });
            }
        }
    }
    let all = journal.standing().next().is_none();
    let _ = journal.finish(if all { End::Undone } else { End::Stopped });
    report
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::journal;
    use crate::plan::{plan, temp_name, Move};
    use crate::scan::NoProgress;
    use std::cell::{Cell, RefCell};
    use std::fs;

    /// The real file system, failing the n-th rename (1-based) or any rename
    /// to a name in `refuse`.
    struct Flaky {
        fail_at: Cell<usize>,
        count: Cell<usize>,
        refuse: RefCell<Vec<String>>,
    }
    impl Flaky {
        fn new(fail_at: usize) -> Self {
            Self { fail_at: Cell::new(fail_at), count: Cell::new(0), refuse: RefCell::new(vec![]) }
        }
    }
    impl Fs for Flaky {
        fn rename(&self, from: &Path, to: &Path) -> io::Result<()> {
            self.count.set(self.count.get() + 1);
            if self.count.get() == self.fail_at.get() || self.refuse.borrow().contains(&file_name(to)) {
                return Err(io::Error::from(io::ErrorKind::PermissionDenied));
            }
            RealFs.rename(from, to)
        }
        fn stat(&self, p: &Path) -> io::Result<(u64, i64)> {
            RealFs.stat(p)
        }
    }

    struct Setup {
        _tmp: tempfile::TempDir,
        dir: PathBuf,
        data: PathBuf,
    }

    fn setup(names: &[&str]) -> Setup {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join("files");
        fs::create_dir(&dir).unwrap();
        for n in names {
            fs::write(dir.join(n), n).unwrap();
        }
        let data = tmp.path().join("data");
        Setup { _tmp: tmp, dir, data }
    }

    impl Setup {
        fn run(&self, pairs: &[(&str, &str)]) -> Run {
            let moves: Vec<Move> = pairs
                .iter()
                .map(|(f, t)| {
                    let from = self.dir.join(f);
                    let (size, modified) = RealFs.stat(&from).unwrap();
                    Move { from, to: self.dir.join(t), size, modified }
                })
                .collect();
            let mut n = 0;
            let steps = plan(&moves, &mut |p| {
                n += 1;
                temp_name(p, &format!("t{n}"))
            });
            Run::new(Journal::create(&journal::path(&self.data), steps).unwrap())
        }

        /// Each file's name and its content (which is its original name).
        fn files(&self) -> Vec<(String, String)> {
            let mut v: Vec<_> = fs::read_dir(&self.dir)
                .unwrap()
                .map(|e| {
                    let e = e.unwrap();
                    (e.file_name().to_string_lossy().into_owned(), fs::read_to_string(e.path()).unwrap())
                })
                .collect();
            v.sort();
            v
        }
    }

    fn pairs(v: &[(&str, &str)]) -> Vec<(String, String)> {
        v.iter().map(|(a, b)| (a.to_string(), b.to_string())).collect()
    }

    #[test]
    fn runs_and_undoes() {
        let s = setup(&["1.jpg", "2.jpg", "memo.txt"]);
        // A swap and a plain rename.
        let mut run = s.run(&[("1.jpg", "2.jpg"), ("2.jpg", "1.jpg"), ("memo.txt", "議事録.txt")]);
        let out = run.go(&RealFs, false, &NoProgress);
        assert_eq!(out, Outcome::Completed { renamed: 3, left_in_temp: vec![] });
        assert_eq!(s.files(), pairs(&[("1.jpg", "2.jpg"), ("2.jpg", "1.jpg"), ("議事録.txt", "memo.txt")]));

        // Undone later, from the journal on disk (as after a restart).
        let mut j = Journal::load(&journal::path(&s.data)).unwrap().unwrap();
        assert_eq!(j.end, Some(End::Completed));
        let r = undo(&mut j, &RealFs, &NoProgress);
        assert_eq!(r, UndoReport { restored: 3, failed: vec![], cancelled: false });
        assert_eq!(s.files(), pairs(&[("1.jpg", "1.jpg"), ("2.jpg", "2.jpg"), ("memo.txt", "memo.txt")]));
        assert_eq!(Journal::load(&journal::path(&s.data)).unwrap().unwrap().end, Some(End::Undone));
    }

    #[test]
    fn case_only_change() {
        let s = setup(&["report.pdf"]);
        let mut run = s.run(&[("report.pdf", "Report.pdf")]);
        assert!(matches!(run.go(&RealFs, false, &NoProgress), Outcome::Completed { renamed: 1, .. }));
        assert_eq!(s.files(), pairs(&[("Report.pdf", "report.pdf")]));
    }

    #[test]
    fn never_overwrites_a_file_that_appeared() {
        let s = setup(&["a.txt"]);
        let mut run = s.run(&[("a.txt", "b.txt")]);
        // Someone puts a b.txt there after the preview.
        fs::write(s.dir.join("b.txt"), "someone else's").unwrap();
        let out = run.go(&RealFs, false, &NoProgress);
        let Outcome::Stopped { failure: Some(f), renamed: 0, .. } = out else { panic!("{out:?}") };
        assert_eq!(f.reason, "同じ名前のファイルがあります");
        assert_eq!(fs::read_to_string(s.dir.join("b.txt")).unwrap(), "someone else's");
    }

    #[test]
    fn a_file_changed_since_listing_is_not_renamed() {
        let s = setup(&["a.txt"]);
        let mut run = s.run(&[("a.txt", "b.txt")]);
        fs::write(s.dir.join("a.txt"), "edited, longer than before").unwrap();
        let out = run.go(&RealFs, false, &NoProgress);
        let Outcome::Stopped { failure: Some(f), .. } = out else { panic!("{out:?}") };
        assert_eq!(f.reason, "読み込んだ後に変更されています");
        assert!(s.dir.join("a.txt").exists());
    }

    #[test]
    fn stops_on_failure_then_skips_and_goes_on() {
        let s = setup(&["a", "b", "c"]);
        let fs_ = Flaky::new(2);
        let mut run = s.run(&[("a", "x"), ("b", "y"), ("c", "z")]);
        let out = run.go(&fs_, false, &NoProgress);
        let Outcome::Stopped { renamed: 1, remaining: 2, failure: Some(f), .. } = out else { panic!("{out:?}") };
        assert_eq!((f.name.as_str(), f.new_name.as_str()), ("b", "y"));
        assert_eq!(f.reason, "変更する権限がありません");
        let out = run.go(&fs_, true, &NoProgress);
        assert!(matches!(out, Outcome::Completed { renamed: 2, .. }), "{out:?}");
        assert_eq!(s.files(), pairs(&[("b", "b"), ("x", "a"), ("z", "c")]));
    }

    #[test]
    fn stop_and_undo_what_was_done() {
        let s = setup(&["a", "b", "c"]);
        let mut run = s.run(&[("a", "x"), ("b", "y"), ("c", "z")]);
        let out = run.go(&Flaky::new(3), false, &NoProgress);
        assert!(matches!(out, Outcome::Stopped { renamed: 2, .. }));
        let r = undo(&mut run.journal, &RealFs, &NoProgress);
        assert_eq!(r.restored, 2);
        assert_eq!(s.files(), pairs(&[("a", "a"), ("b", "b"), ("c", "c")]));
    }

    #[test]
    fn halfway_through_a_temporary_name_goes_back() {
        // report → Report: the second half fails, so the file must not stay
        // under its temporary name.
        let s = setup(&["report"]);
        let mut run = s.run(&[("report", "Report")]);
        let fs_ = Flaky::new(2);
        let out = run.go(&fs_, false, &NoProgress);
        assert!(matches!(out, Outcome::Stopped { failure: Some(_), .. }), "{out:?}");
        assert_eq!(s.files(), pairs(&[(".report.renamer-t1.tmp", "report")]));
        // Stop here: back to the old name.
        assert!(run.finish(&RealFs).is_empty());
        assert_eq!(s.files(), pairs(&[("report", "report")]));

        // Same, but skipping instead of stopping.
        let mut run = s.run(&[("report", "Report")]);
        let fs_ = Flaky::new(2);
        run.go(&fs_, false, &NoProgress);
        let out = run.go(&fs_, true, &NoProgress);
        assert!(matches!(out, Outcome::Completed { renamed: 0, .. }), "{out:?}");
        assert_eq!(s.files(), pairs(&[("report", "report")]));
    }

    #[test]
    fn undo_leaves_what_others_changed() {
        let s = setup(&["a", "b"]);
        let mut run = s.run(&[("a", "x"), ("b", "y")]);
        run.go(&RealFs, false, &NoProgress);
        // Someone renamed y meanwhile, and someone made a new "a".
        fs::rename(s.dir.join("y"), s.dir.join("y2")).unwrap();
        fs::write(s.dir.join("a"), "new a").unwrap();
        let r = undo(&mut run.journal, &RealFs, &NoProgress);
        assert_eq!(r.restored, 0);
        assert_eq!(r.failed.len(), 2);
        assert_eq!(s.files(), pairs(&[("a", "new a"), ("x", "a"), ("y2", "b")]));
        // What couldn't be undone stays undoable later.
        assert_eq!(run.journal.end, Some(End::Stopped));
    }

    #[test]
    fn crash_in_the_middle_is_undone_after_restart() {
        let s = setup(&["1", "2"]);
        let mut run = s.run(&[("1", "2"), ("2", "1")]);
        // The swap's first step (to a temporary name) is done, then the app dies.
        let fs_ = Flaky::new(2);
        run.go(&fs_, false, &NoProgress);
        drop(run);
        let mut j = Journal::load(&journal::path(&s.data)).unwrap().unwrap();
        assert_eq!(j.end, None);
        let r = undo(&mut j, &RealFs, &NoProgress);
        assert!(r.failed.is_empty(), "{r:?}");
        assert_eq!(s.files(), pairs(&[("1", "1"), ("2", "2")]));
    }

    #[test]
    fn cancel_stops_without_failure() {
        struct Stop;
        impl Progress for Stop {
            fn tick(&self, _: usize) -> bool {
                false
            }
        }
        let s = setup(&["a"]);
        let mut run = s.run(&[("a", "b")]);
        let out = run.go(&RealFs, false, &Stop);
        assert!(matches!(out, Outcome::Stopped { failure: None, renamed: 0, remaining: 1, .. }));
    }
}

//! The order to rename in (docs/SAFETY.md §6).
//!
//! The preview has already made sure every new name is free once the files
//! moving away from it have moved. What is left is the order:
//!
//! - a → b while b → c: c first, then b, then a (a chain);
//! - a → b while b → a: one of them goes to a temporary name first (a cycle);
//! - report → Report, or only the NFC form changing: the same name to the
//!   file system, so it goes through a temporary name too.
//!
//! Every other file is renamed once, so a share sees no more round trips
//! than needed. Pure: no files, so every case is tested.

use crate::validate::key;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, VecDeque};
use std::path::{Path, PathBuf};

/// One file to rename within its folder.
#[derive(Clone, Debug)]
pub struct Move {
    pub from: PathBuf,
    pub to: PathBuf,
    /// As read when listed: checked again just before renaming (§1).
    pub size: u64,
    pub modified: i64,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Stage {
    /// Straight to the new name.
    Direct,
    /// To a temporary name, out of the way.
    ToTemp,
    /// From the temporary name to the new name.
    FromTemp,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Step {
    pub from: PathBuf,
    pub to: PathBuf,
    pub stage: Stage,
    /// Which `Move` this belongs to.
    pub item: usize,
    /// The file as read (Direct and ToTemp, which start from the user's file).
    pub size: Option<u64>,
    pub modified: Option<i64>,
}

impl Step {
    /// The step that gives the file its new name.
    pub fn is_final(&self) -> bool {
        self.stage != Stage::ToTemp
    }
}

/// `.名前.renamer-1a2b3c4d.tmp` in the same folder: never another folder, so
/// a synced folder sees a rename, not a delete and a create (§6).
pub fn temp_name(from: &Path, tag: &str) -> PathBuf {
    let name = from.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    from.with_file_name(format!(".{name}.renamer-{tag}.tmp"))
}

type Key = (PathBuf, String);

fn key_of(p: &Path) -> Key {
    let dir = p.parent().map(Path::to_path_buf).unwrap_or_default();
    let name = p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    (dir, key(&name))
}

/// The steps for `moves`, in order. `temp` names the temporary file for a
/// move that needs one.
pub fn plan(moves: &[Move], temp: &mut dyn FnMut(&Path) -> PathBuf) -> Vec<Step> {
    let n = moves.len();
    let source: HashMap<Key, usize> = moves.iter().enumerate().map(|(i, m)| (key_of(&m.from), i)).collect();
    // waiters[j]: the moves whose new name is j's current name.
    let mut waiters: HashMap<usize, Vec<usize>> = HashMap::new();
    let mut ready: VecDeque<usize> = VecDeque::new();
    for (i, m) in moves.iter().enumerate() {
        match source.get(&key_of(&m.to)) {
            Some(&j) if j != i => waiters.entry(j).or_default().push(i),
            _ => ready.push_back(i),
        }
    }
    let mut steps = Vec::with_capacity(n + 4);
    let mut done = vec![false; n];
    let mut in_temp: Vec<Option<PathBuf>> = vec![None; n];
    let mut left = n;
    let first = |m: &Move, i: usize, stage: Stage, to: PathBuf| Step {
        from: m.from.clone(),
        to,
        stage,
        item: i,
        size: Some(m.size),
        modified: Some(m.modified),
    };
    while left > 0 {
        while let Some(i) = ready.pop_front() {
            if done[i] {
                continue;
            }
            let m = &moves[i];
            match in_temp[i].take() {
                Some(t) => steps.push(Step {
                    from: t,
                    to: m.to.clone(),
                    stage: Stage::FromTemp,
                    item: i,
                    size: None,
                    modified: None,
                }),
                // Only the case or the NFC form changes: the same name to the file system.
                None if key_of(&m.from) == key_of(&m.to) => {
                    let t = temp(&m.from);
                    steps.push(first(m, i, Stage::ToTemp, t.clone()));
                    steps.push(Step {
                        from: t,
                        to: m.to.clone(),
                        stage: Stage::FromTemp,
                        item: i,
                        size: None,
                        modified: None,
                    });
                }
                None => steps.push(first(m, i, Stage::Direct, m.to.clone())),
            }
            done[i] = true;
            left -= 1;
            ready.extend(waiters.remove(&i).unwrap_or_default());
        }
        if left == 0 {
            break;
        }
        // Everything left waits on another move: a cycle. Move one that
        // others wait on out of the way; its own turn comes when its new name frees up.
        let i = (0..n).find(|&i| !done[i] && in_temp[i].is_none() && waiters.contains_key(&i)).expect("a cycle");
        let t = temp(&moves[i].from);
        steps.push(first(&moves[i], i, Stage::ToTemp, t.clone()));
        in_temp[i] = Some(t);
        ready.extend(waiters.remove(&i).unwrap_or_default());
    }
    steps
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    fn mv(from: &str, to: &str) -> Move {
        Move { from: PathBuf::from(format!("/d/{from}")), to: PathBuf::from(format!("/d/{to}")), size: 0, modified: 0 }
    }

    fn run(moves: &[Move]) -> Vec<Step> {
        let mut n = 0;
        plan(moves, &mut |p| {
            n += 1;
            temp_name(p, &format!("t{n}"))
        })
    }

    /// Plays the steps on a set of names (case-insensitive like Windows):
    /// no step may land on a taken name, and the end state must be right.
    fn simulate(start: &[&str], moves: &[Move], steps: &[Step]) -> HashSet<String> {
        let name = |p: &Path| p.file_name().unwrap().to_string_lossy().into_owned();
        let mut files: HashSet<String> = start.iter().map(|s| s.to_string()).collect();
        for s in steps {
            let (from, to) = (name(&s.from), name(&s.to));
            assert!(files.remove(&from), "{from} missing at {s:?}");
            assert!(!files.iter().any(|f| key(f) == key(&to)), "{to} taken at {s:?}");
            files.insert(to);
        }
        for m in moves {
            assert!(files.contains(&name(&m.to)), "{} not there", name(&m.to));
        }
        files
    }

    #[test]
    fn independent_moves_are_direct() {
        let moves = [mv("a", "x"), mv("b", "y")];
        let steps = run(&moves);
        assert!(steps.iter().all(|s| s.stage == Stage::Direct));
        simulate(&["a", "b"], &moves, &steps);
    }

    #[test]
    fn chain_goes_from_the_end() {
        // a→b, b→c, c→d: d is free, so c first.
        let moves = [mv("a", "b"), mv("b", "c"), mv("c", "d")];
        let steps = run(&moves);
        assert_eq!(steps.len(), 3);
        assert!(steps.iter().all(|s| s.stage == Stage::Direct));
        simulate(&["a", "b", "c"], &moves, &steps);
    }

    #[test]
    fn swap_uses_one_temporary_name() {
        let moves = [mv("1.jpg", "2.jpg"), mv("2.jpg", "1.jpg")];
        let steps = run(&moves);
        assert_eq!(steps.iter().filter(|s| s.stage == Stage::ToTemp).count(), 1);
        assert_eq!(steps.len(), 3);
        simulate(&["1.jpg", "2.jpg"], &moves, &steps);
    }

    /// Each name is the new name of at most one move (the preview makes
    /// sure), so the waits form plain chains and plain cycles.
    #[test]
    fn rotations_beside_chains() {
        let moves = [mv("1", "2"), mv("2", "3"), mv("3", "1"), mv("a", "b"), mv("b", "c"), mv("x", "X")];
        let steps = run(&moves);
        assert_eq!(steps.iter().filter(|s| s.stage == Stage::ToTemp).count(), 2);
        simulate(&["1", "2", "3", "a", "b", "x"], &moves, &steps);
        let moves = [mv("a", "b"), mv("b", "c"), mv("c", "a")];
        let steps = run(&moves);
        assert_eq!(steps.len(), 4);
        simulate(&["a", "b", "c"], &moves, &steps);
    }

    #[test]
    fn case_only_goes_through_a_temporary_name() {
        let moves = [mv("report.pdf", "Report.pdf")];
        let steps = run(&moves);
        assert_eq!(steps.iter().map(|s| s.stage).collect::<Vec<_>>(), [Stage::ToTemp, Stage::FromTemp]);
        assert_eq!(steps[0].to.file_name().unwrap(), ".report.pdf.renamer-t1.tmp");
        simulate(&["report.pdf"], &moves, &steps);
        // NFC only.
        let moves = [mv("\u{30AB}\u{3099}", "ガ")];
        assert_eq!(run(&moves).len(), 2);
    }

    #[test]
    fn many_shifted_by_one() {
        // 1..=500 → 2..=501: one long chain, no temporary names.
        let moves: Vec<Move> = (1..=500).map(|i| mv(&i.to_string(), &(i + 1).to_string())).collect();
        let start: Vec<String> = (1..=500).map(|i| i.to_string()).collect();
        let steps = run(&moves);
        assert!(steps.iter().all(|s| s.stage == Stage::Direct));
        simulate(&start.iter().map(String::as_str).collect::<Vec<_>>(), &moves, &steps);
    }

    #[test]
    fn folders_dont_interact() {
        let moves = [
            Move { from: "/a/x".into(), to: "/a/y".into(), size: 0, modified: 0 },
            Move { from: "/b/y".into(), to: "/b/x".into(), size: 0, modified: 0 },
        ];
        assert!(run(&moves).iter().all(|s| s.stage == Stage::Direct));
    }

    /// Random batches: some files trade names (cycles, chains), some take
    /// new names, some only change case. Every plan must play out cleanly.
    #[test]
    fn random_batches() {
        let mut seed: u64 = 0x2545F4914F6CDD1D;
        let mut rnd = |n: usize| {
            seed ^= seed << 13;
            seed ^= seed >> 7;
            seed ^= seed << 17;
            (seed % n as u64) as usize
        };
        for _ in 0..300 {
            let n = 1 + rnd(12);
            let names: Vec<String> = (0..n).map(|i| format!("f{i}")).collect();
            // Targets: a shuffled pick of the existing names and some new ones.
            let mut pool: Vec<String> = names.clone();
            pool.extend((0..n).map(|i| format!("new{i}")));
            for i in (1..pool.len()).rev() {
                let j = rnd(i + 1);
                pool.swap(i, j);
            }
            let mut moves = Vec::new();
            let mut taken: Vec<String> = Vec::new();
            for (i, from) in names.iter().enumerate() {
                match rnd(4) {
                    0 => {} // stays
                    1 => moves.push(mv(from, &from.to_uppercase())),
                    _ => {
                        let to = pool[i].clone();
                        if to != *from && !taken.contains(&to) {
                            taken.push(to.clone());
                            moves.push(mv(from, &to));
                        }
                    }
                }
            }
            // As the preview allows: a name taken only by a file that moves
            // away. A dropped move keeps its file, which can drop another.
            loop {
                let moving: Vec<String> =
                    moves.iter().map(|m| m.from.file_name().unwrap().to_string_lossy().into_owned()).collect();
                let staying: Vec<&String> = names.iter().filter(|n| !moving.contains(n)).collect();
                let before = moves.len();
                let target = |m: &Move| key(&m.to.file_name().unwrap().to_string_lossy());
                let targets: Vec<String> = moves.iter().map(target).collect();
                moves.retain(|m| {
                    let to = target(m);
                    !staying.iter().any(|s| key(s) == to) && targets.iter().filter(|t| **t == to).count() == 1
                });
                if moves.len() == before {
                    break;
                }
            }
            let start: Vec<&str> = names.iter().map(String::as_str).collect();
            let steps = run(&moves);
            simulate(&start, &moves, &steps);
        }
    }
}

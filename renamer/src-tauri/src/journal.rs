//! The record of the last run, so it can be undone even after the app
//! closed or crashed in the middle (docs/SAFETY.md「ジャーナル」).
//!
//! `journal.jsonl` in the app data folder, one per app: the next run
//! replaces it. JSON Lines, appended to as steps finish, so 10,000 steps
//! don't rewrite the file 10,000 times:
//!
//! ```text
//! {"v":1,"id":"…","started":1760000000000,"steps":[{…}, …]}   header, synced before the first rename
//! {"done":0}                                                  a step finished
//! {"undone":0}                                                a step reversed
//! {"end":"completed"}                                         completed / stopped / undone
//! ```
//!
//! Each line reaches the OS before the next rename, so a crashed app leaves
//! a complete record; the file is synced at the start and the end.

use crate::plan::Step;
use serde::{Deserialize, Serialize};
use std::fs::{self, File, OpenOptions};
use std::io::{self, BufRead, BufReader, Write};
use std::path::{Path, PathBuf};

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum End {
    Completed,
    /// Stopped by a failure or the user; what was done stays, and can be undone.
    Stopped,
    Undone,
}

#[derive(Debug, Serialize, Deserialize)]
struct Header {
    v: u32,
    id: String,
    started: i64,
    steps: Vec<Step>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(untagged)]
enum Line {
    Done { done: usize },
    Undone { undone: usize },
    End { end: End },
}

pub struct Journal {
    path: PathBuf,
    file: File,
    pub id: String,
    pub started: i64,
    pub steps: Vec<Step>,
    pub done: Vec<bool>,
    pub undone: Vec<bool>,
    pub end: Option<End>,
}

pub fn path(data_dir: &Path) -> PathBuf {
    data_dir.join("journal.jsonl")
}

impl Journal {
    /// A new journal for `steps`, replacing the last one.
    pub fn create(path: &Path, steps: Vec<Step>) -> io::Result<Self> {
        if let Some(dir) = path.parent() {
            fs::create_dir_all(dir)?;
        }
        let header = Header {
            v: 1,
            id: uuid::Uuid::new_v4().simple().to_string(),
            started: chrono::Utc::now().timestamp_millis(),
            steps,
        };
        let mut file = File::create(path)?;
        serde_json::to_writer(&mut file, &header)?;
        file.write_all(b"\n")?;
        file.sync_all()?;
        let n = header.steps.len();
        Ok(Self {
            path: path.to_path_buf(),
            file,
            id: header.id,
            started: header.started,
            steps: header.steps,
            done: vec![false; n],
            undone: vec![false; n],
            end: None,
        })
    }

    /// The last journal, or None if there is none. A line cut short by a
    /// crash is the last one and is ignored.
    pub fn load(path: &Path) -> io::Result<Option<Self>> {
        let file = match File::open(path) {
            Ok(f) => f,
            Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(None),
            Err(e) => return Err(e),
        };
        let mut lines = BufReader::new(file).lines();
        let Some(first) = lines.next().transpose()? else { return Ok(None) };
        let header: Header = serde_json::from_str(&first).map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;
        let n = header.steps.len();
        let (mut done, mut undone, mut end) = (vec![false; n], vec![false; n], None);
        for line in lines {
            let Ok(line) = line else { break };
            match serde_json::from_str::<Line>(&line) {
                Ok(Line::Done { done: i }) if i < n => done[i] = true,
                Ok(Line::Undone { undone: i }) if i < n => undone[i] = true,
                Ok(Line::End { end: e }) => end = Some(e),
                _ => {}
            }
        }
        let mut file = OpenOptions::new().append(true).open(path)?;
        // A line cut off by a crash: end it, so the next line stands on its own.
        if fs::read(path)?.last() != Some(&b'\n') {
            file.write_all(b"\n")?;
        }
        Ok(Some(Self {
            path: path.to_path_buf(),
            file,
            id: header.id,
            started: header.started,
            steps: header.steps,
            done,
            undone,
            end,
        }))
    }

    fn append(&mut self, line: &Line) -> io::Result<()> {
        let mut buf = serde_json::to_vec(line)?;
        buf.push(b'\n');
        // One write per line: a crash leaves whole lines or a cut-off last one.
        self.file.write_all(&buf)
    }

    pub fn mark_done(&mut self, i: usize) -> io::Result<()> {
        self.done[i] = true;
        self.append(&Line::Done { done: i })
    }

    pub fn mark_undone(&mut self, i: usize) -> io::Result<()> {
        self.undone[i] = true;
        self.append(&Line::Undone { undone: i })
    }

    pub fn finish(&mut self, end: End) -> io::Result<()> {
        self.end = Some(end);
        self.append(&Line::End { end })?;
        self.file.sync_all()
    }

    /// Steps done and not reversed.
    pub fn standing(&self) -> impl Iterator<Item = usize> + '_ {
        (0..self.steps.len()).filter(|&i| self.done[i] && !self.undone[i])
    }

    /// Files that have their new name now.
    pub fn renamed(&self) -> usize {
        self.standing().filter(|&i| self.steps[i].is_final()).count()
    }

    pub fn path(&self) -> &Path {
        &self.path
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::plan::Stage;

    fn step(from: &str, to: &str) -> Step {
        Step { from: from.into(), to: to.into(), stage: Stage::Direct, item: 0, size: Some(1), modified: Some(2) }
    }

    #[test]
    fn written_and_read_back() {
        let tmp = tempfile::tempdir().unwrap();
        let p = path(tmp.path());
        assert!(Journal::load(&p).unwrap().is_none());
        let mut j = Journal::create(&p, vec![step("/a", "/b"), step("/c", "/d"), step("/e", "/f")]).unwrap();
        j.mark_done(0).unwrap();
        j.mark_done(1).unwrap();
        j.mark_undone(1).unwrap();
        drop(j);
        let j = Journal::load(&p).unwrap().unwrap();
        assert_eq!(j.done, [true, true, false]);
        assert_eq!(j.undone, [false, true, false]);
        assert_eq!(j.end, None, "no end: the app stopped in the middle");
        assert_eq!(j.standing().collect::<Vec<_>>(), [0]);
        assert_eq!(j.steps[0], step("/a", "/b"));
    }

    #[test]
    fn a_cut_off_last_line_is_ignored() {
        let tmp = tempfile::tempdir().unwrap();
        let p = path(tmp.path());
        let mut j = Journal::create(&p, vec![step("/a", "/b"), step("/c", "/d")]).unwrap();
        j.mark_done(0).unwrap();
        drop(j);
        let mut f = OpenOptions::new().append(true).open(&p).unwrap();
        f.write_all(br#"{"don"#).unwrap();
        let mut j = Journal::load(&p).unwrap().unwrap();
        assert_eq!(j.done, [true, false]);
        // And it can still be appended to.
        j.finish(End::Stopped).unwrap();
        assert_eq!(Journal::load(&p).unwrap().unwrap().end, Some(End::Stopped));
    }

    #[test]
    fn a_new_run_replaces_the_last() {
        let tmp = tempfile::tempdir().unwrap();
        let p = path(tmp.path());
        let mut j = Journal::create(&p, vec![step("/a", "/b")]).unwrap();
        j.mark_done(0).unwrap();
        j.finish(End::Completed).unwrap();
        let first = j.id.clone();
        let j = Journal::create(&p, vec![step("/x", "/y")]).unwrap();
        assert_ne!(j.id, first);
        let j = Journal::load(&p).unwrap().unwrap();
        assert_eq!((j.done[0], j.end), (false, None));
    }
}

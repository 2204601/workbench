//! Snippets, the clipboard history and the settings, each kept as a JSON
//! file in the app data folder.
//!
//! Snippets are what people register themselves (an e-mail address, a phone
//! number, a signature); the history is what they copied, recorded on its
//! own and capped by count and age.

use std::{
    fs, io,
    path::{Path, PathBuf},
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{de::DeserializeOwned, Deserialize, Serialize};

/// Copies longer than this (in bytes) are not recorded.
pub const MAX_TEXT_BYTES: usize = 100_000;
/// The shortcuts that can be picked in the settings. The first is the default.
pub const SHORTCUTS: [&str; 4] = ["Ctrl+Alt+C", "Ctrl+Alt+V", "Ctrl+Shift+Space", "Ctrl+Alt+Space"];
pub const HISTORY_LIMITS: [usize; 4] = [50, 100, 200, 500];
pub const HISTORY_DAYS: [u32; 5] = [1, 7, 30, 90, 365];
/// How long a label made up from a snippet's text may get.
const LABEL_CHARS: usize = 30;
const DAY_MILLIS: u64 = 24 * 60 * 60 * 1000;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Snippet {
    pub id: u64,
    pub label: String,
    pub text: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryItem {
    pub id: u64,
    pub text: String,
    pub copied_at: u64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub record_history: bool,
    pub history_limit: usize,
    pub history_days: u32,
    pub shortcut: String,
}

impl Default for Settings {
    fn default() -> Self {
        Self { record_history: true, history_limit: 200, history_days: 30, shortcut: SHORTCUTS[0].into() }
    }
}

impl Settings {
    /// Puts values that can't be picked in the settings (an edited file, an
    /// older version's) back to their defaults.
    fn sanitized(mut self) -> Self {
        let default = Self::default();
        if !HISTORY_LIMITS.contains(&self.history_limit) {
            self.history_limit = default.history_limit;
        }
        if !HISTORY_DAYS.contains(&self.history_days) {
            self.history_days = default.history_days;
        }
        if !SHORTCUTS.contains(&self.shortcut.as_str()) {
            self.shortcut = default.shortcut;
        }
        self
    }
}

pub struct Store {
    dir: PathBuf,
    snippets: Mutex<Vec<Snippet>>,
    history: Mutex<Vec<HistoryItem>>,
    settings: Mutex<Settings>,
}

impl Store {
    /// Loads everything from `dir`. A missing or unreadable file starts empty
    /// (or with the default settings).
    pub fn load(dir: PathBuf) -> Self {
        let snippets = read(&dir.join(SNIPPETS)).unwrap_or_default();
        let settings = read::<Settings>(&dir.join(SETTINGS)).unwrap_or_default().sanitized();
        let mut history: Vec<HistoryItem> = read(&dir.join(HISTORY)).unwrap_or_default();
        prune(&mut history, &settings, now_millis());
        Self { dir, snippets: Mutex::new(snippets), history: Mutex::new(history), settings: Mutex::new(settings) }
    }

    // Snippets ---------------------------------------------------------------

    pub fn snippets(&self) -> Vec<Snippet> {
        self.snippets.lock().unwrap().clone()
    }

    /// Adds a snippet at the end. A blank label is made up from the text.
    pub fn add_snippet(&self, label: &str, text: &str) -> io::Result<Snippet> {
        let mut snippets = self.snippets.lock().unwrap();
        let snippet =
            Snippet { id: next_id(snippets.iter().map(|s| s.id)), label: label_for(label, text), text: text.into() };
        snippets.push(snippet.clone());
        self.save(SNIPPETS, &*snippets)?;
        Ok(snippet)
    }

    /// Changes a snippet's label and text. Unknown ids are ignored.
    pub fn update_snippet(&self, id: u64, label: &str, text: &str) -> io::Result<()> {
        let mut snippets = self.snippets.lock().unwrap();
        if let Some(snippet) = snippets.iter_mut().find(|s| s.id == id) {
            snippet.label = label.trim().to_string();
            snippet.text = text.into();
        }
        self.save(SNIPPETS, &*snippets)
    }

    pub fn delete_snippet(&self, id: u64) -> io::Result<()> {
        let mut snippets = self.snippets.lock().unwrap();
        snippets.retain(|s| s.id != id);
        self.save(SNIPPETS, &*snippets)
    }

    /// Moves a snippet `by` places up (negative) or down (positive), stopping
    /// at either end.
    pub fn move_snippet(&self, id: u64, by: i64) -> io::Result<()> {
        let mut snippets = self.snippets.lock().unwrap();
        if let Some(from) = snippets.iter().position(|s| s.id == id) {
            let to = (from as i64 + by).clamp(0, snippets.len() as i64 - 1) as usize;
            let snippet = snippets.remove(from);
            snippets.insert(to, snippet);
        }
        self.save(SNIPPETS, &*snippets)
    }

    /// Turns a history entry into a snippet, keeping it in the history too.
    pub fn snippet_from_history(&self, id: u64) -> io::Result<Option<Snippet>> {
        let text = self.history.lock().unwrap().iter().find(|h| h.id == id).map(|h| h.text.clone());
        text.map(|text| self.add_snippet("", &text)).transpose()
    }

    // History ----------------------------------------------------------------

    /// The history, newest first.
    pub fn history(&self) -> Vec<HistoryItem> {
        let mut history = self.history.lock().unwrap();
        // Entries age out while the app keeps running too.
        prune(&mut history, &self.settings(), now_millis());
        history.clone()
    }

    /// Records a copy. Blank and very long text is skipped; text already in
    /// the history moves to the top instead of showing up twice. Returns
    /// whether the history changed.
    pub fn record(&self, text: &str) -> io::Result<bool> {
        let settings = self.settings();
        if !settings.record_history || text.trim().is_empty() || text.len() > MAX_TEXT_BYTES {
            return Ok(false);
        }
        let mut history = self.history.lock().unwrap();
        let now = now_millis();
        let id = match history.iter().position(|h| h.text == text) {
            Some(i) => history.remove(i).id,
            None => next_id(history.iter().map(|h| h.id)),
        };
        history.insert(0, HistoryItem { id, text: text.into(), copied_at: now });
        prune(&mut history, &settings, now);
        self.save(HISTORY, &*history)?;
        Ok(true)
    }

    /// Moves an entry back to the top, e.g. after it was pasted again.
    pub fn touch(&self, id: u64) -> io::Result<()> {
        let mut history = self.history.lock().unwrap();
        if let Some(i) = history.iter().position(|h| h.id == id) {
            let mut item = history.remove(i);
            item.copied_at = now_millis();
            history.insert(0, item);
        }
        self.save(HISTORY, &*history)
    }

    pub fn remove_history(&self, id: u64) -> io::Result<()> {
        let mut history = self.history.lock().unwrap();
        history.retain(|h| h.id != id);
        self.save(HISTORY, &*history)
    }

    pub fn clear_history(&self) -> io::Result<()> {
        let mut history = self.history.lock().unwrap();
        history.clear();
        self.save(HISTORY, &*history)
    }

    // Settings ---------------------------------------------------------------

    pub fn settings(&self) -> Settings {
        self.settings.lock().unwrap().clone()
    }

    /// Saves new settings (unknown values fall back to the defaults) and
    /// applies the new history limits right away.
    pub fn set_settings(&self, settings: Settings) -> io::Result<Settings> {
        let settings = settings.sanitized();
        {
            let mut current = self.settings.lock().unwrap();
            *current = settings.clone();
            self.save(SETTINGS, &*current)?;
        }
        let mut history = self.history.lock().unwrap();
        let before = history.len();
        prune(&mut history, &settings, now_millis());
        if history.len() != before {
            self.save(HISTORY, &*history)?;
        }
        Ok(settings)
    }

    fn save<T: Serialize + ?Sized>(&self, name: &str, value: &T) -> io::Result<()> {
        fs::create_dir_all(&self.dir)?;
        let file = self.dir.join(name);
        // Write then rename so a crash never leaves a half-written file.
        let tmp = file.with_extension("json.tmp");
        fs::write(&tmp, serde_json::to_vec_pretty(value)?)?;
        fs::rename(&tmp, &file)
    }
}

const SNIPPETS: &str = "snippets.json";
const HISTORY: &str = "history.json";
const SETTINGS: &str = "settings.json";

fn read<T: DeserializeOwned>(file: &Path) -> Option<T> {
    fs::read(file).ok().and_then(|bytes| serde_json::from_slice(&bytes).ok())
}

/// Drops entries past the count and age limits. `history` is newest first.
fn prune(history: &mut Vec<HistoryItem>, settings: &Settings, now: u64) {
    let oldest = now.saturating_sub(settings.history_days as u64 * DAY_MILLIS);
    history.retain(|h| h.copied_at >= oldest);
    history.truncate(settings.history_limit);
}

fn next_id(ids: impl Iterator<Item = u64>) -> u64 {
    ids.max().map_or(1, |max| max + 1)
}

/// The label as typed, or the first line of the text when it is blank.
fn label_for(label: &str, text: &str) -> String {
    let label = label.trim();
    if !label.is_empty() {
        return label.into();
    }
    let line = text.lines().map(str::trim).find(|l| !l.is_empty()).unwrap_or("");
    let mut made: String = line.chars().take(LABEL_CHARS).collect();
    if line.chars().count() > LABEL_CHARS {
        made.push('…');
    }
    made
}

fn now_millis() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("clip-test-{name}-{}", now_millis()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn texts(store: &Store) -> Vec<String> {
        store.history().into_iter().map(|h| h.text).collect()
    }

    #[test]
    fn records_newest_first_without_duplicates() {
        let dir = temp_dir("record");
        let store = Store::load(dir.clone());
        assert!(store.record("a").unwrap());
        assert!(store.record("b").unwrap());
        let id_a = store.history()[1].id;
        assert!(store.record("a").unwrap());

        assert_eq!(texts(&store), ["a", "b"]);
        // The entry keeps its id, so the list doesn't lose its place.
        assert_eq!(store.history()[0].id, id_a);
        assert_eq!(texts(&Store::load(dir.clone())), ["a", "b"]);
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn skips_blank_and_huge_copies() {
        let dir = temp_dir("skip");
        let store = Store::load(dir.clone());
        assert!(!store.record("  \n\t").unwrap());
        assert!(!store.record(&"x".repeat(MAX_TEXT_BYTES + 1)).unwrap());
        assert!(store.history().is_empty());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn does_not_record_while_turned_off() {
        let dir = temp_dir("off");
        let store = Store::load(dir.clone());
        store.set_settings(Settings { record_history: false, ..Settings::default() }).unwrap();
        assert!(!store.record("secret").unwrap());
        assert!(store.history().is_empty());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn keeps_to_the_count_limit() {
        let dir = temp_dir("limit");
        let store = Store::load(dir.clone());
        for i in 0..60 {
            store.record(&i.to_string()).unwrap();
        }
        assert_eq!(store.history().len(), 60);
        store.set_settings(Settings { history_limit: 50, ..Settings::default() }).unwrap();
        let history = texts(&store);
        assert_eq!(history.len(), 50);
        assert_eq!(history[0], "59");
        assert_eq!(Store::load(dir.clone()).history().len(), 50);
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn drops_entries_older_than_the_age_limit() {
        let dir = temp_dir("age");
        let now = now_millis();
        let old = HistoryItem { id: 1, text: "old".into(), copied_at: now - 8 * DAY_MILLIS };
        let new = HistoryItem { id: 2, text: "new".into(), copied_at: now - DAY_MILLIS };
        fs::write(dir.join(HISTORY), serde_json::to_vec(&[new, old]).unwrap()).unwrap();

        let store = Store::load(dir.clone());
        assert_eq!(texts(&store), ["new", "old"]);
        store.set_settings(Settings { history_days: 7, ..Settings::default() }).unwrap();
        assert_eq!(texts(&store), ["new"]);
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn touch_moves_an_entry_to_the_top() {
        let dir = temp_dir("touch");
        let store = Store::load(dir.clone());
        store.record("a").unwrap();
        store.record("b").unwrap();
        store.touch(store.history()[1].id).unwrap();
        assert_eq!(texts(&store), ["a", "b"]);
        store.remove_history(store.history()[0].id).unwrap();
        assert_eq!(texts(&store), ["b"]);
        store.clear_history().unwrap();
        assert!(Store::load(dir.clone()).history().is_empty());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn edits_and_orders_snippets() {
        let dir = temp_dir("snippets");
        let store = Store::load(dir.clone());
        let mail = store.add_snippet(" メールアドレス ", "taro@example.com").unwrap();
        let tel = store.add_snippet("電話番号", "03-1234-5678").unwrap();
        let sign = store.add_snippet("", "\n  山田 太郎\n営業部").unwrap();
        assert_eq!(mail.label, "メールアドレス");
        assert_eq!(sign.label, "山田 太郎");
        assert_ne!(mail.id, tel.id);

        store.move_snippet(sign.id, -5).unwrap();
        store.update_snippet(tel.id, "電話", "03-0000-0000").unwrap();
        store.delete_snippet(mail.id).unwrap();

        let reloaded = Store::load(dir.clone()).snippets();
        let labels: Vec<_> = reloaded.iter().map(|s| s.label.as_str()).collect();
        assert_eq!(labels, ["山田 太郎", "電話"]);
        assert_eq!(reloaded[1].text, "03-0000-0000");
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn makes_a_snippet_from_history() {
        let dir = temp_dir("pin");
        let store = Store::load(dir.clone());
        store.record(&"長い文章".repeat(20)).unwrap();
        let snippet = store.snippet_from_history(store.history()[0].id).unwrap().unwrap();
        assert_eq!(snippet.label.chars().count(), LABEL_CHARS + 1);
        assert!(snippet.label.ends_with('…'));
        assert_eq!(store.history().len(), 1);
        assert!(store.snippet_from_history(999).unwrap().is_none());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn falls_back_to_defaults_for_unknown_settings() {
        let dir = temp_dir("settings");
        fs::write(dir.join(SETTINGS), r#"{"historyLimit":7,"shortcut":"F13","recordHistory":false}"#).unwrap();
        let settings = Store::load(dir.clone()).settings();
        assert_eq!(settings.history_limit, 200);
        assert_eq!(settings.history_days, 30);
        assert_eq!(settings.shortcut, SHORTCUTS[0]);
        assert!(!settings.record_history);
        fs::remove_dir_all(dir).unwrap();
    }
}

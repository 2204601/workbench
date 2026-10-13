//! What the tray shows and how often it is updated, kept in
//! `app_config_dir()/settings.json` (Architecture §5).

use std::{
    fs, io,
    path::{Path, PathBuf},
    sync::Mutex,
};

use serde::{Deserialize, Serialize};

/// The things Meter measures, in the order they appear in the tray, the
/// menu and the popup.
#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Debug, Hash)]
#[serde(rename_all = "lowercase")]
pub enum Metric {
    Cpu,
    Memory,
    Disk,
    Network,
    /// A name written by a newer version; dropped on load.
    #[serde(other)]
    Unknown,
}

impl Metric {
    pub const ALL: [Metric; 4] = [Metric::Cpu, Metric::Memory, Metric::Disk, Metric::Network];

    pub fn id(self) -> &'static str {
        match self {
            Metric::Cpu => "cpu",
            Metric::Memory => "memory",
            Metric::Disk => "disk",
            Metric::Network => "network",
            Metric::Unknown => "unknown",
        }
    }

    pub fn from_id(id: &str) -> Option<Metric> {
        Metric::ALL.into_iter().find(|m| m.id() == id)
    }

    /// The name in menus.
    pub fn title(self) -> &'static str {
        match self {
            Metric::Cpu => "CPU",
            Metric::Memory => "メモリ",
            Metric::Disk => "ディスク",
            Metric::Network => "ネットワーク",
            Metric::Unknown => "",
        }
    }
}

/// Seconds between readings that can be picked in the menu.
pub const INTERVALS: [u64; 3] = [1, 2, 5];

#[derive(Serialize, Deserialize, Clone, PartialEq, Debug)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    /// Shown in the tray. Never empty: with nothing there, Meter could not
    /// be reached at all.
    pub tray: Vec<Metric>,
    pub interval_secs: u64,
}

impl Default for Settings {
    fn default() -> Self {
        Self { tray: vec![Metric::Cpu, Metric::Memory], interval_secs: 1 }
    }
}

impl Settings {
    /// Fixes up what was read from disk (or edited by hand): the tray in the
    /// usual order without repeats or unknown names, and an interval from the
    /// menu.
    fn normalized(self) -> Self {
        let tray: Vec<Metric> = Metric::ALL.into_iter().filter(|m| self.tray.contains(m)).collect();
        let defaults = Settings::default();
        Self {
            tray: if tray.is_empty() { defaults.tray } else { tray },
            interval_secs: if INTERVALS.contains(&self.interval_secs) {
                self.interval_secs
            } else {
                defaults.interval_secs
            },
        }
    }

    pub fn shows(&self, metric: Metric) -> bool {
        self.tray.contains(&metric)
    }

    /// Adds `metric` to the tray or takes it off. The last one stays.
    pub fn toggled(&self, metric: Metric) -> Self {
        let mut tray = self.tray.clone();
        if tray.contains(&metric) {
            if tray.len() > 1 {
                tray.retain(|m| *m != metric);
            }
        } else {
            tray.push(metric);
        }
        Self { tray, ..self.clone() }.normalized()
    }

    pub fn with_interval(&self, secs: u64) -> Self {
        Self { interval_secs: secs, ..self.clone() }.normalized()
    }
}

pub struct Store {
    path: PathBuf,
    current: Mutex<Settings>,
}

impl Store {
    /// Reads `settings.json` in `dir`. A missing or unreadable file gives
    /// the defaults.
    pub fn load(dir: &Path) -> Self {
        let path = dir.join("settings.json");
        let current = match fs::read(&path) {
            Ok(bytes) => serde_json::from_slice::<Settings>(&bytes).unwrap_or_else(|e| {
                log::warn!("settings.json could not be read, using the defaults: {e}");
                Settings::default()
            }),
            Err(_) => Settings::default(),
        };
        Self { path, current: Mutex::new(current.normalized()) }
    }

    pub fn get(&self) -> Settings {
        self.current.lock().unwrap().clone()
    }

    /// Saves `settings` (written to a temporary file first, so a crash never
    /// leaves half a file) and returns them as saved.
    pub fn set(&self, settings: Settings) -> io::Result<Settings> {
        let settings = settings.normalized();
        if let Some(dir) = self.path.parent() {
            fs::create_dir_all(dir)?;
        }
        let tmp = self.path.with_extension("json.tmp");
        fs::write(&tmp, serde_json::to_vec_pretty(&settings)?)?;
        fs::rename(&tmp, &self.path)?;
        *self.current.lock().unwrap() = settings.clone();
        Ok(settings)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("meter-settings-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn defaults_show_cpu_and_memory_every_second() {
        let dir = temp_dir("defaults");
        let store = Store::load(&dir);
        assert_eq!(store.get(), Settings { tray: vec![Metric::Cpu, Metric::Memory], interval_secs: 1 });
    }

    #[test]
    fn saved_settings_come_back() {
        let dir = temp_dir("roundtrip");
        let store = Store::load(&dir);
        let saved = store.set(Settings { tray: vec![Metric::Network, Metric::Cpu], interval_secs: 5 }).unwrap();
        assert_eq!(saved.tray, [Metric::Cpu, Metric::Network], "kept in the usual order");
        assert_eq!(Store::load(&dir).get(), saved);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_broken_file_gives_the_defaults() {
        let dir = temp_dir("broken");
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("settings.json"), "{ not json").unwrap();
        assert_eq!(Store::load(&dir).get(), Settings::default());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn unknown_and_odd_values_are_fixed_up() {
        let dir = temp_dir("odd");
        fs::create_dir_all(&dir).unwrap();
        let json = r#"{ "tray": ["gpu", "disk", "disk"], "intervalSecs": 7, "later": true }"#;
        fs::write(dir.join("settings.json"), json).unwrap();
        assert_eq!(Store::load(&dir).get(), Settings { tray: vec![Metric::Disk], interval_secs: 1 });

        fs::write(dir.join("settings.json"), r#"{ "tray": [] }"#).unwrap();
        assert_eq!(Store::load(&dir).get().tray, Settings::default().tray);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_last_tray_item_stays() {
        let one = Settings { tray: vec![Metric::Disk], interval_secs: 1 };
        assert_eq!(one.toggled(Metric::Disk).tray, [Metric::Disk]);
        assert_eq!(one.toggled(Metric::Cpu).tray, [Metric::Cpu, Metric::Disk]);
        assert_eq!(one.toggled(Metric::Cpu).toggled(Metric::Disk).tray, [Metric::Cpu]);
    }

    #[test]
    fn only_listed_intervals() {
        let s = Settings::default();
        assert_eq!(s.with_interval(2).interval_secs, 2);
        assert_eq!(s.with_interval(0).interval_secs, 1);
    }

    #[test]
    fn metric_ids_round_trip() {
        for m in Metric::ALL {
            assert_eq!(Metric::from_id(m.id()), Some(m));
        }
        assert_eq!(Metric::from_id("unknown"), None);
    }
}

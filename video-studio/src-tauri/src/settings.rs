//! The app's settings: `settings.json` in the app config folder (Platform
//! Architecture §5). Small, so read and written whole.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AppSettings {
    /// Look for a new version a few seconds after launch.
    pub auto_update: bool,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self { auto_update: true }
    }
}

pub fn path(config_dir: &Path) -> PathBuf {
    config_dir.join("settings.json")
}

pub fn load(path: &Path) -> AppSettings {
    let Ok(bytes) = fs::read(path) else {
        return AppSettings::default();
    };
    serde_json::from_slice(&bytes).unwrap_or_else(|e| {
        // Unreadable (edited by hand, cut short): kept aside rather than
        // overwritten by the next save.
        log::warn!("{}: 読み込めないため退避します: {e}", path.display());
        let _ = fs::rename(path, path.with_extension("json.bad"));
        AppSettings::default()
    })
}

/// Written to a temporary file and renamed over the old one, so a crash
/// mid-write never leaves half a file.
pub fn save(path: &Path, s: &AppSettings) -> std::io::Result<()> {
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir)?;
    }
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, serde_json::to_vec_pretty(s)?)?;
    fs::rename(&tmp, path)
}

/// Commands run on several threads; one read-change-write at a time.
pub static LOCK: Mutex<()> = Mutex::new(());

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip_and_defaults() {
        let dir =
            std::env::temp_dir().join(format!("video-studio-settings-{}", std::process::id()));
        let p = path(&dir);
        assert_eq!(load(&p), AppSettings::default());
        save(&p, &AppSettings { auto_update: false }).unwrap();
        assert!(!load(&p).auto_update);
        // Keys added later fall back to their defaults.
        fs::write(&p, "{}").unwrap();
        assert!(load(&p).auto_update);
        // Broken files are kept aside.
        fs::write(&p, "{").unwrap();
        assert_eq!(load(&p), AppSettings::default());
        assert!(p.with_extension("json.bad").exists());
        fs::remove_dir_all(&dir).unwrap();
    }
}

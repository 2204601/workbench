//! Whether a new name may be used (docs/SPEC.md §6): Windows' rules wherever
//! the app runs, since the shares are used from Windows (docs/SAFETY.md §5),
//! and no two files ending up with one name (§1, §4).

use crate::rules::normalize::FORBIDDEN;
use unicode_normalization::UnicodeNormalization;

/// Names compare the way Windows and macOS do by default: case-insensitive,
/// and "ガ" the same however it is stored.
pub fn key(name: &str) -> String {
    name.nfc().collect::<String>().to_lowercase()
}

/// Windows' reserved device names, with or without an extension.
fn reserved(name: &str) -> bool {
    let base = name.split('.').next().unwrap_or("").trim_end().to_uppercase();
    matches!(base.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || ["COM", "LPT"].iter().any(|p| {
            base.strip_prefix(p)
                .is_some_and(|d| matches!(d, "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "¹" | "²" | "³"))
        })
}

/// Why `name` can't be a file name, or None.
pub fn problem(name: &str, stem_empty: bool) -> Option<String> {
    if name.is_empty() || stem_empty {
        return Some("名前が空になります".into());
    }
    if let Some((c, _)) = FORBIDDEN.iter().find(|(c, _)| name.contains(*c)) {
        return Some(format!("Windows で使えない文字「{c}」があります"));
    }
    if name.chars().any(char::is_control) {
        return Some("制御文字が入っています".into());
    }
    if name.ends_with('.') || name.ends_with(' ') {
        return Some("末尾がピリオドか空白です（Windows では使えません）".into());
    }
    if reserved(name) {
        return Some("Windows の予約名です（CON、NUL、COM1 など）".into());
    }
    if name.encode_utf16().count() > 255 {
        return Some("名前が長すぎます（255 文字まで）".into());
    }
    None
}

/// Paths past this many UTF-16 units open poorly in Explorer and Office.
pub const LONG_PATH: usize = 259;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn windows_rules() {
        assert!(problem("ok.txt", false).is_none());
        assert!(problem("日本語の名前.pdf", false).is_none());
        assert!(problem("a:b.txt", false).unwrap().contains("「:」"));
        assert!(problem("a|b", false).is_some());
        assert!(problem("tab\there", false).is_some());
        assert!(problem("末尾.", false).is_some());
        assert!(problem("末尾 ", false).is_some());
        assert!(problem("", false).is_some());
        assert!(problem(".pdf", true).is_some());
        assert!(problem(&"あ".repeat(256), false).is_some());
        assert!(problem(&"あ".repeat(255), false).is_none());
    }

    #[test]
    fn reserved_names() {
        for r in ["CON", "con.txt", "Nul.tar.gz", "COM1", "lpt9.log", "COM¹", "AUX .txt"] {
            assert!(reserved(r), "{r}");
        }
        for ok in ["CONSOLE", "COM10", "com", "LPT0", "nul_", "コン"] {
            assert!(!reserved(ok), "{ok}");
        }
    }

    #[test]
    fn keys() {
        assert_eq!(key("Report.PDF"), key("report.pdf"));
        assert_eq!(key("\u{30AB}\u{3099}"), key("ガ"));
        assert_ne!(key("ガ"), key("カ"));
    }
}

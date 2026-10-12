//! 置換 (docs/SPEC.md §5.2): plain text or a regular expression.

use regex::{Regex, RegexBuilder};

#[derive(Debug)]
pub struct Replace {
    re: Regex,
    with: String,
    first_only: bool,
}

impl Replace {
    pub fn new(find: &str, with: &str, regex: bool, case_sensitive: bool, first_only: bool) -> Result<Self, String> {
        if find.is_empty() {
            return Err("検索する文字を入れてください".into());
        }
        let pattern = if regex { find.to_string() } else { regex::escape(find) };
        let re = RegexBuilder::new(&pattern)
            .case_insensitive(!case_sensitive)
            // A user's pattern on 1 万 names: keep a runaway one bounded.
            .size_limit(1 << 20)
            .build()
            .map_err(|e| match e {
                regex::Error::Syntax(s) => {
                    format!("正規表現の書き方が正しくありません: {}", s.lines().last().unwrap_or(&s))
                }
                regex::Error::CompiledTooBig(_) => "正規表現が大きすぎます".into(),
                _ => format!("正規表現を使えません: {e}"),
            })?;
        // Plain text: "$" in the replacement is just a dollar sign.
        let with = if regex { with.to_string() } else { with.replace('$', "$$") };
        Ok(Self { re, with, first_only })
    }

    pub fn apply(&self, s: &str) -> String {
        if self.first_only {
            self.re.replace(s, self.with.as_str()).into_owned()
        } else {
            self.re.replace_all(s, self.with.as_str()).into_owned()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn r(find: &str, with: &str, regex: bool, case: bool, first: bool, s: &str) -> String {
        Replace::new(find, with, regex, case, first).unwrap().apply(s)
    }

    #[test]
    fn plain_text() {
        assert_eq!(r("IMG", "写真", false, false, false, "img_IMG_1"), "写真_写真_1");
        assert_eq!(r("IMG", "写真", false, true, false, "img_IMG_1"), "img_写真_1");
        assert_eq!(r("_", "-", false, false, true, "a_b_c"), "a-b_c");
        // Special characters are literal, both ways.
        assert_eq!(r("(1)", "$1", false, false, false, "見積(1)"), "見積$1");
        assert_eq!(r(".", "", false, false, false, "a.b.c"), "abc");
    }

    #[test]
    fn regex_groups() {
        assert_eq!(r(r"(\d{4})(\d{2})(\d{2})", "$1-$2-$3", true, false, false, "報告20261011"), "報告2026-10-11");
        assert_eq!(r(r"^(?P<a>\w+)_(?P<b>\w+)$", "${b}_${a}", true, false, false, "前_後"), "後_前");
    }

    #[test]
    fn bad_patterns() {
        assert!(Replace::new("(", "", true, false, false).unwrap_err().contains("正規表現"));
        assert!(Replace::new("", "x", false, false, false).is_err());
        // Look-around isn't supported by the regex crate (§5.2 says so).
        assert!(Replace::new("(?=a)", "", true, false, false).is_err());
    }
}

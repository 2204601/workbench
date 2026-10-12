//! The rules that make new names (docs/SPEC.md §5). One rule per run.
//!
//! A rule applies to the part of the name before the extension, unless the
//! user includes the extension (§5.1). Everything here is pure: a name in, a
//! name out, so it is tested without files.

pub mod normalize;
pub mod replace;
pub mod template;

use serde::Deserialize;

/// The rule as the frontend sends it: `{ "kind": "replace", ... }`.
#[derive(Clone, Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum Rule {
    /// 置換: text or a regular expression.
    Replace { find: String, with: String, regex: bool, case_sensitive: bool, first_only: bool },
    /// 先頭に追加 / 末尾に追加.
    Insert { text: String, at_end: bool },
    /// 先頭から N 文字 / 末尾から N 文字を削除.
    Trim { start: usize, end: usize },
    /// 連番・日付: a template like "現場A_{mdate:yyyyMMdd}_{n:3}".
    Template { template: String, start: i64, step: i64 },
    /// 文字種の整形.
    Normalize(normalize::Options),
}

/// What a rule may use besides the name.
pub struct Context<'a> {
    /// The row's number, counted over the rows being renamed in list order.
    pub index: usize,
    pub parent: &'a str,
    pub modified: i64,
    pub created: Option<i64>,
}

/// A rule ready to run: its regular expression or template parsed once.
pub enum Compiled {
    Replace(replace::Replace),
    Insert { text: String, at_end: bool },
    Trim { start: usize, end: usize },
    Template(template::Template),
    Normalize(normalize::Options),
}

/// Parses the rule; the error is shown under its field (§5.2).
pub fn compile(rule: &Rule) -> Result<Compiled, String> {
    Ok(match rule {
        Rule::Replace { find, with, regex, case_sensitive, first_only } => {
            Compiled::Replace(replace::Replace::new(find, with, *regex, *case_sensitive, *first_only)?)
        }
        Rule::Insert { text, at_end } => Compiled::Insert { text: text.clone(), at_end: *at_end },
        Rule::Trim { start, end } => Compiled::Trim { start: *start, end: *end },
        Rule::Template { template, start, step } => {
            Compiled::Template(template::Template::parse(template, *start, *step)?)
        }
        Rule::Normalize(o) => Compiled::Normalize(o.clone()),
    })
}

impl Compiled {
    /// The new text for `part` (the name without its extension, or all of it).
    pub fn apply(&self, part: &str, cx: &Context) -> String {
        match self {
            Compiled::Replace(r) => r.apply(part),
            Compiled::Insert { text, at_end: false } => format!("{text}{part}"),
            Compiled::Insert { text, at_end: true } => format!("{part}{text}"),
            Compiled::Trim { start, end } => {
                let chars: Vec<char> = part.chars().collect();
                let from = (*start).min(chars.len());
                let to = chars.len().saturating_sub(*end).max(from);
                chars[from..to].iter().collect()
            }
            Compiled::Template(t) => t.render(part, cx),
            Compiled::Normalize(o) => normalize::apply(part, o),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cx() -> Context<'static> {
        Context { index: 0, parent: "", modified: 0, created: None }
    }

    #[test]
    fn insert_and_trim() {
        let insert = compile(&Rule::Insert { text: "済_".into(), at_end: false }).unwrap();
        assert_eq!(insert.apply("見積書", &cx()), "済_見積書");
        let trim = compile(&Rule::Trim { start: 4, end: 1 }).unwrap();
        assert_eq!(trim.apply("IMG_0001x", &cx()), "0001");
        // More than the name has: empty, not a panic.
        let all = compile(&Rule::Trim { start: 5, end: 9 }).unwrap();
        assert_eq!(all.apply("abc", &cx()), "");
    }

    #[test]
    fn rules_from_json() {
        let r: Rule = serde_json::from_str(r#"{"kind":"insert","text":"x","atEnd":true}"#).unwrap();
        assert!(matches!(r, Rule::Insert { at_end: true, .. }));
        let r: Rule = serde_json::from_str(
            r#"{"kind":"normalize","width":true,"kana":false,"case":"lower","spaces":true,"spaceTo":"_","forbidden":"fullwidth","nfc":true}"#,
        )
        .unwrap();
        assert!(matches!(r, Rule::Normalize(_)));
    }
}

//! 連番・日付 (docs/SPEC.md §5.3, §5.4): a template with tokens.
//!
//! | token | |
//! |---|---|
//! | `{name}` | the old name (without the extension unless it is included) |
//! | `{n}` / `{n:3}` | the number / zero-padded to 3 digits |
//! | `{parent}` | the folder's name |
//! | `{mdate:yyyyMMdd}` / `{cdate:...}` | modified / created, in local time |
//!
//! `{{` and `}}` are literal braces. Date formats: yyyy yy MM dd HH mm ss;
//! anything else is copied as it is.

use super::Context;
use chrono::{Local, TimeZone};

#[derive(Debug, PartialEq)]
enum Part {
    Text(String),
    Name,
    Number { digits: usize },
    Parent,
    Date { created: bool, format: Vec<DatePart> },
}

#[derive(Clone, Debug, PartialEq)]
enum DatePart {
    Text(String),
    Year4,
    Year2,
    Month,
    Day,
    Hour,
    Minute,
    Second,
}

pub struct Template {
    parts: Vec<Part>,
    start: i64,
    step: i64,
}

fn parse_date(format: &str) -> Result<Vec<DatePart>, String> {
    if format.is_empty() {
        return Err("日付の書式を書いてください（例：{mdate:yyyyMMdd}）".into());
    }
    let mut out = Vec::new();
    let mut rest = format;
    // Longest first: "yyyy" before "yy".
    const FIELDS: [(&str, DatePart); 7] = [
        ("yyyy", DatePart::Year4),
        ("yy", DatePart::Year2),
        ("MM", DatePart::Month),
        ("dd", DatePart::Day),
        ("HH", DatePart::Hour),
        ("mm", DatePart::Minute),
        ("ss", DatePart::Second),
    ];
    'outer: while !rest.is_empty() {
        for (token, part) in &FIELDS {
            if let Some(r) = rest.strip_prefix(token) {
                out.push(part.clone());
                rest = r;
                continue 'outer;
            }
        }
        let c = rest.chars().next().unwrap();
        match out.last_mut() {
            Some(DatePart::Text(t)) => t.push(c),
            _ => out.push(DatePart::Text(c.to_string())),
        }
        rest = &rest[c.len_utf8()..];
    }
    Ok(out)
}

fn token(t: &str) -> Result<Part, String> {
    let (head, arg) = match t.split_once(':') {
        Some((h, a)) => (h, Some(a)),
        None => (t, None),
    };
    Ok(match (head, arg) {
        ("name", None) => Part::Name,
        ("parent", None) => Part::Parent,
        ("n", None) => Part::Number { digits: 0 },
        ("n", Some(d)) => {
            let digits = d.parse::<usize>().ok().filter(|d| (1..=10).contains(d));
            Part::Number { digits: digits.ok_or(format!("{{n:{d}}} の桁数は 1〜10 で書いてください"))? }
        }
        ("mdate", Some(f)) => Part::Date { created: false, format: parse_date(f)? },
        ("cdate", Some(f)) => Part::Date { created: true, format: parse_date(f)? },
        ("mdate" | "cdate", None) => return Err(format!("{{{head}}} には書式が要ります（例：{{{head}:yyyyMMdd}}）")),
        _ => {
            return Err(format!(
                "{{{t}}} は使えません。使えるのは {{name}} {{n}} {{n:3}} {{parent}} {{mdate:…}} {{cdate:…}} です"
            ))
        }
    })
}

impl Template {
    pub fn parse(src: &str, start: i64, step: i64) -> Result<Self, String> {
        if src.is_empty() {
            return Err("テンプレートを書いてください".into());
        }
        let mut parts = Vec::new();
        let mut text = String::new();
        let mut chars = src.chars().peekable();
        while let Some(c) = chars.next() {
            match c {
                '{' if chars.peek() == Some(&'{') => {
                    chars.next();
                    text.push('{');
                }
                '}' if chars.peek() == Some(&'}') => {
                    chars.next();
                    text.push('}');
                }
                '{' => {
                    let mut t = String::new();
                    loop {
                        match chars.next() {
                            Some('}') => break,
                            Some(c) => t.push(c),
                            None => return Err("「{」が閉じていません".into()),
                        }
                    }
                    if !text.is_empty() {
                        parts.push(Part::Text(std::mem::take(&mut text)));
                    }
                    parts.push(token(t.trim())?);
                }
                '}' => return Err("「}」に対応する「{」がありません（文字としての } は }} と書きます）".into()),
                c => text.push(c),
            }
        }
        if !text.is_empty() {
            parts.push(Part::Text(text));
        }
        Ok(Self { parts, start, step })
    }

    pub fn render(&self, name: &str, cx: &Context) -> String {
        let mut out = String::new();
        for p in &self.parts {
            match p {
                Part::Text(t) => out.push_str(t),
                Part::Name => out.push_str(name),
                Part::Parent => out.push_str(cx.parent),
                Part::Number { digits } => {
                    let n = self.start.saturating_add(self.step.saturating_mul(cx.index as i64));
                    let sign = if n < 0 { "-" } else { "" };
                    out.push_str(&format!("{sign}{:0width$}", n.unsigned_abs(), width = *digits));
                }
                Part::Date { created, format } => {
                    let ms = if *created { cx.created } else { Some(cx.modified) };
                    match ms.and_then(|ms| Local.timestamp_millis_opt(ms).single()) {
                        Some(t) => out.push_str(&format_date(&t, format)),
                        // No creation date kept on this file system.
                        None => out.push_str("日付なし"),
                    }
                }
            }
        }
        out
    }
}

fn format_date<T: chrono::Datelike + chrono::Timelike>(t: &T, format: &[DatePart]) -> String {
    let mut s = String::new();
    for p in format {
        match p {
            DatePart::Text(x) => s.push_str(x),
            DatePart::Year4 => s.push_str(&format!("{:04}", t.year())),
            DatePart::Year2 => s.push_str(&format!("{:02}", t.year().rem_euclid(100))),
            DatePart::Month => s.push_str(&format!("{:02}", t.month())),
            DatePart::Day => s.push_str(&format!("{:02}", t.day())),
            DatePart::Hour => s.push_str(&format!("{:02}", t.hour())),
            DatePart::Minute => s.push_str(&format!("{:02}", t.minute())),
            DatePart::Second => s.push_str(&format!("{:02}", t.second())),
        }
    }
    s
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::NaiveDate;

    fn render(t: &str, name: &str, index: usize) -> String {
        let cx = Context { index, parent: "現場A", modified: 0, created: None };
        Template::parse(t, 1, 1).unwrap().render(name, &cx)
    }

    #[test]
    fn numbers_and_names() {
        assert_eq!(render("{n:3}_{name}", "写真", 0), "001_写真");
        assert_eq!(render("{name}-{n}", "写真", 11), "写真-12");
        assert_eq!(render("{parent}_{n:2}", "x", 4), "現場A_05");
        assert_eq!(render("{{固定}}_{n}", "x", 0), "{固定}_1");
        let by_ten = Template::parse("{n:4}", 100, 10).unwrap();
        let cx = Context { index: 3, parent: "", modified: 0, created: None };
        assert_eq!(by_ten.render("", &cx), "0130");
        let down = Template::parse("{n}", 1, -1).unwrap();
        let cx = Context { index: 3, parent: "", modified: 0, created: None };
        assert_eq!(down.render("", &cx), "-2");
    }

    #[test]
    fn dates() {
        let t = NaiveDate::from_ymd_opt(2026, 1, 9).unwrap().and_hms_opt(7, 5, 3).unwrap();
        let f = parse_date("yyyy-MM-dd_HHmmss").unwrap();
        assert_eq!(format_date(&t, &f), "2026-01-09_070503");
        assert_eq!(format_date(&t, &parse_date("yyMMdd").unwrap()), "260109");
        assert_eq!(format_date(&t, &parse_date("yyyy年M月").unwrap()), "2026年M月");
        // Modified dates go through the local time zone; a file without a
        // creation date says so instead of a wrong date.
        let cx = Context { index: 0, parent: "", modified: 0, created: None };
        assert_eq!(Template::parse("{cdate:yyyy}", 1, 1).unwrap().render("", &cx), "日付なし");
        assert_eq!(Template::parse("{mdate:yyyy}", 1, 1).unwrap().render("", &cx).len(), 4);
    }

    #[test]
    fn errors() {
        for bad in ["", "{name", "name}", "{nam}", "{n:0}", "{n:x}", "{mdate}", "{mdate:}"] {
            assert!(Template::parse(bad, 1, 1).is_err(), "{bad}");
        }
    }
}

//! 文字種の整形 (docs/SPEC.md §5.5). The options are applied in a fixed
//! order, so a later one can tidy what an earlier one made: full-width "／"
//! made half-width is a "/", which "使えない文字を置き換える" then replaces.

use serde::Deserialize;
use unicode_normalization::UnicodeNormalization;

#[derive(Clone, Copy, Debug, Default, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Case {
    #[default]
    Keep,
    Upper,
    Lower,
    /// 先頭だけ大文字: the first letter upper case, the rest lower.
    Capitalize,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Forbidden {
    #[default]
    Keep,
    /// `:` → `：`: the name still reads the same.
    Fullwidth,
    Underscore,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Options {
    /// 全角英数字・記号 → 半角.
    pub width: bool,
    /// 半角カナ → 全角.
    pub kana: bool,
    pub case: Case,
    /// Full-width spaces to half-width, runs to one, none at the ends.
    pub spaces: bool,
    /// Spaces replaced by this ("_", "-"); empty keeps them.
    pub space_to: String,
    pub forbidden: Forbidden,
    /// 日本語の表記をそろえる (NFC), docs/SAFETY.md §4.
    pub nfc: bool,
}

pub fn apply(s: &str, o: &Options) -> String {
    let mut s = s.to_string();
    if o.width {
        s = to_halfwidth(&s);
    }
    if o.kana {
        s = kana_to_fullwidth(&s);
    }
    s = match o.case {
        Case::Keep => s,
        Case::Upper => s.to_uppercase(),
        Case::Lower => s.to_lowercase(),
        Case::Capitalize => capitalize(&s),
    };
    if o.spaces {
        s = s.replace('\u{3000}', " ").split_whitespace().collect::<Vec<_>>().join(" ");
    }
    if !o.space_to.is_empty() {
        s = s.replace([' ', '\u{3000}'], &o.space_to);
    }
    if o.forbidden != Forbidden::Keep {
        s = replace_forbidden(&s, o.forbidden);
    }
    if o.nfc {
        s = s.nfc().collect();
    }
    s
}

/// U+FF01..FF5E are ASCII 0x21..0x7E shifted; the ideographic space is left
/// to the space options.
fn to_halfwidth(s: &str) -> String {
    s.chars()
        .map(|c| match c {
            '\u{FF01}'..='\u{FF5E}' => char::from_u32(c as u32 - 0xFEE0).unwrap_or(c),
            c => c,
        })
        .collect()
}

/// Half-width katakana U+FF61..FF9F in order, as full-width.
const KANA: [char; 63] = [
    '。', '「', '」', '、', '・', 'ヲ', 'ァ', 'ィ', 'ゥ', 'ェ', 'ォ', 'ャ', 'ュ', 'ョ', 'ッ', 'ー', 'ア', 'イ', 'ウ',
    'エ', 'オ', 'カ', 'キ', 'ク', 'ケ', 'コ', 'サ', 'シ', 'ス', 'セ', 'ソ', 'タ', 'チ', 'ツ', 'テ', 'ト', 'ナ', 'ニ',
    'ヌ', 'ネ', 'ノ', 'ハ', 'ヒ', 'フ', 'ヘ', 'ホ', 'マ', 'ミ', 'ム', 'メ', 'モ', 'ヤ', 'ユ', 'ヨ', 'ラ', 'リ', 'ル',
    'レ', 'ロ', 'ワ', 'ン', '゛', '゜',
];

/// ｶﾞ → ガ, ﾊﾟ → パ: the sound marks join the kana before them where a
/// joined letter exists; otherwise they stay as marks.
fn kana_to_fullwidth(s: &str) -> String {
    let mut out: Vec<char> = Vec::with_capacity(s.len());
    for c in s.chars() {
        let Some(full) = (c as u32).checked_sub(0xFF61).and_then(|i| KANA.get(i as usize)).copied() else {
            out.push(c);
            continue;
        };
        let joined = match (out.last().copied(), c) {
            (Some(prev), '\u{FF9E}') => voiced(prev),
            (Some(prev), '\u{FF9F}') => semi_voiced(prev),
            _ => None,
        };
        match joined {
            Some(j) => *out.last_mut().unwrap() = j,
            None => out.push(full),
        }
    }
    out.into_iter().collect()
}

fn voiced(c: char) -> Option<char> {
    match c {
        'ウ' => Some('ヴ'),
        // Each of these has its voiced form right after it (カ ガ, ツ ヅ, ハ バ パ).
        'カ' | 'キ' | 'ク' | 'ケ' | 'コ' | 'サ' | 'シ' | 'ス' | 'セ' | 'ソ' | 'タ' | 'チ' | 'ツ' | 'テ' | 'ト' => {
            char::from_u32(c as u32 + 1)
        }
        'ハ' | 'ヒ' | 'フ' | 'ヘ' | 'ホ' => char::from_u32(c as u32 + 1),
        'ワ' => Some('ヷ'),
        'ヲ' => Some('ヺ'),
        _ => None,
    }
}

fn semi_voiced(c: char) -> Option<char> {
    match c {
        'ハ' | 'ヒ' | 'フ' | 'ヘ' | 'ホ' => char::from_u32(c as u32 + 2),
        _ => None,
    }
}

fn capitalize(s: &str) -> String {
    let lower = s.to_lowercase();
    let mut done = false;
    lower
        .chars()
        .flat_map(|c| {
            if !done && c.is_alphabetic() && c.is_ascii() {
                done = true;
                c.to_uppercase().collect::<Vec<_>>()
            } else {
                vec![c]
            }
        })
        .collect()
}

/// Characters Windows refuses in names (docs/SAFETY.md §5), and their
/// full-width look-alikes.
pub const FORBIDDEN: [(char, char); 9] = [
    ('\\', '＼'),
    ('/', '／'),
    (':', '：'),
    ('*', '＊'),
    ('?', '？'),
    ('"', '＂'),
    ('<', '＜'),
    ('>', '＞'),
    ('|', '｜'),
];

fn replace_forbidden(s: &str, how: Forbidden) -> String {
    s.chars()
        .filter(|c| !c.is_control())
        .map(|c| match FORBIDDEN.iter().find(|(f, _)| *f == c) {
            Some((_, wide)) if how == Forbidden::Fullwidth => *wide,
            Some(_) => '_',
            None => c,
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn with(f: impl FnOnce(&mut Options)) -> Options {
        let mut o = Options::default();
        f(&mut o);
        o
    }

    #[test]
    fn widths() {
        let o = with(|o| o.width = true);
        assert_eq!(apply("ＡＢＣ商事＿１２３（案）", &o), "ABC商事_123(案)");
        let o = with(|o| o.kana = true);
        assert_eq!(apply("ｶﾞｲﾄﾞﾌﾞｯｸ", &o), "ガイドブック");
        assert_eq!(apply("ﾊﾟﾝﾌﾚｯﾄ･ｳﾞｪﾙﾃﾞｨ", &o), "パンフレット・ヴェルディ");
        // A mark with nothing to join stays a mark.
        assert_eq!(apply("ｱﾞ", &o), "ア゛");
        assert_eq!(apply("ﾞ", &o), "゛");
    }

    #[test]
    fn every_voiced_kana() {
        let o = with(|o| o.kana = true);
        assert_eq!(apply("ｶﾞｷﾞｸﾞｹﾞｺﾞｻﾞｼﾞｽﾞｾﾞｿﾞﾀﾞﾁﾞﾂﾞﾃﾞﾄﾞ", &o), "ガギグゲゴザジズゼゾダヂヅデド");
        assert_eq!(apply("ﾊﾞﾋﾞﾌﾞﾍﾞﾎﾞﾊﾟﾋﾟﾌﾟﾍﾟﾎﾟ", &o), "バビブベボパピプペポ");
    }

    #[test]
    fn case_and_spaces() {
        assert_eq!(apply("Report FINAL", &with(|o| o.case = Case::Lower)), "report final");
        assert_eq!(apply("report final", &with(|o| o.case = Case::Upper)), "REPORT FINAL");
        assert_eq!(apply("報告 REPORT", &with(|o| o.case = Case::Capitalize)), "報告 Report");
        assert_eq!(apply("　議事録　 第1回  ", &with(|o| o.spaces = true)), "議事録 第1回");
        let o = with(|o| {
            o.spaces = true;
            o.space_to = "_".into();
        });
        assert_eq!(apply(" a  b　c ", &o), "a_b_c");
    }

    #[test]
    fn forbidden_after_width() {
        let o = with(|o| {
            o.width = true;
            o.forbidden = Forbidden::Underscore;
        });
        assert_eq!(apply("売上／2026：速報", &o), "売上_2026_速報");
        let o = with(|o| o.forbidden = Forbidden::Fullwidth);
        assert_eq!(apply("a:b?c\u{7}", &o), "a：b？c");
    }

    #[test]
    fn nfc_joins_split_kana() {
        // "ガ" as macOS may store it: カ + combining mark.
        let nfd = "\u{30AB}\u{3099}イド";
        assert_eq!(apply(nfd, &with(|o| o.nfc = true)), "ガイド");
        assert_ne!(apply(nfd, &Options::default()), "ガイド");
    }
}

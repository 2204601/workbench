//! Fixing the text that is already on a page (docs/ROADMAP.md 0.3).
//!
//! Two halves:
//!
//! - `runs` reads a page's content stream the way a viewer would, follows
//!   the text state (matrices, font, size, spacing), and lists the lines of
//!   text that can be fixed: what they say, where they are, and which
//!   operators (`Tj`, `TJ`, `'`, `"`) draw them.
//! - `apply` takes the lines the user changed. The operators that drew the
//!   old line stay in the stream but show nothing, and still move the text
//!   position by the same distance, so everything after them stays where it
//!   was. The new text is drawn on top of the page in the app's embedded
//!   font, at the old line's position, size and colour.
//!
//! Only what can be done safely is offered: fonts whose codes can be read
//! back as text and whose widths are known (Identity-H CID fonts and simple
//! fonts), horizontal upright lines, pages without inline images. The rest
//! is reported as "can't be fixed here" with the reason, so the screen can
//! say so and offer writing over it instead.

use super::font::Embedder;
use super::{color_hex, get_dict, get_name, get_resolved, number, resolve};
use lopdf::content::{Content, Operation};
use lopdf::{dictionary, Dictionary, Document, Object, ObjectId, Stream};
use serde::Serialize;
use std::collections::HashMap;
use std::rc::Rc;

/// Ascent and descent of a line's box per point of size, as the screen
/// draws it (`TEXT_DESCENT` in src/lib/textedit.ts is the same number).
pub const BOX_ASCENT: f64 = 0.88;
pub const BOX_DESCENT: f64 = 0.22;

/// The resource name the new text's font gets on the page.
const NEW_FONT: &str = "PDFEdit";

/// One line of text that can (or cannot) be fixed.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Line {
    /// The content-stream operators that draw it, by position in the page's
    /// content (what `apply` is given back).
    pub ops: Vec<u32>,
    pub text: String,
    /// [x1, y1, x2, y2] around the line, in the page's own space.
    pub rect: [f64; 4],
    /// Font size in points as it appears on the page.
    pub size: f64,
    /// "#rrggbb".
    pub color: String,
    pub font: String,
    /// The characters the line's own font can write (new text in them keeps
    /// the font; the others are written in the app's font). None: too many to list.
    pub chars: Option<String>,
    pub editable: bool,
    /// Why it can't be fixed (shown to the user, in Japanese).
    pub why: String,
}

/// A line the user changed: the operators that drew it, and what it says now.
#[derive(Debug, Clone)]
pub struct Change {
    pub ops: Vec<u32>,
    pub text: String,
    pub size: f64,
    pub color: [f64; 3],
}

// ---------------------------------------------------------------- matrices

type M = [f64; 6];
const IDENTITY: M = [1.0, 0.0, 0.0, 1.0, 0.0, 0.0];

/// `a` then `b` (row vectors, as PDF writes them).
fn mul(a: M, b: M) -> M {
    [
        a[0] * b[0] + a[1] * b[2],
        a[0] * b[1] + a[1] * b[3],
        a[2] * b[0] + a[3] * b[2],
        a[2] * b[1] + a[3] * b[3],
        a[4] * b[0] + a[5] * b[2] + b[4],
        a[4] * b[1] + a[5] * b[3] + b[5],
    ]
}

fn translate(tx: f64, ty: f64) -> M {
    [1.0, 0.0, 0.0, 1.0, tx, ty]
}

fn apply_pt(m: M, x: f64, y: f64) -> (f64, f64) {
    (x * m[0] + y * m[2] + m[4], x * m[1] + y * m[3] + m[5])
}

// ------------------------------------------------------------------- fonts

/// What it takes to read a string of a font as text and measure it.
#[derive(Debug)]
struct FontInfo {
    name: String,
    /// Two-byte codes (an Identity-H CID font) rather than one.
    wide: bool,
    /// Why this font can't be used; None: it can.
    why: Option<String>,
    /// code → text
    unicode: HashMap<u32, String>,
    /// code → advance in 1/1000 em
    widths: HashMap<u32, f64>,
    default_width: f64,
    /// Widths of fonts with none given (the standard 14): estimated from
    /// the letters, so only positions near the start of a line are exact.
    estimated: bool,
    fixed_pitch: bool,
}

/// Fonts that can write this many different characters are not listed to the screen.
const MAX_LISTED: usize = 4000;

impl FontInfo {
    /// The characters this font can write, one each; None when there are too
    /// many to be worth sending (a font with the whole alphabet of a language).
    fn chars(&self) -> Option<String> {
        let mut set: Vec<char> = self.unicode.values().filter_map(|s| single(s)).collect();
        set.sort_unstable();
        set.dedup();
        (set.len() <= MAX_LISTED).then(|| set.into_iter().collect())
    }

    /// Character → the code that writes it (the lowest, when several do).
    fn reverse(&self) -> HashMap<char, u32> {
        let mut out: HashMap<char, u32> = HashMap::new();
        for (code, s) in &self.unicode {
            if let Some(c) = single(s) {
                let e = out.entry(c).or_insert(*code);
                if code < e {
                    *e = *code;
                }
            }
        }
        out
    }

    fn unusable(name: &str, why: &str) -> Self {
        Self {
            name: name.to_string(),
            wide: false,
            why: Some(why.to_string()),
            unicode: HashMap::new(),
            widths: HashMap::new(),
            default_width: 0.0,
            estimated: false,
            fixed_pitch: false,
        }
    }

    /// The codes in `bytes`.
    fn codes(&self, bytes: &[u8]) -> Vec<u32> {
        if self.wide {
            bytes.chunks(2).map(|c| if c.len() == 2 { (c[0] as u32) << 8 | c[1] as u32 } else { c[0] as u32 }).collect()
        } else {
            bytes.iter().map(|&b| b as u32).collect()
        }
    }

    fn width(&self, code: u32) -> f64 {
        if let Some(w) = self.widths.get(&code) {
            return *w;
        }
        if self.estimated {
            if self.fixed_pitch {
                return 600.0;
            }
            if let Some(c) = self.unicode.get(&code).and_then(|s| s.chars().next()) {
                return super::font::helvetica_width(c) * 1000.0;
            }
        }
        self.default_width
    }
}

/// The one character `s` is, if it is exactly one.
fn single(s: &str) -> Option<char> {
    let mut it = s.chars();
    match (it.next(), it.next()) {
        (Some(c), None) => Some(c),
        _ => None,
    }
}

fn base_font_name(d: &Dictionary) -> String {
    get_name(d, b"BaseFont").map(|n| String::from_utf8_lossy(n).to_string()).unwrap_or_default()
}

fn load_font(doc: &Document, dict: &Dictionary, key: &[u8]) -> FontInfo {
    let name = {
        let n = base_font_name(dict);
        // Subset tags ("ABCDEF+") are noise to the user.
        match n.split_once('+') {
            Some((tag, rest)) if tag.len() == 6 => rest.to_string(),
            _ => {
                if n.is_empty() {
                    String::from_utf8_lossy(key).to_string()
                } else {
                    n
                }
            }
        }
    };
    let subtype = get_name(dict, b"Subtype").unwrap_or(b"");
    match subtype {
        b"Type0" => load_type0(doc, dict, name),
        b"Type3" => FontInfo::unusable(&name, "このフォントの文字は直せません（Type3）"),
        _ => load_simple(doc, dict, name),
    }
}

fn load_type0(doc: &Document, dict: &Dictionary, name: String) -> FontInfo {
    let encoding = match dict.get(b"Encoding").ok().map(|o| resolve(doc, o)) {
        Some(Object::Name(n)) => String::from_utf8_lossy(n).to_string(),
        _ => String::new(),
    };
    if encoding == "Identity-V" {
        return FontInfo::unusable(&name, "縦書きの文字は直せません");
    }
    if encoding != "Identity-H" {
        return FontInfo::unusable(&name, "このフォントの文字は直せません（文字コードの表が特殊です）");
    }
    let Some(desc) = dict
        .get(b"DescendantFonts")
        .ok()
        .map(|o| resolve(doc, o))
        .and_then(|o| o.as_array().ok())
        .and_then(|a| a.first())
        .map(|o| resolve(doc, o))
        .and_then(|o| o.as_dict().ok())
    else {
        return FontInfo::unusable(&name, "フォントの情報が読めません");
    };
    let Some(to_unicode) = read_to_unicode(doc, dict) else {
        return FontInfo::unusable(
            &name,
            "この文字には文字の情報（ToUnicode）がありません。画像かアウトラインの文字です",
        );
    };
    let default_width = get_resolved(doc, desc, b"DW").and_then(number).unwrap_or(1000.0);
    let mut widths = HashMap::new();
    if let Some(Object::Array(w)) = get_resolved(doc, desc, b"W") {
        parse_w(doc, w, &mut widths);
    }
    FontInfo {
        name,
        wide: true,
        why: None,
        unicode: to_unicode,
        widths,
        default_width,
        estimated: false,
        fixed_pitch: false,
    }
}

fn load_simple(doc: &Document, dict: &Dictionary, name: String) -> FontInfo {
    let first = get_resolved(doc, dict, b"FirstChar").and_then(number).unwrap_or(0.0) as i64;
    let mut widths = HashMap::new();
    let has_widths = match get_resolved(doc, dict, b"Widths") {
        Some(Object::Array(a)) => {
            for (i, w) in a.iter().enumerate() {
                if let Some(v) = number(resolve(doc, w)) {
                    widths.insert((first + i as i64) as u32, v);
                }
            }
            !a.is_empty()
        }
        _ => false,
    };
    let desc = get_dict(doc, dict, b"FontDescriptor");
    let missing = desc.and_then(|d| get_resolved(doc, d, b"MissingWidth")).and_then(number).unwrap_or(0.0);
    let flags = desc.and_then(|d| get_resolved(doc, d, b"Flags")).and_then(number).unwrap_or(0.0) as i64;
    let symbolic = flags & 4 != 0 && flags & 32 == 0;
    let std14 =
        ["Helvetica", "Arial", "Times", "Courier", "Symbol", "ZapfDingbats"].iter().any(|p| name.starts_with(p));
    if name.starts_with("Symbol") || name.starts_with("ZapfDingbats") {
        return FontInfo::unusable(&name, "記号のフォントの文字は直せません");
    }

    // code → text: the font's own ToUnicode first, then its encoding.
    let mut unicode = read_to_unicode(doc, dict).unwrap_or_default();
    let encoded = encoding_table(doc, dict);
    if unicode.is_empty() && encoded.is_none() && !(std14 && !symbolic) {
        return FontInfo::unusable(&name, "この文字には文字の情報がありません。画像かアウトラインの文字です");
    }
    let table = encoded.unwrap_or_else(base_standard);
    for code in 0..256u32 {
        if let (Some(c), std::collections::hash_map::Entry::Vacant(slot)) = (table[code as usize], unicode.entry(code))
        {
            slot.insert(c.to_string());
        }
    }
    FontInfo {
        fixed_pitch: name.starts_with("Courier"),
        name,
        wide: false,
        why: None,
        unicode,
        widths,
        default_width: missing,
        estimated: !has_widths,
    }
}

/// W array: `c [w1 w2 …]` and `c1 c2 w`.
fn parse_w(doc: &Document, w: &[Object], out: &mut HashMap<u32, f64>) {
    let mut i = 0;
    while i < w.len() {
        let Some(first) = number(resolve(doc, &w[i])) else { break };
        match w.get(i + 1).map(|o| resolve(doc, o)) {
            Some(Object::Array(list)) => {
                for (k, v) in list.iter().enumerate() {
                    if let Some(v) = number(resolve(doc, v)) {
                        out.insert(first as u32 + k as u32, v);
                    }
                }
                i += 2;
            }
            Some(o) => {
                let (Some(last), Some(v)) = (number(o), w.get(i + 2).and_then(|x| number(resolve(doc, x)))) else {
                    break;
                };
                // A range is never wider than the codes there are.
                for c in (first as u32)..=(last as u32).min(first as u32 + 65_535) {
                    out.insert(c, v);
                }
                i += 3;
            }
            None => break,
        }
    }
}

// -------------------------------------------------------------- ToUnicode

fn read_to_unicode(doc: &Document, font: &Dictionary) -> Option<HashMap<u32, String>> {
    let stream = match font.get(b"ToUnicode").ok().map(|o| resolve(doc, o))? {
        Object::Stream(s) => s,
        _ => return None,
    };
    let data = stream.decompressed_content().ok()?;
    let map = parse_cmap(&data);
    if map.is_empty() {
        None
    } else {
        Some(map)
    }
}

#[derive(Debug, PartialEq)]
enum Tok {
    Hex(Vec<u8>),
    Open,
    Close,
    Word(String),
}

fn tokens(data: &[u8]) -> Vec<Tok> {
    let mut out = Vec::new();
    let mut i = 0;
    while i < data.len() {
        let b = data[i];
        match b {
            b'<' if data.get(i + 1) != Some(&b'<') => {
                let end = data[i..].iter().position(|&c| c == b'>').map(|p| i + p).unwrap_or(data.len());
                let hex: Vec<u8> = data[i + 1..end].iter().copied().filter(|c| c.is_ascii_hexdigit()).collect();
                let mut bytes = Vec::with_capacity(hex.len() / 2 + 1);
                for pair in hex.chunks(2) {
                    let s = std::str::from_utf8(pair).unwrap_or("0");
                    // An odd digit at the end means a trailing 0 (ISO 32000 7.3.4.3).
                    let s = if s.len() == 1 { format!("{s}0") } else { s.to_string() };
                    bytes.push(u8::from_str_radix(&s, 16).unwrap_or(0));
                }
                out.push(Tok::Hex(bytes));
                i = end + 1;
            }
            b'[' => {
                out.push(Tok::Open);
                i += 1;
            }
            b']' => {
                out.push(Tok::Close);
                i += 1;
            }
            b'%' => {
                while i < data.len() && data[i] != b'\n' && data[i] != b'\r' {
                    i += 1;
                }
            }
            c if c.is_ascii_alphabetic() => {
                let start = i;
                while i < data.len() && data[i].is_ascii_alphanumeric() {
                    i += 1;
                }
                out.push(Tok::Word(String::from_utf8_lossy(&data[start..i]).to_string()));
            }
            _ => i += 1,
        }
    }
    out
}

fn utf16(bytes: &[u8]) -> String {
    if bytes.len() == 1 {
        return (bytes[0] as char).to_string();
    }
    let units: Vec<u16> =
        bytes.chunks(2).map(|c| if c.len() == 2 { (c[0] as u16) << 8 | c[1] as u16 } else { c[0] as u16 }).collect();
    String::from_utf16_lossy(&units)
}

fn code_of(bytes: &[u8]) -> u32 {
    bytes.iter().take(4).fold(0u32, |a, &b| a << 8 | b as u32)
}

/// A ToUnicode CMap: `bfchar` and `bfrange` sections.
fn parse_cmap(data: &[u8]) -> HashMap<u32, String> {
    let toks = tokens(data);
    let mut map = HashMap::new();
    let mut i = 0;
    while i < toks.len() {
        match &toks[i] {
            Tok::Word(w) if w == "beginbfchar" => {
                i += 1;
                while let (Some(Tok::Hex(src)), Some(Tok::Hex(dst))) = (toks.get(i), toks.get(i + 1)) {
                    map.insert(code_of(src), utf16(dst));
                    i += 2;
                }
            }
            Tok::Word(w) if w == "beginbfrange" => {
                i += 1;
                while let (Some(Tok::Hex(lo)), Some(Tok::Hex(hi))) = (toks.get(i), toks.get(i + 1)) {
                    let (lo, hi) = (code_of(lo), code_of(hi));
                    let end = hi.min(lo.saturating_add(65_535));
                    match toks.get(i + 2) {
                        Some(Tok::Hex(dst)) => {
                            let base = utf16(dst);
                            for (k, c) in (lo..=end).enumerate() {
                                // The last character counts up.
                                let mut chars: Vec<char> = base.chars().collect();
                                if let Some(last) = chars.last_mut() {
                                    *last = char::from_u32(*last as u32 + k as u32).unwrap_or('\u{fffd}');
                                }
                                map.insert(c, chars.into_iter().collect());
                            }
                            i += 3;
                        }
                        Some(Tok::Open) => {
                            i += 3;
                            let mut c = lo;
                            while let Some(Tok::Hex(d)) = toks.get(i) {
                                if c <= end {
                                    map.insert(c, utf16(d));
                                }
                                c += 1;
                                i += 1;
                            }
                            if matches!(toks.get(i), Some(Tok::Close)) {
                                i += 1;
                            }
                        }
                        _ => break,
                    }
                }
            }
            _ => i += 1,
        }
    }
    map
}

// ------------------------------------------------- simple fonts' encodings

type Table = [Option<char>; 256];

/// ASCII, which Standard, WinAnsi and MacRoman share.
fn base_standard() -> Table {
    let mut t: Table = [None; 256];
    for c in 32..127u32 {
        t[c as usize] = char::from_u32(c);
    }
    t
}

fn base_win_ansi() -> Table {
    let mut t = base_standard();
    for c in 160..256u32 {
        t[c as usize] = char::from_u32(c);
    }
    let high: [(usize, char); 18] = [
        (0x80, '€'),
        (0x85, '…'),
        (0x86, '†'),
        (0x87, '‡'),
        (0x89, '‰'),
        (0x8B, '‹'),
        (0x91, '‘'),
        (0x92, '’'),
        (0x93, '“'),
        (0x94, '”'),
        (0x95, '•'),
        (0x96, '–'),
        (0x97, '—'),
        (0x99, '™'),
        (0x9B, '›'),
        (0x8A, 'Š'),
        (0x9A, 'š'),
        (0x9F, 'Ÿ'),
    ];
    for (c, ch) in high {
        t[c] = Some(ch);
    }
    t
}

/// The font's /Encoding as a table; None when it has none.
fn encoding_table(doc: &Document, font: &Dictionary) -> Option<Table> {
    let enc = font.get(b"Encoding").ok().map(|o| resolve(doc, o))?;
    let (mut table, differences) = match enc {
        Object::Name(n) => (named_encoding(n), None),
        Object::Dictionary(d) => {
            let base = match get_resolved(doc, d, b"BaseEncoding") {
                Some(Object::Name(n)) => named_encoding(n),
                _ => base_standard(),
            };
            (base, get_resolved(doc, d, b"Differences").and_then(|o| o.as_array().ok()))
        }
        _ => return None,
    };
    if let Some(diff) = differences {
        let mut code = 0usize;
        for item in diff {
            match resolve(doc, item) {
                Object::Integer(n) => code = (*n).max(0) as usize,
                Object::Name(n) => {
                    if code < 256 {
                        table[code] = glyph_char(&String::from_utf8_lossy(n));
                    }
                    code += 1;
                }
                _ => {}
            }
        }
    }
    Some(table)
}

fn named_encoding(name: &[u8]) -> Table {
    match name {
        b"WinAnsiEncoding" => base_win_ansi(),
        _ => base_standard(),
    }
}

/// A glyph name as a character: the ones Latin text uses, `uniXXXX`.
fn glyph_char(name: &str) -> Option<char> {
    if let Some(hex) = name.strip_prefix("uni") {
        if hex.len() == 4 {
            return u32::from_str_radix(hex, 16).ok().and_then(char::from_u32);
        }
    }
    let mut chars = name.chars();
    if let (Some(c), None) = (chars.next(), chars.next()) {
        return Some(c);
    }
    let c = match name {
        "space" => ' ',
        "zero" => '0',
        "one" => '1',
        "two" => '2',
        "three" => '3',
        "four" => '4',
        "five" => '5',
        "six" => '6',
        "seven" => '7',
        "eight" => '8',
        "nine" => '9',
        "period" => '.',
        "comma" => ',',
        "hyphen" | "minus" => '-',
        "colon" => ':',
        "semicolon" => ';',
        "slash" => '/',
        "parenleft" => '(',
        "parenright" => ')',
        "bracketleft" => '[',
        "bracketright" => ']',
        "underscore" => '_',
        "at" => '@',
        "percent" => '%',
        "ampersand" => '&',
        "plus" => '+',
        "equal" => '=',
        "question" => '?',
        "exclam" => '!',
        "quotedbl" => '"',
        "quotesingle" | "quoteright" => '\'',
        "quoteleft" => '`',
        "numbersign" => '#',
        "dollar" => '$',
        "asterisk" => '*',
        "less" => '<',
        "greater" => '>',
        "backslash" => '\\',
        "braceleft" => '{',
        "braceright" => '}',
        "bar" => '|',
        "asciitilde" => '~',
        "asciicircum" => '^',
        "endash" => '–',
        "emdash" => '—',
        "bullet" => '•',
        "quotedblleft" => '“',
        "quotedblright" => '”',
        _ => return None,
    };
    Some(c)
}

// ----------------------------------------------------------------- tracing

/// One text-showing operator, as it was drawn.
#[derive(Debug, Clone)]
struct Run {
    op: usize,
    text: String,
    /// The line's start on the baseline, in page space.
    x: f64,
    y: f64,
    /// Length along the baseline, in page space.
    length: f64,
    /// Font size on the page.
    size: f64,
    color: [f64; 3],
    font_key: Vec<u8>,
    font: String,
    info: Option<Rc<FontInfo>>,
    /// Character and word spacing in force.
    tc: f64,
    tw: f64,
    /// The distance the operator moved the text position, in text space.
    advance: f64,
    /// Font size and horizontal scale: what `advance` is measured in.
    tfs: f64,
    th: f64,
    /// For `'` and `"`: the operator also moves to the next line (and `"`
    /// sets spacing), which a replacement has to keep doing.
    next_line: bool,
    spacing: Option<(f64, f64)>,
    editable: bool,
    why: String,
}

struct Trace {
    runs: Vec<Run>,
    /// How many `q` were still open at the end.
    open: usize,
}

#[derive(Clone)]
struct Gs {
    ctm: M,
    fill: [f64; 3],
    font: Option<Vec<u8>>,
    size: f64,
    tc: f64,
    tw: f64,
    th: f64,
    tl: f64,
    rise: f64,
    render: i64,
}

fn num_at(ops: &[Object], i: usize) -> f64 {
    ops.get(i).and_then(number).unwrap_or(0.0)
}

fn cmyk(c: f64, m: f64, y: f64, k: f64) -> [f64; 3] {
    [(1.0 - c) * (1.0 - k), (1.0 - m) * (1.0 - k), (1.0 - y) * (1.0 - k)]
}

fn string_of(o: &Object) -> Option<&[u8]> {
    match o {
        Object::String(s, _) => Some(s),
        _ => None,
    }
}

/// Follows the page's text. `fonts`: the page's font resources by name.
fn trace(doc: &Document, fonts: &HashMap<Vec<u8>, Rc<FontInfo>>, ops: &[Operation]) -> Trace {
    let mut gs = Gs {
        ctm: IDENTITY,
        fill: [0.0; 3],
        font: None,
        size: 0.0,
        tc: 0.0,
        tw: 0.0,
        th: 1.0,
        tl: 0.0,
        rise: 0.0,
        render: 0,
    };
    let mut stack: Vec<Gs> = Vec::new();
    let (mut tm, mut tlm) = (IDENTITY, IDENTITY);
    // After a string whose length can't be known, the text position isn't
    // either, until the next positioning operator.
    let mut unsure = false;
    let mut runs = Vec::new();
    let _ = doc;

    for (idx, op) in ops.iter().enumerate() {
        let a = &op.operands;
        match op.operator.as_str() {
            "q" => stack.push(gs.clone()),
            "Q" => {
                if let Some(g) = stack.pop() {
                    gs = g;
                }
            }
            "cm" if a.len() >= 6 => {
                gs.ctm =
                    mul([num_at(a, 0), num_at(a, 1), num_at(a, 2), num_at(a, 3), num_at(a, 4), num_at(a, 5)], gs.ctm);
            }
            "BT" => {
                tm = IDENTITY;
                tlm = IDENTITY;
                unsure = false;
            }
            "Tf" => {
                if let Some(Object::Name(n)) = a.first() {
                    gs.font = Some(n.clone());
                }
                gs.size = num_at(a, 1);
            }
            "Tc" => gs.tc = num_at(a, 0),
            "Tw" => gs.tw = num_at(a, 0),
            "Tz" => gs.th = num_at(a, 0) / 100.0,
            "TL" => gs.tl = num_at(a, 0),
            "Ts" => gs.rise = num_at(a, 0),
            "Tr" => gs.render = num_at(a, 0) as i64,
            "Td" => {
                tlm = mul(translate(num_at(a, 0), num_at(a, 1)), tlm);
                tm = tlm;
                unsure = false;
            }
            "TD" => {
                gs.tl = -num_at(a, 1);
                tlm = mul(translate(num_at(a, 0), num_at(a, 1)), tlm);
                tm = tlm;
                unsure = false;
            }
            "Tm" if a.len() >= 6 => {
                tlm = [num_at(a, 0), num_at(a, 1), num_at(a, 2), num_at(a, 3), num_at(a, 4), num_at(a, 5)];
                tm = tlm;
                unsure = false;
            }
            "T*" => {
                tlm = mul(translate(0.0, -gs.tl), tlm);
                tm = tlm;
                unsure = false;
            }
            "g" => gs.fill = [num_at(a, 0); 3],
            "rg" => gs.fill = [num_at(a, 0), num_at(a, 1), num_at(a, 2)],
            "k" => gs.fill = cmyk(num_at(a, 0), num_at(a, 1), num_at(a, 2), num_at(a, 3)),
            "sc" | "scn" => match a.iter().filter(|o| number(o).is_some()).count() {
                1 => gs.fill = [num_at(a, 0); 3],
                3 => gs.fill = [num_at(a, 0), num_at(a, 1), num_at(a, 2)],
                4 => gs.fill = cmyk(num_at(a, 0), num_at(a, 1), num_at(a, 2), num_at(a, 3)),
                _ => {}
            },
            "Tj" | "TJ" | "'" | "\"" => {
                let mut spacing = None;
                let mut next_line = false;
                if op.operator == "'" || op.operator == "\"" {
                    next_line = true;
                    if op.operator == "\"" {
                        spacing = Some((num_at(a, 0), num_at(a, 1)));
                        gs.tw = num_at(a, 0);
                        gs.tc = num_at(a, 1);
                    }
                    tlm = mul(translate(0.0, -gs.tl), tlm);
                    tm = tlm;
                    unsure = false;
                }
                // The pieces: strings, and (in TJ) the gaps between them.
                let pieces: Vec<&Object> = match (op.operator.as_str(), a.last()) {
                    ("TJ", Some(Object::Array(items))) => items.iter().collect(),
                    (_, Some(s)) => vec![s],
                    _ => Vec::new(),
                };
                let font_key = gs.font.clone().unwrap_or_default();
                let font = fonts.get(&font_key).cloned();
                let m0 = mul(mul(translate(0.0, gs.rise), tm), gs.ctm);
                let (x, y) = apply_pt(m0, 0.0, 0.0);
                let tfs = gs.size;
                let mut text = String::new();
                let mut advance = 0.0;
                let mut why = String::new();
                match &font {
                    None => why = "フォントが見つかりません".into(),
                    Some(f) => {
                        if let Some(w) = &f.why {
                            why = w.clone();
                        }
                        for piece in &pieces {
                            if let Some(bytes) = string_of(piece) {
                                for code in f.codes(bytes) {
                                    match f.unicode.get(&code) {
                                        Some(t) => text.push_str(t),
                                        None if why.is_empty() => why = "文字の対応が分からない文字があります".into(),
                                        None => {}
                                    }
                                    let mut tx = f.width(code) / 1000.0 * tfs + gs.tc;
                                    if !f.wide && code == 32 {
                                        tx += gs.tw;
                                    }
                                    advance += tx * gs.th;
                                }
                            } else if let Some(n) = number(piece) {
                                advance -= n / 1000.0 * tfs * gs.th;
                                // A wide gap is a space in text that has none.
                                if n <= -250.0 && !text.is_empty() && !text.ends_with(' ') {
                                    text.push(' ');
                                }
                            }
                        }
                    }
                }
                let m_end = mul(translate(advance, 0.0), mul(tm, gs.ctm));
                let (ex, ey) = apply_pt(m_end, 0.0, gs.rise);
                let length = ((ex - x).powi(2) + (ey - y).powi(2)).sqrt();
                let full = mul(tm, gs.ctm);
                let size = tfs * (full[2].powi(2) + full[3].powi(2)).sqrt();
                let mut editable = why.is_empty();
                if editable && unsure {
                    editable = false;
                    why = "この行の前の文字の長さが分からないため、位置を確かめられません".into();
                } else if editable && font.as_ref().is_some_and(|f| f.estimated) {
                    // Widths are guessed; the start of the line is still exact.
                }
                // Upright, left to right, not mirrored.
                if editable
                    && !(full[0] > 0.0
                        && full[3] > 0.0
                        && full[1].abs() < 1e-3 * full[0]
                        && full[2].abs() < 1e-3 * full[3])
                {
                    editable = false;
                    why = "斜めや回転した文字は直せません".into();
                }
                if editable && (gs.render != 0) {
                    editable = false;
                    why = "縁取りなどの特別な文字は直せません".into();
                }
                if editable && (size < 1.0 || !size.is_finite() || gs.size == 0.0 || gs.th == 0.0) {
                    editable = false;
                    why = "文字の大きさが分かりません".into();
                }
                if !why.is_empty() || font.is_none() {
                    unsure = true;
                }
                // An invisible layer (OCR text) is not text to fix.
                if gs.render != 3 {
                    runs.push(Run {
                        op: idx,
                        text,
                        x,
                        y,
                        length,
                        size,
                        color: gs.fill,
                        font_key,
                        font: font.as_ref().map(|f| f.name.clone()).unwrap_or_default(),
                        info: font.clone(),
                        tc: gs.tc,
                        tw: gs.tw,
                        advance,
                        tfs,
                        th: gs.th,
                        next_line,
                        spacing,
                        editable,
                        why,
                    });
                }
                // The next string starts where this one ended.
                tm = mul(translate(advance, 0.0), tm);
            }
            _ => {}
        }
    }
    Trace { runs, open: stack.len() }
}

// ------------------------------------------------------------------ public

/// What the page's content has to be like for its text to be fixed.
fn page_ops(doc: &Document, page: ObjectId) -> Result<Vec<Operation>, String> {
    let data = doc.get_page_content(page);
    // Inline images can't be written back as read; leave such pages alone.
    if data.windows(4).any(|w| w[0].is_ascii_whitespace() && &w[1..3] == b"BI" && w[3].is_ascii_whitespace()) {
        return Err("このページは画像が文字の間に埋め込まれていて、文字を直せません".into());
    }
    Content::decode(&data).map(|c| c.operations).map_err(|_| "このページの中身を読めませんでした".to_string())
}

/// The page's fonts by resource name. Read off the page's own /Resources
/// first (while composing, the page is not under its parent yet, which the
/// library's lookup needs), then through the page tree.
fn page_fonts(doc: &Document, page: ObjectId) -> HashMap<Vec<u8>, Rc<FontInfo>> {
    let mut out = HashMap::new();
    let own = doc
        .get_dictionary(page)
        .ok()
        .and_then(|p| get_dict(doc, p, b"Resources"))
        .and_then(|r| get_dict(doc, r, b"Font"));
    if let Some(fonts) = own {
        for (name, f) in fonts.iter() {
            if let Ok(dict) = resolve(doc, f).as_dict() {
                out.insert(name.clone(), Rc::new(load_font(doc, dict, name)));
            }
        }
    } else if let Ok(fonts) = doc.get_page_fonts(page) {
        for (name, dict) in fonts {
            out.insert(name.clone(), Rc::new(load_font(doc, dict, &name)));
        }
    }
    out
}

/// The lines of text on `page` that can be listed: adjacent pieces on one
/// baseline in one font, size and colour make one line.
pub fn lines(doc: &Document, page: ObjectId) -> Result<Vec<Line>, String> {
    let ops = page_ops(doc, page)?;
    let fonts = page_fonts(doc, page);
    let t = trace(doc, &fonts, &ops);
    Ok(group(&t.runs))
}

fn group(runs: &[Run]) -> Vec<Line> {
    let mut out: Vec<Line> = Vec::new();
    let mut i = 0;
    while i < runs.len() {
        let r = &runs[i];
        if r.text.trim().is_empty() && r.editable {
            i += 1;
            continue;
        }
        let mut ops = vec![r.op as u32];
        let mut text = r.text.clone();
        let (mut x2, mut why) = (r.x + r.length, r.why.clone());
        let mut y_min = r.y;
        let mut j = i + 1;
        // Join what follows on the same line.
        while r.editable && j < runs.len() {
            let n = &runs[j];
            let near = (n.y - r.y).abs() < 0.15 * r.size && (n.size - r.size).abs() < 0.02 * r.size.max(1.0);
            let gap = n.x - x2;
            if !(n.editable
                && near
                && n.font_key == r.font_key
                && n.color == r.color
                && gap > -0.5 * r.size
                && gap < 0.6 * r.size)
            {
                break;
            }
            if gap > 0.25 * r.size && !text.ends_with(' ') && !n.text.starts_with(' ') {
                text.push(' ');
            }
            text.push_str(&n.text);
            ops.push(n.op as u32);
            x2 = x2.max(n.x + n.length);
            y_min = y_min.min(n.y);
            j += 1;
        }
        if why.is_empty() && !r.editable {
            why = "この文字は直せません".into();
        }
        out.push(Line {
            ops,
            text,
            rect: [r.x, y_min - BOX_DESCENT * r.size, x2, y_min + BOX_ASCENT * r.size],
            size: r.size,
            color: color_hex(r.color),
            font: r.font.clone(),
            chars: r.info.as_ref().and_then(|f| f.chars()),
            editable: r.editable,
            why,
        });
        i = j;
    }
    out
}

/// Gives each operator in `changes` a replacement that shows nothing but
/// keeps the text position, draws the new lines, and installs the font.
/// Changes that no longer match the page are skipped.
pub fn apply(doc: &mut Document, page: ObjectId, changes: &[Change], font: &mut Embedder) -> Result<(), String> {
    if changes.is_empty() {
        return Ok(());
    }
    let ops = page_ops(doc, page)?;
    let fonts = page_fonts(doc, page);
    let t = trace(doc, &fonts, &ops);
    let by_op: HashMap<usize, &Run> = t.runs.iter().map(|r| (r.op, r)).collect();

    let mut silenced: HashMap<usize, &Run> = HashMap::new();
    let mut drawn: Vec<(&Change, &Run)> = Vec::new();
    for c in changes {
        let runs: Vec<&Run> = c.ops.iter().filter_map(|o| by_op.get(&(*o as usize)).copied()).collect();
        if runs.is_empty() || runs.len() != c.ops.len() || runs.iter().any(|r| !r.editable) {
            log::warn!("文字の修正を飛ばしました（ページの中身と合いません）: {:?}", c.ops);
            continue;
        }
        for r in &runs {
            silenced.insert(r.op, r);
        }
        drawn.push((c, runs[0]));
    }
    if drawn.is_empty() {
        return Ok(());
    }

    // The page as it was, with the old lines' operators made silent.
    let mut out: Vec<Operation> = Vec::with_capacity(ops.len() + 8);
    out.push(Operation::new("q", vec![]));
    for (i, op) in ops.into_iter().enumerate() {
        match silenced.get(&i) {
            Some(r) => out.extend(silent(r)),
            None => out.push(op),
        }
    }
    // Close what the page left open, so the new text starts from a clean state.
    for _ in 0..=t.open {
        out.push(Operation::new("Q", vec![]));
    }

    let font_id = font.font_ref(doc);
    for (c, first) in drawn {
        let size = if c.size.is_finite() && c.size > 0.5 { c.size } else { first.size };
        // The line's own font writes what it can; the rest is in the app's font.
        let own = first.info.as_ref().map(|f| (f.clone(), f.reverse()));
        for (n, line) in c.text.split('\n').enumerate() {
            if line.is_empty() {
                continue;
            }
            let y = first.y - n as f64 * size * 1.2;
            out.push(Operation::new("q", vec![]));
            out.push(Operation::new("BT", vec![]));
            out.push(Operation::new("rg", c.color.iter().map(|v| real(*v)).collect()));
            out.push(Operation::new("Tm", vec![real(1.0), real(0.0), real(0.0), real(1.0), real(first.x), real(y)]));
            for (uses_own, piece) in split_by_font(line, own.as_ref().map(|(_, r)| r)) {
                if uses_own {
                    let (info, reverse) = own.as_ref().expect("own font");
                    // As the line was set: its spacing and width scale.
                    out.push(Operation::new("Tf", vec![Object::Name(first.font_key.clone()), real(size)]));
                    out.push(Operation::new("Tc", vec![real(first.tc)]));
                    out.push(Operation::new("Tw", vec![real(first.tw)]));
                    out.push(Operation::new("Tz", vec![real(first.th * 100.0)]));
                    let mut bytes = Vec::with_capacity(piece.len() * 2);
                    for ch in piece.chars() {
                        let code = reverse[&ch];
                        if info.wide {
                            bytes.extend_from_slice(&(code as u16).to_be_bytes());
                        } else {
                            bytes.push(code as u8);
                        }
                    }
                    out.push(Operation::new("Tj", vec![Object::String(bytes, lopdf::StringFormat::Hexadecimal)]));
                } else {
                    out.push(Operation::new("Tf", vec![Object::Name(NEW_FONT.as_bytes().to_vec()), real(size)]));
                    out.push(Operation::new("Tc", vec![real(0.0)]));
                    out.push(Operation::new("Tw", vec![real(0.0)]));
                    out.push(Operation::new("Tz", vec![real(100.0)]));
                    let encoded = font.encode(&piece);
                    out.push(Operation::new(
                        "Tj",
                        vec![Object::String(decode_hex(&encoded), lopdf::StringFormat::Hexadecimal)],
                    ));
                }
            }
            out.push(Operation::new("ET", vec![]));
            out.push(Operation::new("Q", vec![]));
        }
    }

    let data = Content { operations: out }.encode().map_err(|e| format!("ページの中身を書けませんでした: {e}"))?;
    let mut stream = Stream::new(dictionary! {}, data);
    let _ = stream.compress();
    let stream_id = doc.add_object(stream);
    doc.get_dictionary_mut(page).map_err(|e| e.to_string())?.set("Contents", Object::Reference(stream_id));
    install_font(doc, page, font_id)
}

/// `line` cut into runs of characters the line's own font can write (`true`)
/// and the rest. Without an own font, all of it is the app's.
fn split_by_font(line: &str, own: Option<&HashMap<char, u32>>) -> Vec<(bool, String)> {
    let mut out: Vec<(bool, String)> = Vec::new();
    for ch in line.chars() {
        let uses_own = own.is_some_and(|r| r.contains_key(&ch));
        match out.last_mut() {
            Some((u, s)) if *u == uses_own => s.push(ch),
            _ => out.push((uses_own, ch.to_string())),
        }
    }
    out
}

fn real(v: f64) -> Object {
    Object::Real(v as f32)
}

/// "<0102…>" as bytes.
fn decode_hex(s: &str) -> Vec<u8> {
    let digits: Vec<u8> = s.bytes().filter(|c| c.is_ascii_hexdigit()).collect();
    digits.chunks(2).map(|p| u8::from_str_radix(std::str::from_utf8(p).unwrap_or("0"), 16).unwrap_or(0)).collect()
}

/// What replaces a run's operator: it moves the text position as far as the
/// string did and shows nothing.
fn silent(r: &Run) -> Vec<Operation> {
    let mut out = Vec::new();
    if r.next_line {
        if let Some((aw, ac)) = r.spacing {
            out.push(Operation::new("Tw", vec![real(aw)]));
            out.push(Operation::new("Tc", vec![real(ac)]));
        }
        out.push(Operation::new("T*", vec![]));
    }
    let unit = r.tfs * r.th;
    if unit.abs() > 1e-9 && r.advance.abs() > 1e-9 {
        // A TJ number counts in thousandths of the font size, backwards.
        let n = -r.advance * 1000.0 / unit;
        out.push(Operation::new("TJ", vec![Object::Array(vec![real(n)])]));
    }
    out
}

/// Adds the new font to the page's /Resources /Font. The page's resources
/// (and its font list) may be direct or references, and shared with other
/// pages: they are copied onto this page with the font added, so the page's
/// other fonts stay and nothing shared is touched.
fn install_font(doc: &mut Document, page: ObjectId, font_id: ObjectId) -> Result<(), String> {
    let dict_of = |doc: &Document, o: Option<&Object>| -> Dictionary {
        match o {
            Some(Object::Dictionary(d)) => d.clone(),
            Some(Object::Reference(id)) => doc.get_dictionary(*id).cloned().unwrap_or_default(),
            _ => Dictionary::new(),
        }
    };
    let page_dict = doc.get_dictionary(page).map_err(|e| e.to_string())?;
    let mut resources = dict_of(doc, page_dict.get(b"Resources").ok());
    let mut fonts = dict_of(doc, resources.get(b"Font").ok());
    fonts.set(NEW_FONT, Object::Reference(font_id));
    resources.set("Font", Object::Dictionary(fonts));
    doc.get_dictionary_mut(page).map_err(|e| e.to_string())?.set("Resources", Object::Dictionary(resources));
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pdf::compose::{compose, Input, PageSpec};
    use crate::pdf::image::ImageStore;
    use crate::pdf::open::open_bytes;
    use crate::pdf::{Annot, AnnotKind};
    use lopdf::StringFormat;
    use std::collections::HashMap;
    use std::sync::Arc;

    /// A one-page document with `content`, and these fonts as /F1, /F2….
    fn page_with(content: &str, fonts: Vec<Object>, doc: Option<Document>) -> (Document, ObjectId) {
        let mut doc = doc.unwrap_or_else(|| Document::with_version("1.7"));
        let pages_id = doc.new_object_id();
        let c = doc.add_object(Stream::new(dictionary! {}, content.as_bytes().to_vec()));
        let mut font_dict = Dictionary::new();
        for (i, f) in fonts.into_iter().enumerate() {
            font_dict.set(format!("F{}", i + 1), f);
        }
        let page = doc.add_object(dictionary! {
            "Type" => "Page", "Parent" => pages_id, "Contents" => c,
            "MediaBox" => vec![0.into(), 0.into(), 595.into(), 842.into()],
            "Resources" => dictionary! { "Font" => font_dict },
        });
        doc.objects.insert(
            pages_id,
            Object::Dictionary(dictionary! { "Type" => "Pages", "Kids" => vec![page.into()], "Count" => 1 }),
        );
        let catalog = doc.add_object(dictionary! { "Type" => "Catalog", "Pages" => pages_id });
        doc.trailer.set("Root", catalog);
        (doc, page)
    }

    fn helvetica(doc: &mut Document) -> Object {
        doc.add_object(dictionary! {
            "Type" => "Font", "Subtype" => "Type1", "BaseFont" => "Helvetica", "Encoding" => "WinAnsiEncoding",
        })
        .into()
    }

    /// An Identity-H font: code 1 = あ (half an em), 2 = い (0.6 em), 3 = space.
    fn cid_font(doc: &mut Document) -> Object {
        let cmap = "/CIDInit /ProcSet findresource begin 12 dict begin begincmap\n\
            1 begincodespacerange <0000> <FFFF> endcodespacerange\n\
            2 beginbfchar <0001> <3042> <0002> <3044> endbfchar\n\
            1 beginbfrange <0003> <0003> <0020> endbfrange\n\
            endcmap end end";
        let to_unicode = doc.add_object(Stream::new(dictionary! {}, cmap.as_bytes().to_vec()));
        let desc = doc.add_object(dictionary! {
            "Type" => "Font", "Subtype" => "CIDFontType2", "BaseFont" => "ABCDEF+Gothic", "DW" => 1000,
            "W" => vec![1.into(), vec![500.into(), 600.into(), 250.into()].into()],
        });
        doc.add_object(dictionary! {
            "Type" => "Font", "Subtype" => "Type0", "BaseFont" => "ABCDEF+Gothic", "Encoding" => "Identity-H",
            "DescendantFonts" => vec![desc.into()], "ToUnicode" => to_unicode,
        })
        .into()
    }

    #[test]
    fn lists_simple_font_lines() {
        let mut doc = Document::with_version("1.7");
        let f = helvetica(&mut doc);
        let (doc, page) = page_with(
            "BT /F1 12 Tf 72 700 Td (Hello World) Tj ET\nBT /F1 12 Tf 72 680 Td [(Hel) -20 (lo)] TJ ET",
            vec![f],
            Some(doc),
        );
        let lines = lines(&doc, page).unwrap();
        assert_eq!(lines.len(), 2);
        assert_eq!(lines[0].text, "Hello World");
        assert!(lines[0].editable, "{}", lines[0].why);
        assert_eq!(lines[0].rect[0], 72.0);
        assert_eq!(lines[0].size, 12.0);
        assert_eq!(lines[0].font, "Helvetica");
        assert_eq!(lines[1].text, "Hello");
        assert_eq!(lines[1].ops.len(), 1);
    }

    #[test]
    fn follows_the_text_state() {
        let mut doc = Document::with_version("1.7");
        let f = helvetica(&mut doc);
        // Scaled by cm, moved by Td/T*, coloured, sized by Tf.
        let (doc, page) =
            page_with("q 2 0 0 2 10 20 cm 0.5 g BT /F1 10 Tf 12 TL 5 100 Td (A) Tj T* (B) Tj ET Q", vec![f], Some(doc));
        let lines = lines(&doc, page).unwrap();
        assert_eq!(lines.len(), 2);
        // (5,100) → ×2 + (10,20)
        assert_eq!((lines[0].rect[0], lines[0].size), (20.0, 20.0));
        assert_eq!(lines[0].color, "#808080");
        // T* moves down 12 text units = 24 page units; the baseline is box bottom + 0.22 em.
        let baseline = lines[1].rect[1] + BOX_DESCENT * lines[1].size;
        assert!((baseline - (220.0 - 24.0)).abs() < 1e-6, "{baseline}");
    }

    #[test]
    fn reads_cid_fonts_and_measures_them() {
        let mut doc = Document::with_version("1.7");
        let f = cid_font(&mut doc);
        let (doc, page) = page_with("BT /F1 10 Tf 50 500 Td <000100020003> Tj ET", vec![f], Some(doc));
        let lines = lines(&doc, page).unwrap();
        assert_eq!(lines.len(), 1);
        // The trailing space is kept in the text; the font name has no subset tag.
        assert_eq!(lines[0].text, "あい ");
        assert_eq!(lines[0].font, "Gothic");
        // 500 + 600 + 250 per mille of 10 pt.
        assert!((lines[0].rect[2] - 50.0 - 13.5).abs() < 1e-6, "{:?}", lines[0].rect);
    }

    #[test]
    fn joins_pieces_of_one_line() {
        let mut doc = Document::with_version("1.7");
        let f = helvetica(&mut doc);
        let (doc, page) = page_with(
            "BT /F1 12 Tf 72 700 Td (Hello) Tj ( World) Tj ET BT /F1 12 Tf 72 600 Td (Other) Tj ET",
            vec![f],
            Some(doc),
        );
        let l = lines(&doc, page).unwrap();
        // The second Tj starts where the first ended: one line.
        assert_eq!(l.len(), 2, "{l:?}");
        assert_eq!(l[0].ops.len(), 2);
        assert_eq!(l[0].text, "Hello World");
        assert_eq!(l[1].text, "Other");
    }

    #[test]
    fn says_why_a_line_cant_be_fixed() {
        let mut doc = Document::with_version("1.7");
        let f = helvetica(&mut doc);
        let t3 = doc.add_object(dictionary! { "Type" => "Font", "Subtype" => "Type3" }).into();
        let v =
            doc.add_object(dictionary! { "Type" => "Font", "Subtype" => "Type0", "Encoding" => "Identity-V" }).into();
        let (doc, page) = page_with(
            "BT /F2 12 Tf 10 10 Td (x) Tj ET BT /F3 12 Tf 10 30 Td <0001> Tj ET \
             BT /F1 12 Tf 0.9 0.4 -0.4 0.9 10 50 Tm (tilted) Tj ET",
            vec![f, t3, v],
            Some(doc),
        );
        let l = lines(&doc, page).unwrap();
        assert_eq!(l.len(), 3);
        assert!(l.iter().all(|x| !x.editable && !x.why.is_empty()), "{l:?}");
        assert!(l[1].why.contains("縦書き"));
    }

    #[test]
    fn a_page_with_inline_images_is_left_alone() {
        let mut doc = Document::with_version("1.7");
        let f = helvetica(&mut doc);
        let (doc, page) =
            page_with("q BI /W 1 /H 1 /CS /G /BPC 8 ID \x00 EI Q BT /F1 12 Tf (a) Tj ET", vec![f], Some(doc));
        assert!(lines(&doc, page).is_err());
    }

    #[test]
    fn the_old_line_goes_silent_and_the_new_one_is_drawn() {
        let mut doc = Document::with_version("1.7");
        let f = helvetica(&mut doc);
        let (mut doc, page) =
            page_with("BT /F1 12 Tf 72 700 Td (Hello World) Tj 0 -20 Td (Next) Tj ET", vec![f], Some(doc));
        let l = lines(&doc, page).unwrap();
        let mut font = Embedder::new(None);
        let change = Change { ops: l[0].ops.clone(), text: "Goodbye".into(), size: 14.0, color: [1.0, 0.0, 0.0] };
        apply(&mut doc, page, &[change], &mut font).unwrap();
        font.finish(&mut doc).unwrap();

        let ops = Content::decode(&doc.get_page_content(page)).unwrap().operations;
        let names: Vec<&str> = ops.iter().map(|o| o.operator.as_str()).collect();
        // The old Tj is now a TJ that only moves; "Next" is still drawn by its own Tj at the same place.
        assert!(!ops
            .iter()
            .any(|o| o.operator == "Tj" && o.operands.first().and_then(string_of) == Some(b"Hello World")));
        assert!(ops.iter().any(|o| o.operator == "Tj" && o.operands.first().and_then(string_of) == Some(b"Next")));
        let spacer = ops.iter().find(|o| o.operator == "TJ").expect("a spacer");
        // Helvetica widths are estimated, so only the sign and size are checked: it moves forward.
        let n = number(&spacer.operands[0].as_array().unwrap()[0]).unwrap();
        assert!(n < 0.0, "{n}");
        assert_eq!(names.first(), Some(&"q"));
        assert!(ops.iter().filter(|o| o.operator == "Q").count() >= 2);
        // The new font is on the page.
        let (res, _) = doc.get_page_resources(page).unwrap();
        assert!(get_dict(&doc, res.unwrap(), b"Font").unwrap().get(NEW_FONT.as_bytes()).is_ok());
        // Original font untouched.
        assert!(get_dict(&doc, res.unwrap(), b"Font").unwrap().get(b"F1").is_ok());
    }

    #[test]
    fn keeps_the_other_fonts_when_resources_are_references() {
        let mut doc = Document::with_version("1.7");
        let f = helvetica(&mut doc);
        let (mut doc, page) = page_with("BT /F1 12 Tf 72 700 Td (Hello) Tj ET", vec![f], Some(doc));
        // As LibreOffice writes them: /Resources and /Font are references.
        let fonts = doc
            .get_dictionary(page)
            .unwrap()
            .get(b"Resources")
            .and_then(|r| r.as_dict())
            .unwrap()
            .get(b"Font")
            .unwrap()
            .clone();
        let fonts_id = doc.add_object(fonts);
        let res_id = doc.add_object(dictionary! { "Font" => fonts_id });
        doc.get_dictionary_mut(page).unwrap().set("Resources", res_id);
        let l = lines(&doc, page).unwrap();
        assert_eq!(l.len(), 1);
        let mut font = Embedder::new(None);
        let change = Change { ops: l[0].ops.clone(), text: "Bye".into(), size: 12.0, color: [0.0; 3] };
        apply(&mut doc, page, &[change], &mut font).unwrap();
        let res = get_dict(&doc, doc.get_dictionary(page).unwrap(), b"Resources").unwrap();
        let fonts = get_dict(&doc, res, b"Font").unwrap();
        assert!(fonts.get(b"F1").is_ok(), "the page's own font is still there");
        assert!(fonts.get(NEW_FONT.as_bytes()).is_ok());
        // Still reads back after the change (the new line is Helvetica-less text in the new font).
        assert!(lines(&doc, page).is_ok());
    }

    #[test]
    fn saving_fixes_the_line_and_a_stale_change_is_skipped() {
        let mut doc = Document::with_version("1.7");
        let f = helvetica(&mut doc);
        let (doc, _) = page_with("BT /F1 12 Tf 72 700 Td (Hello World) Tj ET", vec![f], Some(doc));
        let mut bytes = Vec::new();
        let mut d = doc;
        d.save_to(&mut bytes).unwrap();
        let src = Arc::new(open_bytes(bytes, &mut ImageStore::default()).unwrap().doc.unwrap());
        let page = src.get_pages()[&1];
        let l = lines(&src, page).unwrap();

        let edit = Annot {
            id: "pdfe-e1".into(),
            kind: AnnotKind::Edit,
            runs: l[0].ops.clone(),
            text: "Hi".into(),
            font_size: 12.0,
            color: "#000000".into(),
            rect: Some(l[0].rect),
            ..Default::default()
        };
        let stale = Annot { id: "pdfe-e2".into(), runs: vec![999], ..edit.clone() };
        let mut sources = HashMap::new();
        sources.insert(1, src);
        let specs = vec![PageSpec { source: Some(1), index: 0, rotate: 0, size: None, annots: vec![edit, stale] }];
        let images = ImageStore::default();
        let out = compose(Input { sources: &sources, pages: &specs, forms: &[], font: None, images: &images }).unwrap();

        let back = Document::load_mem(&out).unwrap();
        let p = back.get_pages()[&1];
        let ops = Content::decode(&back.get_page_content(p)).unwrap().operations;
        // No annotation was written for an Edit, and the page has the new text.
        assert!(back.get_dictionary(p).unwrap().get(b"Annots").is_err());
        let shown: Vec<Vec<u8>> = ops
            .iter()
            .filter(|o| o.operator == "Tj")
            .filter_map(|o| o.operands.first().and_then(string_of).map(|s| s.to_vec()))
            .collect();
        assert_eq!(shown.len(), 1, "only the new line is shown: {shown:?}");
        assert!(!shown.iter().any(|s| s == b"Hello World"));
        // Helvetica fallback: two bytes "Hi" in WinAnsi.
        assert_eq!(shown[0], b"Hi");
        let _ = StringFormat::Hexadecimal;
    }

    #[test]
    fn new_text_keeps_the_lines_own_font_where_it_can() {
        let mut doc = Document::with_version("1.7");
        let f = helvetica(&mut doc);
        let (mut doc, page) = page_with("BT /F1 12 Tf 0 Tc 0 Tw 72 700 Td (Hello World) Tj ET", vec![f], Some(doc));
        let l = lines(&doc, page).unwrap();
        // Helvetica writes ASCII (and WinAnsi's accented letters), nothing else.
        let chars = l[0].chars.clone().unwrap();
        assert!(chars.contains('H') && chars.contains('ü') && !chars.contains('世'));

        let mut font = Embedder::new(None);
        let change = Change { ops: l[0].ops.clone(), text: "Hello 世界!".into(), size: 12.0, color: [0.0; 3] };
        apply(&mut doc, page, &[change], &mut font).unwrap();
        let ops = Content::decode(&doc.get_page_content(page)).unwrap().operations;
        // After the silent spacer: Tj "Hello " in F1, a Tj for 世界 in the app's font, Tj "!" in F1.
        let mut current: Option<Vec<u8>> = None;
        let mut shown: Vec<(Vec<u8>, Vec<u8>)> = Vec::new();
        for o in &ops {
            match o.operator.as_str() {
                "Tf" => {
                    if let Some(Object::Name(n)) = o.operands.first() {
                        current = Some(n.clone());
                    }
                }
                "Tj" => {
                    if let (Some(f), Some(s)) = (&current, o.operands.first().and_then(string_of)) {
                        shown.push((f.clone(), s.to_vec()));
                    }
                }
                _ => {}
            }
        }
        // The old line is silent (a TJ), so every Tj left belongs to the new one.
        assert_eq!(shown.len(), 3, "{shown:?}");
        assert_eq!(shown[0], (b"F1".to_vec(), b"Hello ".to_vec()));
        assert_eq!(shown[1].0, NEW_FONT.as_bytes().to_vec());
        assert_eq!(shown[2], (b"F1".to_vec(), b"!".to_vec()));
    }

    #[test]
    fn a_cid_font_writes_its_own_codes() {
        let mut doc = Document::with_version("1.7");
        let f = cid_font(&mut doc);
        let (mut doc, page) = page_with("BT /F1 10 Tf 50 500 Td <00010002> Tj ET", vec![f], Some(doc));
        let l = lines(&doc, page).unwrap();
        assert_eq!(l[0].chars.as_deref(), Some(" あい"));
        let mut font = Embedder::new(None);
        let change = Change { ops: l[0].ops.clone(), text: "いあ".into(), size: 10.0, color: [0.0; 3] };
        apply(&mut doc, page, &[change], &mut font).unwrap();
        let ops = Content::decode(&doc.get_page_content(page)).unwrap().operations;
        let tj: Vec<&[u8]> =
            ops.iter().filter(|o| o.operator == "Tj").filter_map(|o| o.operands.first().and_then(string_of)).collect();
        assert_eq!(tj, [&[0u8, 2, 0, 1][..]]);
    }

    #[test]
    fn parses_tounicode_ranges() {
        let m = parse_cmap(
            b"beginbfchar <01> <0041> <02> <D83DDE00> endbfchar \
              beginbfrange <10> <12> <0061> <20> <21> [<3042> <3044>] endbfrange",
        );
        assert_eq!(m[&1], "A");
        assert_eq!(m[&2], "\u{1F600}");
        assert_eq!((m[&0x10].as_str(), m[&0x12].as_str()), ("a", "c"));
        assert_eq!((m[&0x20].as_str(), m[&0x21].as_str()), ("あ", "い"));
    }
}

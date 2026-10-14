//! Reading and writing PDF files (docs/ARCHITECTURE.md).
//!
//! The frontend draws pages with pdf.js and keeps the edits (page order,
//! rotation, annotations, form values) as plain data. Writing a file is done
//! here, from the documents as they were opened plus that data:
//!
//! - `open`: loads a file, takes out the annotations this app can edit
//!   (they come back as data, and pdf.js is given the document without them)
//! - `compose`: puts the pages of one or more documents together in the
//!   order asked for, and writes the annotations and form values back
//! - `annots`, `forms`: the dictionaries and their appearance streams
//! - `font`: a Japanese system font, embedded as a subset, for typed text
//! - `image`: pictures (stamps, seals, signatures) as image XObjects

pub mod annots;
pub mod compose;
pub mod content;
pub mod font;
pub mod forms;
pub mod image;
pub mod open;
pub mod textedit;

use lopdf::{Dictionary, Object, ObjectId};
use serde::{Deserialize, Serialize};

/// What the user can put on a page. Coordinates are in the page's own PDF
/// space (points, origin bottom left, before /Rotate), so a page can be
/// rotated or moved without touching its annotations.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AnnotKind {
    Highlight,
    Underline,
    Strikeout,
    Ink,
    Rect,
    Ellipse,
    Line,
    Arrow,
    /// A text box (FreeText).
    Text,
    /// A sticky note (Text annotation).
    Note,
    /// A picture: seal, signature, logo (Stamp).
    Image,
    /// A seal drawn by the app (Stamp): a round date seal, or a word in a
    /// box (承認済み, 社外秘). Vector, in the embedded font, so it stays
    /// sharp and its words can be changed.
    Seal,
    /// A line of the page's own text that was fixed (textedit.rs). It is
    /// not an annotation: saving rewrites the page's content (the old line
    /// is removed, the new one drawn), and the file has no trace of it.
    Edit,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Annot {
    /// Kept as /NM, so an annotation keeps its identity across saves.
    pub id: String,
    pub kind: AnnotKind,
    /// "#rrggbb": the stroke, the marker, or the text.
    pub color: String,
    pub opacity: f64,
    /// Line width in points; 0 = no border (text boxes).
    pub width: f64,
    /// "#rrggbb" fill for shapes and text boxes; None = clear.
    pub fill: Option<String>,
    /// [x1, y1, x2, y2] with x1 < x2, y1 < y2.
    pub rect: Option<[f64; 4]>,
    /// Text markup: one quadrilateral per line of text, as /QuadPoints orders
    /// them (upper left, upper right, lower left, lower right).
    pub quads: Vec<[f64; 8]>,
    /// Ink: strokes of x, y, x, y, …
    pub paths: Vec<Vec<f64>>,
    /// Lines and arrows: x1, y1, x2, y2 (the arrow head is at the end).
    pub line: Option<[f64; 4]>,
    /// The text of a text box.
    pub text: String,
    /// The text box's lines as the frontend wrapped them, so the file shows
    /// the same breaks as the screen. Empty: `text` split at newlines.
    pub lines: Vec<String>,
    pub font_size: f64,
    /// Text boxes and pictures: turned this much (0, 90, 180, 270) so they
    /// read upright on a page shown with that rotation.
    pub rotation: u16,
    /// A picture in the image store (image.rs).
    pub image: Option<u32>,
    /// A seal's shape: "round" (a date seal: three lines, the date in the
    /// middle band) or "box" (one word in a frame). The words are in `text`,
    /// one per line.
    pub seal: Option<String>,
    /// An `Edit`'s old line: the page content operators that drew it
    /// (textedit.rs `Line::ops`). `text` is what it says now; `rect` is the
    /// old line's box, `font_size` and `color` how the new one is drawn.
    pub runs: Vec<u32>,
    /// The comment (pop-up note), /Contents.
    pub contents: String,
    pub author: String,
    /// When it was last changed, as a PDF date (D:YYYYMMDDHHmmSS).
    pub modified: String,
}

impl Default for Annot {
    fn default() -> Self {
        Self {
            id: String::new(),
            kind: AnnotKind::Rect,
            color: "#000000".into(),
            opacity: 1.0,
            width: 1.0,
            fill: None,
            rect: None,
            quads: Vec::new(),
            paths: Vec::new(),
            line: None,
            text: String::new(),
            lines: Vec::new(),
            font_size: 12.0,
            rotation: 0,
            image: None,
            seal: None,
            runs: Vec::new(),
            contents: String::new(),
            author: String::new(),
            modified: String::new(),
        }
    }
}

/// Our own annotations carry this prefix in /NM; a picture is only read back
/// as a picture when it is one of ours (we know how its appearance is drawn).
pub const OWN_PREFIX: &str = "pdfe-";

pub type Rgb = [f64; 3];

/// "#rrggbb" (or "#rgb") to 0..1 components; black when unreadable.
pub fn parse_color(s: &str) -> Rgb {
    let h = s.trim().trim_start_matches('#');
    let hex = |i: usize, n: usize| u8::from_str_radix(h.get(i..i + n)?, 16).ok();
    let rgb = match h.len() {
        6 => (|| Some([hex(0, 2)?, hex(2, 2)?, hex(4, 2)?]))(),
        3 => (|| Some([hex(0, 1)? * 17, hex(1, 1)? * 17, hex(2, 1)? * 17]))(),
        _ => None,
    };
    rgb.map(|c| c.map(|v| v as f64 / 255.0)).unwrap_or([0.0; 3])
}

pub fn color_hex(c: Rgb) -> String {
    let b = |v: f64| (v.clamp(0.0, 1.0) * 255.0).round() as u8;
    format!("#{:02x}{:02x}{:02x}", b(c[0]), b(c[1]), b(c[2]))
}

/// A /C or /IC array (gray, RGB or CMYK) as RGB; None for an empty array
/// (transparent).
pub fn color_from_array(a: &[Object]) -> Option<Rgb> {
    let v: Vec<f64> = a.iter().filter_map(number).collect();
    match v.len() {
        1 => Some([v[0]; 3]),
        3 => Some([v[0], v[1], v[2]]),
        4 => {
            let k = v[3];
            Some([(1.0 - v[0]) * (1.0 - k), (1.0 - v[1]) * (1.0 - k), (1.0 - v[2]) * (1.0 - k)])
        }
        _ => None,
    }
}

pub fn color_array(c: Rgb) -> Object {
    Object::Array(c.iter().map(|&v| Object::Real(v as f32)).collect())
}

pub fn number(o: &Object) -> Option<f64> {
    match o {
        Object::Integer(i) => Some(*i as f64),
        Object::Real(r) => Some(*r as f64),
        _ => None,
    }
}

pub fn numbers(o: &Object) -> Vec<f64> {
    match o {
        Object::Array(a) => a.iter().filter_map(number).collect(),
        _ => Vec::new(),
    }
}

/// A PDF text string: PDFDocEncoding when it is plain ASCII, else UTF-16BE
/// with a byte order mark (Japanese in /Contents, /T…).
pub fn text_string(s: &str) -> Object {
    if s.bytes().all(|b| (0x20..0x7f).contains(&b) || b == b'\n' || b == b'\r' || b == b'\t') {
        Object::string_literal(s)
    } else {
        let mut bytes = vec![0xfe, 0xff];
        for u in s.encode_utf16() {
            bytes.extend_from_slice(&u.to_be_bytes());
        }
        Object::String(bytes, lopdf::StringFormat::Hexadecimal)
    }
}

/// Reads a text string in any of the encodings writers use.
pub fn decode_text(bytes: &[u8]) -> String {
    if let Some(rest) = bytes.strip_prefix(&[0xfe, 0xff]) {
        let units: Vec<u16> = rest.as_chunks::<2>().0.iter().map(|c| u16::from_be_bytes(*c)).collect();
        String::from_utf16_lossy(&units)
    } else if let Some(rest) = bytes.strip_prefix(&[0xff, 0xfe]) {
        let units: Vec<u16> = rest.as_chunks::<2>().0.iter().map(|c| u16::from_le_bytes(*c)).collect();
        String::from_utf16_lossy(&units)
    } else if let Some(rest) = bytes.strip_prefix(&[0xef, 0xbb, 0xbf]) {
        String::from_utf8_lossy(rest).into_owned()
    } else {
        // PDFDocEncoding matches Latin-1 closely enough for what we read
        // (author names and comments written by other tools).
        bytes.iter().map(|&b| b as char).collect()
    }
}

pub fn get_text(d: &Dictionary, key: &[u8]) -> String {
    match d.get(key) {
        Ok(Object::String(b, _)) => decode_text(b),
        _ => String::new(),
    }
}

pub fn get_name<'a>(d: &'a Dictionary, key: &[u8]) -> Option<&'a [u8]> {
    match d.get(key) {
        Ok(Object::Name(n)) => Some(n.as_slice()),
        _ => None,
    }
}

/// A dictionary entry, following a reference.
pub fn resolve<'a>(doc: &'a lopdf::Document, o: &'a Object) -> &'a Object {
    match o {
        Object::Reference(id) => doc.get_object(*id).unwrap_or(o),
        _ => o,
    }
}

pub fn get_resolved<'a>(doc: &'a lopdf::Document, d: &'a Dictionary, key: &[u8]) -> Option<&'a Object> {
    d.get(key).ok().map(|o| resolve(doc, o))
}

pub fn get_dict<'a>(doc: &'a lopdf::Document, d: &'a Dictionary, key: &[u8]) -> Option<&'a Dictionary> {
    match get_resolved(doc, d, key)? {
        Object::Dictionary(d) => Some(d),
        Object::Stream(s) => Some(&s.dict),
        _ => None,
    }
}

pub fn ref_id(o: &Object) -> Option<ObjectId> {
    match o {
        Object::Reference(id) => Some(*id),
        _ => None,
    }
}

/// The normalized rectangle of a /Rect array.
pub fn rect_of(o: &Object) -> Option<[f64; 4]> {
    let v = numbers(o);
    (v.len() == 4).then(|| [v[0].min(v[2]), v[1].min(v[3]), v[0].max(v[2]), v[1].max(v[3])])
}

pub fn rect_array(r: [f64; 4]) -> Object {
    Object::Array(r.iter().map(|&v| Object::Real(v as f32)).collect())
}

/// D:YYYYMMDDHHmmSSZ for now (UTC), for /M and /ModDate.
pub fn pdf_date_now() -> String {
    let secs =
        std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0);
    let days = secs.div_euclid(86_400);
    let rem = secs.rem_euclid(86_400);
    let (y, m, d) = civil_from_days(days);
    format!("D:{y:04}{m:02}{d:02}{:02}{:02}{:02}Z", rem / 3600, rem % 3600 / 60, rem % 60)
}

/// Days since 1970-01-01 to a calendar date (Howard Hinnant's algorithm).
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn colors() {
        assert_eq!(parse_color("#ff0000"), [1.0, 0.0, 0.0]);
        assert_eq!(parse_color("#0f0"), [0.0, 1.0, 0.0]);
        assert_eq!(parse_color("nope"), [0.0; 3]);
        assert_eq!(color_hex([1.0, 0.5, 0.0]), "#ff8000");
        let gray = color_from_array(&[Object::Real(0.5)]).unwrap();
        assert_eq!(gray, [0.5; 3]);
        assert_eq!(color_from_array(&[]), None);
    }

    #[test]
    fn text_strings_round_trip() {
        for s in ["plain", "日本語のコメント", "mixé"] {
            match text_string(s) {
                Object::String(b, _) => assert_eq!(decode_text(&b), s),
                _ => unreachable!(),
            }
        }
    }

    #[test]
    fn dates() {
        assert_eq!(civil_from_days(0), (1970, 1, 1));
        assert_eq!(civil_from_days(20_374), (2025, 10, 13));
        assert!(pdf_date_now().starts_with("D:20"));
    }
}

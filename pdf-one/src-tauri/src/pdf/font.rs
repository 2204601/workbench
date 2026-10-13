//! The font for text the user types (text boxes, form fields).
//!
//! Japanese has to be embedded: a PDF that only names a font shows boxes or
//! garbage wherever that font is missing (pdf.js's own saving does this, so
//! we don't use it). The OS already has a Japanese font (Yu Gothic, Hiragino,
//! Meiryo…), so the app ships none and embeds a subset of that one: only the
//! glyphs used, a few KB to a few tens of KB per file.
//!
//! The font is written as a CID font with Identity-H, the glyph ids of the
//! subset as character codes, and a ToUnicode map so that the text can still
//! be searched and copied.

use super::content::hex;
use lopdf::{dictionary, Document, Object, ObjectId, Stream};
use skrifa::raw::TableProvider;
use skrifa::{prelude::*, string::StringId};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, OnceLock};
use subsetter::GlyphRemapper;

/// A font file read from disk, with the face to use in it.
pub struct FontFile {
    data: Vec<u8>,
    index: u32,
    /// The CSS family name for the same font, so the screen matches the file.
    pub family: String,
    ps_name: String,
    cff: bool,
}

/// Fonts larger than this aren't fonts we want (the biggest CJK collections
/// are around 60 MB).
const MAX_FONT: u64 = 100 * 1024 * 1024;

impl FontFile {
    /// Reads the font at `path`; None if it can't be read, can't be embedded
    /// (its licence says so) or has no Japanese when `needs_japanese`.
    pub fn load(path: &Path, index: u32, family: &str, needs_japanese: bool) -> Option<Self> {
        if std::fs::metadata(path).ok()?.len() > MAX_FONT {
            return None;
        }
        let data = std::fs::read(path).ok()?;
        let index = face_named(&data, family).unwrap_or(index);
        let font = FontRef::from_index(&data, index).ok()?;
        // fsType: 0x0002 = restricted licence (no embedding), 0x0200 = bitmaps only.
        if let Ok(os2) = font.os2() {
            if os2.fs_type() & 0x0202 != 0 {
                log::info!("{}: 埋め込みが許可されていないフォントです", path.display());
                return None;
            }
        }
        if needs_japanese && font.charmap().map('あ').is_none() {
            return None;
        }
        let cff = font.cff().is_ok();
        if !cff && font.glyf().is_err() {
            // CFF2 (variable) and bitmap-only fonts: the subsetter can't do them.
            return None;
        }
        let ps_name = font
            .localized_strings(StringId::POSTSCRIPT_NAME)
            .english_or_first()
            .map(|s| s.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-').collect::<String>())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| "Font".into());
        Some(Self { data, index, family: family.into(), ps_name, cff })
    }

    fn font(&self) -> FontRef<'_> {
        FontRef::from_index(&self.data, self.index).expect("checked in load")
    }
}

/// The face of a collection (.ttc) whose PostScript name is `name`.
fn face_named(data: &[u8], name: &str) -> Option<u32> {
    let skrifa::raw::FileRef::Collection(c) = skrifa::raw::FileRef::new(data).ok()? else { return None };
    (0..c.len()).find(|&i| {
        FontRef::from_index(data, i).ok().is_some_and(|f| {
            f.localized_strings(StringId::POSTSCRIPT_NAME).english_or_first().is_some_and(|s| s.to_string() == name)
        })
    })
}

/// Where the OS keeps a Japanese font, best first, with the CSS family name
/// that picks the same face in the WebView.
fn candidates() -> Vec<(PathBuf, u32, &'static str)> {
    let mut v = Vec::new();
    if cfg!(windows) {
        let dir = std::env::var_os("WINDIR").map(PathBuf::from).unwrap_or_else(|| PathBuf::from(r"C:\Windows"));
        let fonts = dir.join("Fonts");
        v.push((fonts.join("YuGothR.ttc"), 0, "Yu Gothic"));
        v.push((fonts.join("meiryo.ttc"), 0, "Meiryo"));
        v.push((fonts.join("BIZ-UDGothicR.ttc"), 0, "BIZ UDGothic"));
        v.push((fonts.join("msgothic.ttc"), 0, "MS Gothic"));
    } else if cfg!(target_os = "macos") {
        // By its PostScript name, which picks the face in the collection and
        // which WebKit takes too: "Hiragino Sans" at the normal weight could
        // be W4, a little wider than the W3 embedded.
        v.push(("/System/Library/Fonts/ヒラギノ角ゴシック W3.ttc".into(), 0, "HiraginoSans-W3"));
        v.push(("/System/Library/Fonts/Hiragino Sans GB.ttc".into(), 0, "Hiragino Sans GB"));
        v.push(("/Library/Fonts/Osaka.ttf".into(), 0, "Osaka"));
    } else {
        v.push(("/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc".into(), 0, "Noto Sans CJK JP"));
        v.push(("/usr/share/fonts/opentype/ipafont-gothic/ipag.ttf".into(), 0, "IPAGothic"));
        v.push(("/usr/share/fonts/truetype/fonts-japanese-gothic.ttf".into(), 0, "IPAGothic"));
    }
    v
}

/// The OS's Japanese font, looked for once. None: text is written with
/// Helvetica (not embedded), which can't show Japanese.
pub fn system_font() -> Option<Arc<FontFile>> {
    static FONT: OnceLock<Option<Arc<FontFile>>> = OnceLock::new();
    FONT.get_or_init(|| {
        let found = candidates().into_iter().find_map(|(p, i, family)| FontFile::load(&p, i, family, true));
        match &found {
            Some(f) => log::info!("文字のフォント: {} ({})", f.ps_name, f.family),
            None => log::warn!("日本語のフォントが見つかりません。書き込む文字は Helvetica になります"),
        }
        found.map(Arc::new)
    })
    .clone()
}

/// Collects the text written in one file and embeds the font for it once,
/// at the end (`finish`), with exactly the glyphs used.
pub struct Embedder {
    font: Option<Arc<FontFile>>,
    remapper: GlyphRemapper,
    /// New glyph id → the text it stands for (ToUnicode) and its advance.
    glyphs: BTreeMap<u16, (String, f64)>,
    /// The font dictionary's id, taken when it is first used.
    id: Option<ObjectId>,
}

/// The name appearance streams use for the font in their /Resources.
pub const RESOURCE_NAME: &str = "PDFE";

impl Embedder {
    pub fn new(font: Option<Arc<FontFile>>) -> Self {
        Self { font, remapper: GlyphRemapper::new(), glyphs: BTreeMap::new(), id: None }
    }

    /// The font dictionary to put in a /Resources /Font.
    pub fn font_ref(&mut self, doc: &mut Document) -> ObjectId {
        *self.id.get_or_insert_with(|| doc.new_object_id())
    }

    /// Ascent and descent (negative) per point of font size.
    pub fn vertical(&self) -> (f64, f64) {
        match &self.font {
            Some(f) => {
                let m = f.font().metrics(Size::unscaled(), LocationRef::default());
                let em = m.units_per_em.max(1) as f64;
                let (a, d) = (m.ascent as f64 / em, m.descent as f64 / em);
                // Some fonts leave these empty.
                if a > 0.3 {
                    (a, if d < 0.0 { d } else { -0.12 })
                } else {
                    (0.88, -0.12)
                }
            }
            None => (0.718, -0.207),
        }
    }

    /// Width of `text` in points at `size`.
    pub fn width(&self, text: &str, size: f64) -> f64 {
        match &self.font {
            Some(f) => {
                let font = f.font();
                let em = font.head().map(|h| h.units_per_em()).unwrap_or(1000).max(1) as f64;
                let cmap = font.charmap();
                let metrics = font.glyph_metrics(Size::unscaled(), LocationRef::default());
                text.chars()
                    .map(|c| {
                        let gid = cmap.map(c).unwrap_or(GlyphId::NOTDEF);
                        metrics.advance_width(gid).unwrap_or(0.0) as f64 / em
                    })
                    .sum::<f64>()
                    * size
            }
            None => text.chars().map(helvetica_width).sum::<f64>() * size,
        }
    }

    /// The string operand for `Tj` that shows `text` in this font.
    pub fn encode(&mut self, text: &str) -> String {
        let Some(f) = self.font.clone() else {
            // WinAnsi covers Latin-1 well enough; anything else can't be shown.
            let bytes: Vec<u8> = text.chars().map(|c| if (c as u32) < 256 { c as u8 } else { b'?' }).collect();
            return hex(&bytes);
        };
        let font = f.font();
        let em = font.head().map(|h| h.units_per_em()).unwrap_or(1000).max(1) as f64;
        let cmap = font.charmap();
        let metrics = font.glyph_metrics(Size::unscaled(), LocationRef::default());
        let mut bytes = Vec::with_capacity(text.len() * 2);
        for c in text.chars() {
            let old = cmap.map(c).map(|g| g.to_u32()).unwrap_or(0);
            // Fonts with more than 65535 glyphs don't exist in practice.
            let old = u16::try_from(old).unwrap_or(0);
            let new = self.remapper.remap(old);
            let width = metrics.advance_width(GlyphId::new(old as u32)).unwrap_or(0.0) as f64 / em * 1000.0;
            let entry = self.glyphs.entry(new).or_insert_with(|| (String::new(), width));
            if old != 0 && entry.0.is_empty() {
                entry.0.push(c);
            }
            bytes.extend_from_slice(&new.to_be_bytes());
        }
        hex(&bytes)
    }

    /// Writes the font objects, if anything used the font.
    pub fn finish(self, doc: &mut Document) -> Result<(), String> {
        let Some(id) = self.id else { return Ok(()) };
        let Some(f) = self.font else {
            doc.objects.insert(
                id,
                Object::Dictionary(dictionary! {
                    "Type" => "Font",
                    "Subtype" => "Type1",
                    "BaseFont" => "Helvetica",
                    "Encoding" => "WinAnsiEncoding",
                }),
            );
            return Ok(());
        };
        let font = f.font();
        let data = subsetter::subset(&f.data, f.index, &self.remapper)
            .map_err(|e| format!("フォントを埋め込めませんでした（{}）: {e}", f.ps_name))?;
        let m = font.metrics(Size::unscaled(), LocationRef::default());
        let em = m.units_per_em.max(1) as f64;
        let scale = |v: f32| (v as f64 / em * 1000.0).round() as i64;
        let bbox = m
            .bounds
            .map(|b| [scale(b.x_min), scale(b.y_min), scale(b.x_max), scale(b.y_max)])
            .unwrap_or([0, -200, 1000, 900]);
        // A subset is named with a tag of six capitals (ISO 32000 9.6.4),
        // here from the glyphs in it so the same subset gets the same name.
        let tag: String = {
            let mut h: u32 = 2_166_136_261;
            for g in self.glyphs.keys() {
                h = (h ^ *g as u32).wrapping_mul(16_777_619);
            }
            (0..6).map(|i| (b'A' + ((h >> (i * 5)) % 26) as u8) as char).collect()
        };
        let base_font = format!("{tag}+{}", f.ps_name);

        let file_id = if f.cff {
            doc.add_object(Stream::new(dictionary! { "Subtype" => "OpenType" }, data))
        } else {
            let len = data.len() as i64;
            doc.add_object(Stream::new(dictionary! { "Length1" => len }, data))
        };
        let descriptor = doc.add_object(dictionary! {
            "Type" => "FontDescriptor",
            "FontName" => Object::Name(base_font.clone().into_bytes()),
            // Symbolic: the glyphs are reached through our own encoding.
            "Flags" => 4,
            "FontBBox" => Object::Array(bbox.iter().map(|&v| Object::Integer(v)).collect()),
            "ItalicAngle" => m.italic_angle as f64 as f32,
            "Ascent" => scale(m.ascent),
            "Descent" => scale(m.descent),
            "CapHeight" => m.cap_height.map(scale).unwrap_or(scale(m.ascent)),
            "StemV" => 80,
            if f.cff { "FontFile3" } else { "FontFile2" } => file_id,
        });
        // /W: runs of consecutive glyph ids with their widths.
        let mut w = Vec::new();
        let mut run: Vec<Object> = Vec::new();
        let mut start = None;
        let mut prev = 0u16;
        for (&gid, (_, width)) in &self.glyphs {
            if start.is_some() && gid != prev + 1 {
                w.push(Object::Integer(start.unwrap() as i64));
                w.push(Object::Array(std::mem::take(&mut run)));
                start = None;
            }
            start.get_or_insert(gid);
            run.push(Object::Integer(width.round() as i64));
            prev = gid;
        }
        if let Some(s) = start {
            w.push(Object::Integer(s as i64));
            w.push(Object::Array(run));
        }
        let mut cid = dictionary! {
            "Type" => "Font",
            "Subtype" => if f.cff { "CIDFontType0" } else { "CIDFontType2" },
            "BaseFont" => Object::Name(base_font.clone().into_bytes()),
            "CIDSystemInfo" => dictionary! {
                "Registry" => Object::string_literal("Adobe"),
                "Ordering" => Object::string_literal("Identity"),
                "Supplement" => 0,
            },
            "FontDescriptor" => descriptor,
            "DW" => 1000,
            "W" => w,
        };
        if !f.cff {
            cid.set("CIDToGIDMap", "Identity");
        }
        let cid = doc.add_object(cid);
        let to_unicode = doc.add_object(Stream::new(dictionary! {}, to_unicode(&self.glyphs).into_bytes()));
        doc.objects.insert(
            id,
            Object::Dictionary(dictionary! {
                "Type" => "Font",
                "Subtype" => "Type0",
                "BaseFont" => Object::Name(base_font.into_bytes()),
                "Encoding" => "Identity-H",
                "DescendantFonts" => vec![Object::Reference(cid)],
                "ToUnicode" => to_unicode,
            }),
        );
        Ok(())
    }
}

/// A ToUnicode CMap: each glyph id of the subset to the text it shows.
fn to_unicode(glyphs: &BTreeMap<u16, (String, f64)>) -> String {
    let mut s = String::from(
        "/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n\
         /CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n\
         /CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n\
         1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n",
    );
    let entries: Vec<_> = glyphs.iter().filter(|(_, (t, _))| !t.is_empty()).collect();
    for chunk in entries.chunks(100) {
        s.push_str(&format!("{} beginbfchar\n", chunk.len()));
        for (gid, (text, _)) in chunk {
            let utf16: Vec<u8> = text.encode_utf16().flat_map(|u| u.to_be_bytes()).collect();
            s.push_str(&format!("{} {}\n", hex(&gid.to_be_bytes()), hex(&utf16)));
        }
        s.push_str("endbfchar\n");
    }
    s.push_str("endcmap\nCMapName currentdict /CMap defineresource pop\nend\nend\n");
    s
}

/// Helvetica's widths, roughly: only used when there is no system font.
fn helvetica_width(c: char) -> f64 {
    match c {
        'i' | 'j' | 'l' | '\'' | '.' | ',' | ':' | ';' | '!' | '|' => 0.222,
        ' ' | 'f' | 't' | 'I' | '/' | '(' | ')' | '[' | ']' => 0.278,
        'r' | '-' => 0.333,
        'm' | 'M' => 0.833,
        'w' | 'W' => 0.75,
        'A'..='Z' => 0.667,
        _ => 0.556,
    }
}

#[cfg(test)]
pub(crate) fn test_font() -> Arc<FontFile> {
    let p = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/LiberationSans-Regular.ttf");
    Arc::new(FontFile::load(&p, 0, "Liberation Sans", false).expect("fixture font"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn embeds_a_subset_with_to_unicode() {
        let mut doc = Document::with_version("1.7");
        let mut e = Embedder::new(Some(test_font()));
        let id = e.font_ref(&mut doc);
        let a = e.encode("Hello");
        let b = e.encode("help");
        // .notdef is 0, then H e l o h p in order of first use.
        assert_eq!(a, "<00010002000300030004>");
        assert_eq!(b, "<0005000200030006>");
        assert!(e.width("Hello", 10.0) > 20.0);
        e.finish(&mut doc).unwrap();
        let font = doc.get_dictionary(id).unwrap();
        assert_eq!(font.get(b"Subtype").unwrap().as_name().unwrap(), b"Type0");
        let base = font.get(b"BaseFont").unwrap().as_name().unwrap();
        assert!(base.ends_with(b"+LiberationSans"), "{}", String::from_utf8_lossy(base));
        // The ToUnicode map has the letters.
        let tu = doc.get_object(font.get(b"ToUnicode").unwrap().as_reference().unwrap()).unwrap();
        let text = String::from_utf8(tu.as_stream().unwrap().content.clone()).unwrap();
        assert!(text.contains("<0001> <0048>"), "{text}");
    }

    #[test]
    fn unused_font_writes_nothing() {
        let mut doc = Document::with_version("1.7");
        let before = doc.objects.len();
        Embedder::new(Some(test_font())).finish(&mut doc).unwrap();
        assert_eq!(doc.objects.len(), before);
    }

    #[test]
    fn without_a_system_font_text_is_helvetica() {
        let mut doc = Document::with_version("1.7");
        let mut e = Embedder::new(None);
        let id = e.font_ref(&mut doc);
        assert_eq!(e.encode("Aあ"), "<413F>");
        e.finish(&mut doc).unwrap();
        assert_eq!(doc.get_dictionary(id).unwrap().get(b"BaseFont").unwrap().as_name().unwrap(), b"Helvetica");
    }
}

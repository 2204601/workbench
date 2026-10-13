//! Opening a file: checks that it is a PDF this app can edit, and takes the
//! annotations it can edit out of the pages. Those come back to the frontend
//! as `Annot`s (it draws and edits them), and pdf.js is given the document
//! without them, so nothing is drawn twice. Saving writes them back
//! (compose.rs).
//!
//! What is left alone, drawn by pdf.js and saved as it was: links, form
//! fields, pop-ups of annotations that stay, comment threads (replies), and
//! annotations with things the editor can't show (dashed or cloudy borders,
//! callouts, other apps' stamps, hidden ones).

use super::image::{from_xobject, ImageStore};
use super::{
    annots::{Style, STYLE_KEY},
    color_from_array, color_hex, get_dict, get_name, get_resolved, get_text, number, numbers, rect_of, ref_id, Annot,
    AnnotKind, OWN_PREFIX,
};
use lopdf::{Dictionary, Document, LoadOptions, Object, ObjectId};
use serde::Serialize;
use std::collections::HashSet;

/// An annotation taken out of page `page` (0-based).
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PageAnnot {
    pub page: usize,
    pub annot: Annot,
}

pub struct Opened {
    /// The document as saving starts from it; None when it can only be viewed.
    pub doc: Option<Document>,
    /// What pdf.js shows.
    pub view_bytes: Vec<u8>,
    pub annots: Vec<PageAnnot>,
    /// Why it can only be viewed.
    pub read_only: Option<String>,
    /// It has a digital signature, which saving will break.
    pub signed: bool,
}

/// No single stream may inflate past this while loading (Platform
/// Security §4: a few KB can claim to be gigabytes).
const MAX_STREAM: usize = 512 * 1024 * 1024;

pub fn is_pdf(bytes: &[u8]) -> bool {
    // The header may come after some junk, within the first 1 KB.
    bytes[..bytes.len().min(1024)].windows(5).any(|w| w == b"%PDF-")
}

pub fn open_bytes(bytes: Vec<u8>, images: &mut ImageStore) -> Result<Opened, String> {
    if !is_pdf(&bytes) {
        return Err("PDF ファイルではありません".into());
    }
    let options = LoadOptions { max_decompressed_size: Some(MAX_STREAM), ..Default::default() };
    let view_only = |bytes: Vec<u8>, why: &str| Opened {
        doc: None,
        view_bytes: bytes,
        annots: Vec::new(),
        read_only: Some(why.into()),
        signed: false,
    };
    let mut doc = match Document::load_mem_with_options(&bytes, options) {
        Ok(d) => d,
        Err(e) => {
            log::warn!("lopdf で読めません（表示だけにします）: {e}");
            return Ok(view_only(bytes, "この PDF は編集用に読み込めませんでした。表示だけできます"));
        }
    };
    if doc.trailer.get(b"Encrypt").is_ok() || doc.is_encrypted() || doc.was_encrypted() {
        return Ok(view_only(bytes, "パスワードや権限で保護された PDF は、表示だけできます"));
    }
    // A dynamic XFA form: its pages are made by Acrobat from the XFA data,
    // the PDF pages only say "please wait".
    let xfa_only = doc.catalog().is_ok_and(|c| matches!(c.get(b"NeedsRendering"), Ok(Object::Boolean(true))));
    if xfa_only {
        return Ok(view_only(bytes, "XFA フォームの PDF は、表示だけできます（Acrobat で開いてください）"));
    }
    if doc.get_pages().is_empty() {
        return Ok(view_only(bytes, "ページが見つからない PDF です。表示だけできます"));
    }
    let signed = has_signature(&doc);
    let annots = take_annotations(&mut doc, images);
    let view_bytes = if annots.is_empty() {
        bytes
    } else {
        let mut out = Vec::with_capacity(bytes.len());
        doc.save_to(&mut out).map_err(|e| format!("PDF を読み込めませんでした: {e}"))?;
        out
    };
    Ok(Opened { doc: Some(doc), view_bytes, annots, read_only: None, signed })
}

fn has_signature(doc: &Document) -> bool {
    let Ok(catalog) = doc.catalog() else { return false };
    let Some(form) = get_dict(doc, catalog, b"AcroForm") else { return false };
    let Some(Object::Array(fields)) = get_resolved(doc, form, b"Fields") else { return false };
    fields.iter().filter_map(ref_id).any(|id| {
        doc.get_dictionary(id).map(|f| get_name(f, b"FT") == Some(b"Sig") && f.get(b"V").is_ok()).unwrap_or(false)
    })
}

/// The page's /Annots as references (inline dictionaries can't be
/// referred to, so they always stay).
fn annot_refs(doc: &Document, page: &Dictionary) -> Vec<Object> {
    match get_resolved(doc, page, b"Annots") {
        Some(Object::Array(a)) => a.clone(),
        _ => Vec::new(),
    }
}

fn take_annotations(doc: &mut Document, images: &mut ImageStore) -> Vec<PageAnnot> {
    let pages: Vec<ObjectId> = doc.get_pages().into_values().collect();
    // Comment threads: replies point at what they answer (/IRT). Both stay
    // as they are, since the editor has no threads.
    let mut threaded = HashSet::new();
    for &p in &pages {
        let Ok(page) = doc.get_dictionary(p) else { continue };
        for r in annot_refs(doc, page) {
            let Some(id) = ref_id(&r) else { continue };
            if let Ok(a) = doc.get_dictionary(id) {
                if let Some(target) = a.get(b"IRT").ok().and_then(ref_id) {
                    threaded.insert(id);
                    threaded.insert(target);
                }
            }
        }
    }
    let mut out = Vec::new();
    for (index, &p) in pages.iter().enumerate() {
        let Ok(page) = doc.get_dictionary(p) else { continue };
        let refs = annot_refs(doc, page);
        if refs.is_empty() {
            continue;
        }
        let mut drop = HashSet::new();
        for r in &refs {
            let Some(id) = ref_id(r) else { continue };
            if threaded.contains(&id) {
                continue;
            }
            let Ok(dict) = doc.get_dictionary(id) else { continue };
            if let Some(annot) = convert(doc, id, dict, images) {
                drop.insert(id);
                if let Some(popup) = dict.get(b"Popup").ok().and_then(ref_id) {
                    drop.insert(popup);
                }
                out.push(PageAnnot { page: index, annot });
            }
        }
        if drop.is_empty() {
            continue;
        }
        let kept: Vec<Object> = refs.into_iter().filter(|r| !ref_id(r).is_some_and(|id| drop.contains(&id))).collect();
        if let Ok(page) = doc.get_dictionary_mut(p) {
            // Written on the page itself: a shared /Annots array would
            // change other pages too.
            page.set("Annots", Object::Array(kept));
        }
    }
    out
}

fn width_of(doc: &Document, d: &Dictionary, default: f64) -> f64 {
    if let Some(bs) = get_dict(doc, d, b"BS") {
        return bs.get(b"W").ok().and_then(number).unwrap_or(1.0);
    }
    let border = d.get(b"Border").map(numbers).unwrap_or_default();
    border.get(2).copied().unwrap_or(default)
}

/// Dashed and cloudy borders: the editor would draw them solid.
fn fancy_border(doc: &Document, d: &Dictionary) -> bool {
    let dashed = get_dict(doc, d, b"BS").is_some_and(|bs| get_name(bs, b"S").is_some_and(|s| s != b"S"));
    let cloudy = get_dict(doc, d, b"BE").is_some_and(|be| get_name(be, b"S") == Some(b"C"));
    dashed || cloudy || d.get(b"Border").map(numbers).is_ok_and(|b| b.len() > 3)
}

/// The inner rectangle of Square, Circle and FreeText (/RD insets it).
fn inner_rect(d: &Dictionary) -> Option<[f64; 4]> {
    let r = rect_of(d.get(b"Rect").ok()?)?;
    let rd = d.get(b"RD").map(numbers).unwrap_or_default();
    if rd.len() == 4 && rd[0] + rd[2] < r[2] - r[0] && rd[1] + rd[3] < r[3] - r[1] {
        Some([r[0] + rd[0], r[1] + rd[1], r[2] - rd[2], r[3] - rd[3]])
    } else {
        Some(r)
    }
}

/// Size and color of a text box from its /DA ("/Helv 12 Tf 1 0 0 rg").
fn parse_da(da: &str) -> (Option<f64>, Option<[f64; 3]>) {
    let tokens: Vec<&str> = da.split_whitespace().collect();
    let mut size = None;
    let mut color = None;
    for (i, t) in tokens.iter().enumerate() {
        let n = |k: usize| tokens.get(i.wrapping_sub(k)).and_then(|s| s.parse::<f64>().ok());
        match *t {
            "Tf" => size = n(1).filter(|s| *s > 0.0),
            "rg" => color = (|| Some([n(3)?, n(2)?, n(1)?]))(),
            "g" => color = n(1).map(|g| [g; 3]),
            _ => {}
        }
    }
    (size, color)
}

fn convert(doc: &Document, id: ObjectId, d: &Dictionary, images: &mut ImageStore) -> Option<Annot> {
    let flags = d.get(b"F").ok().and_then(number).unwrap_or(0.0) as i64;
    if flags & 2 != 0 {
        // Hidden.
        return None;
    }
    let subtype = get_name(d, b"Subtype")?;
    let mut a = Annot {
        id: Some(get_text(d, b"NM")).filter(|s| !s.is_empty()).unwrap_or_else(|| format!("imp-{}-{}", id.0, id.1)),
        opacity: d.get(b"CA").ok().and_then(number).unwrap_or(1.0).clamp(0.0, 1.0),
        contents: get_text(d, b"Contents"),
        author: get_text(d, b"T"),
        modified: get_text(d, b"M"),
        ..Default::default()
    };
    let color = match get_resolved(doc, d, b"C") {
        Some(Object::Array(c)) => color_from_array(c),
        _ => None,
    };
    a.color = color_hex(color.unwrap_or([0.0; 3]));
    let style: Style = match d.get(STYLE_KEY) {
        Ok(Object::String(s, _)) => serde_json::from_slice(s).unwrap_or_default(),
        _ => Style::default(),
    };
    if fancy_border(doc, d) {
        return None;
    }
    match subtype {
        b"Highlight" | b"Underline" | b"StrikeOut" => {
            let q = d.get(b"QuadPoints").map(numbers).ok()?;
            if q.is_empty() || q.len() % 8 != 0 {
                return None;
            }
            a.kind = match subtype {
                b"Highlight" => AnnotKind::Highlight,
                b"Underline" => AnnotKind::Underline,
                _ => AnnotKind::Strikeout,
            };
            a.quads = q.as_chunks::<8>().0.to_vec();
            if color.is_none() {
                a.color = "#ffd400".into();
            }
        }
        b"Ink" => {
            let Ok(Object::Array(list)) = d.get(b"InkList") else { return None };
            a.kind = AnnotKind::Ink;
            a.paths = list.iter().map(|p| numbers(super::resolve(doc, p))).filter(|p| p.len() >= 2).collect();
            if a.paths.is_empty() {
                return None;
            }
            a.width = width_of(doc, d, 1.0);
        }
        b"Square" | b"Circle" => {
            a.kind = if subtype == b"Square" { AnnotKind::Rect } else { AnnotKind::Ellipse };
            a.rect = inner_rect(d);
            a.width = width_of(doc, d, 1.0);
            a.fill = match get_resolved(doc, d, b"IC") {
                Some(Object::Array(c)) => color_from_array(c).map(color_hex),
                _ => None,
            };
        }
        b"Line" => {
            if d.get(b"LL").is_ok() || d.get(b"Cap").ok().is_some_and(|c| matches!(c, Object::Boolean(true))) {
                // Dimension lines with leaders or captions.
                return None;
            }
            let l = d.get(b"L").map(numbers).ok()?;
            if l.len() != 4 {
                return None;
            }
            let ends: Vec<&[u8]> = match d.get(b"LE") {
                Ok(Object::Array(e)) => e.iter().map(|n| n.as_name().unwrap_or(b"None")).collect(),
                _ => vec![b"None", b"None"],
            };
            let arrow = |n: &[u8]| matches!(n, b"OpenArrow" | b"ClosedArrow");
            let (start, end) = (ends.first().copied().unwrap_or(b"None"), ends.get(1).copied().unwrap_or(b"None"));
            a.width = width_of(doc, d, 1.0);
            match (arrow(start), arrow(end), start == b"None" || arrow(start), end == b"None" || arrow(end)) {
                (false, false, true, true) => {
                    a.kind = AnnotKind::Line;
                    a.line = Some([l[0], l[1], l[2], l[3]]);
                }
                (false, true, true, _) => {
                    a.kind = AnnotKind::Arrow;
                    a.line = Some([l[0], l[1], l[2], l[3]]);
                }
                (true, false, _, true) => {
                    a.kind = AnnotKind::Arrow;
                    a.line = Some([l[2], l[3], l[0], l[1]]);
                }
                _ => return None,
            }
        }
        b"FreeText" => {
            if d.get(b"CL").is_ok() || get_name(d, b"IT") == Some(b"FreeTextCallout") {
                return None;
            }
            a.kind = AnnotKind::Text;
            a.rect = inner_rect(d);
            a.text = std::mem::take(&mut a.contents).replace("\r\n", "\n").replace('\r', "\n");
            let (size, text_color) = parse_da(&get_text(d, b"DA"));
            a.font_size = style.font_size.or(size).unwrap_or(12.0);
            if let Some(c) = text_color {
                a.color = color_hex(c);
            }
            a.fill = style.fill.clone();
            a.width = style.width.unwrap_or_else(|| {
                if d.get(b"BS").is_ok() || d.get(b"Border").is_ok() {
                    width_of(doc, d, 0.0)
                } else {
                    0.0
                }
            });
            a.rotation = d.get(b"Rotate").ok().and_then(number).map(|r| (r as i64).rem_euclid(360) as u16).unwrap_or(0);
        }
        b"Text" => {
            a.kind = AnnotKind::Note;
            let r = rect_of(d.get(b"Rect").ok()?)?;
            // The icon's size on screen: what the file says, if sensible.
            let (w, h) = ((r[2] - r[0]).clamp(12.0, 40.0), (r[3] - r[1]).clamp(12.0, 40.0));
            a.rect = Some([r[0], r[3] - h, r[0] + w, r[3]]);
            if color.is_none() {
                a.color = "#ffd400".into();
            }
        }
        b"Stamp" => {
            // Only our own pictures and seals: we know how their appearance is made.
            if !a.id.starts_with(OWN_PREFIX) {
                return None;
            }
            if let Some(shape) = &style.seal {
                a.kind = AnnotKind::Seal;
                a.rect = rect_of(d.get(b"Rect").ok()?);
                a.rotation = style.rotation % 360;
                a.text = std::mem::take(&mut a.contents).replace("\r\n", "\n").replace('\r', "\n");
                a.font_size = style.font_size.unwrap_or(9.0);
                a.width = style.width.unwrap_or(1.5);
                a.seal = Some(shape.clone());
                if let Some(r) = a.rect {
                    if !(r[2] > r[0] && r[3] > r[1]) {
                        return None;
                    }
                }
                return Some(a);
            }
            let ap = get_dict(doc, d, b"AP")?;
            let n = ref_id(ap.get(b"N").ok()?)?;
            let form = doc.get_object(n).ok()?.as_stream().ok()?;
            let res = get_dict(doc, &form.dict, b"Resources")?;
            let xobjects = get_dict(doc, res, b"XObject")?;
            let img = from_xobject(doc, ref_id(xobjects.get(b"Im0").ok()?)?)?;
            a.kind = AnnotKind::Image;
            a.rect = rect_of(d.get(b"Rect").ok()?);
            a.rotation = style.rotation % 360;
            a.image = Some(images.add(img));
        }
        _ => return None,
    }
    if let Some(r) = a.rect {
        if !(r[2] > r[0] && r[3] > r[1]) {
            return None;
        }
    }
    Some(a)
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use lopdf::{dictionary, Stream};

    /// A one-page document, with `annots` on the page.
    pub fn sample(annots: Vec<Dictionary>) -> Vec<u8> {
        let mut doc = Document::with_version("1.7");
        let pages_id = doc.new_object_id();
        let content = doc.add_object(Stream::new(dictionary! {}, b"0 0 1 rg 10 10 100 100 re f".to_vec()));
        let page_id = doc.new_object_id();
        let refs: Vec<Object> = annots
            .into_iter()
            .map(|mut a| {
                a.set("P", page_id);
                Object::Reference(doc.add_object(a))
            })
            .collect();
        doc.objects.insert(
            page_id,
            Object::Dictionary(dictionary! {
                "Type" => "Page",
                "Parent" => pages_id,
                "MediaBox" => vec![0.into(), 0.into(), 595.into(), 842.into()],
                "Contents" => content,
                "Annots" => refs,
            }),
        );
        doc.objects.insert(
            pages_id,
            Object::Dictionary(dictionary! { "Type" => "Pages", "Kids" => vec![page_id.into()], "Count" => 1 }),
        );
        let catalog = doc.add_object(dictionary! { "Type" => "Catalog", "Pages" => pages_id });
        doc.trailer.set("Root", catalog);
        let mut out = Vec::new();
        doc.save_to(&mut out).unwrap();
        out
    }

    #[test]
    fn takes_out_what_it_can_edit() {
        let bytes = sample(vec![
            dictionary! {
                "Type" => "Annot", "Subtype" => "Highlight", "Rect" => vec![0.into(), 0.into(), 10.into(), 10.into()],
                "QuadPoints" => vec![0.into(), 10.into(), 10.into(), 10.into(), 0.into(), 0.into(), 10.into(), 0.into()],
                "C" => vec![1.into(), 1.into(), 0.into()], "Contents" => Object::string_literal("note"),
            },
            dictionary! {
                "Type" => "Annot", "Subtype" => "Link", "Rect" => vec![0.into(), 0.into(), 10.into(), 10.into()],
            },
            dictionary! {
                "Type" => "Annot", "Subtype" => "Square", "Rect" => vec![0.into(), 0.into(), 50.into(), 50.into()],
                "BS" => dictionary! { "W" => 2, "S" => "D" },
            },
            dictionary! {
                "Type" => "Annot", "Subtype" => "FreeText", "Rect" => vec![100.into(), 100.into(), 200.into(), 130.into()],
                "Contents" => Object::string_literal("abc"), "DA" => Object::string_literal("/Helv 14 Tf 0 0 1 rg"),
            },
        ]);
        let mut images = ImageStore::default();
        let o = open_bytes(bytes, &mut images).unwrap();
        assert!(o.read_only.is_none());
        let kinds: Vec<AnnotKind> = o.annots.iter().map(|p| p.annot.kind).collect();
        assert_eq!(kinds, [AnnotKind::Highlight, AnnotKind::Text]);
        let h = &o.annots[0].annot;
        assert_eq!((h.color.as_str(), h.contents.as_str()), ("#ffff00", "note"));
        let t = &o.annots[1].annot;
        assert_eq!((t.text.as_str(), t.font_size, t.color.as_str()), ("abc", 14.0, "#0000ff"));
        // The link and the dashed square stay on the page that pdf.js sees.
        let view = Document::load_mem(&o.view_bytes).unwrap();
        let page = *view.get_pages().get(&1).unwrap();
        let left = view.get_page_annotations(page).unwrap();
        let subtypes: Vec<&[u8]> = left.iter().map(|a| a.get(b"Subtype").unwrap().as_name().unwrap()).collect();
        assert_eq!(subtypes, [b"Link".as_slice(), b"Square"]);
    }

    #[test]
    fn nothing_to_take_keeps_the_file_as_it_is() {
        let bytes = sample(vec![]);
        let o = open_bytes(bytes.clone(), &mut ImageStore::default()).unwrap();
        assert_eq!(o.view_bytes, bytes);
    }

    #[test]
    fn not_a_pdf() {
        assert!(open_bytes(b"hello".to_vec(), &mut ImageStore::default()).is_err());
        let o = open_bytes(b"%PDF-1.7 broken".to_vec(), &mut ImageStore::default()).unwrap();
        assert!(o.read_only.is_some());
    }

    #[test]
    fn da_strings() {
        assert_eq!(parse_da("/Helv 12 Tf 1 0 0 rg"), (Some(12.0), Some([1.0, 0.0, 0.0])));
        assert_eq!(parse_da("0.5 g /F1 0 Tf"), (None, Some([0.5; 3])));
    }
}

//! Writing a file: the pages asked for, in that order, from one or more
//! opened documents (or new blank pages), with their annotations and the
//! form values typed in.
//!
//! The first page's document is the base: its catalog (outline, metadata,
//! form, language…) is kept. Other documents' objects are renumbered past
//! the base's and copied in; only their pages (and what those use) survive
//! the clean-up at the end. References to pages that were left out (outline
//! entries, links) are cut, so those pages don't stay in the file unseen.

use super::annots::Writer;
use super::font::{Embedder, FontFile};
use super::forms::{self, parse_ref, FieldValue};
use super::image::ImageStore;
use super::{get_dict, get_name, get_resolved, number, ref_id, text_string, Annot};
use lopdf::{dictionary, Dictionary, Document, Object, ObjectId, SaveOptions};
use serde::Deserialize;
use std::collections::{BTreeMap, HashMap, HashSet};
use std::sync::Arc;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PageSpec {
    /// The opened document the page comes from; None for a blank page.
    pub source: Option<u32>,
    /// The page's index in that document.
    #[serde(default)]
    pub index: usize,
    /// Added to the page's own rotation (multiples of 90).
    #[serde(default)]
    pub rotate: i32,
    /// A blank page's width and height in points.
    #[serde(default)]
    pub size: Option<[f64; 2]>,
    #[serde(default)]
    pub annots: Vec<Annot>,
}

/// A form value typed into document `source`, on widget `id` (pdf.js's id).
#[derive(Debug, Clone, Deserialize)]
pub struct FormEntry {
    pub source: u32,
    pub id: String,
    pub value: FieldValue,
}

/// Page attributes that pages inherit from the page tree (ISO 32000 7.7.3.4).
const INHERITED: [&[u8]; 4] = [b"Resources", b"MediaBox", b"CropBox", b"Rotate"];

pub struct Input<'a> {
    pub sources: &'a HashMap<u32, Arc<Document>>,
    pub pages: &'a [PageSpec],
    pub forms: &'a [FormEntry],
    pub font: Option<Arc<FontFile>>,
    pub images: &'a ImageStore,
}

pub fn compose(input: Input) -> Result<Vec<u8>, String> {
    let mut doc = build(&input)?;
    let mut out = Vec::new();
    let options = SaveOptions::builder().use_object_streams(true).use_xref_streams(true).build();
    doc.save_with_options(&mut out, options).map_err(|e| format!("PDF を書き出せませんでした: {e}"))?;
    Ok(out)
}

fn source<'a>(input: &'a Input, id: u32) -> Result<&'a Arc<Document>, String> {
    input.sources.get(&id).ok_or_else(|| "元の PDF が閉じられています。開き直してください".to_string())
}

pub fn build(input: &Input) -> Result<Document, String> {
    if input.pages.is_empty() {
        return Err("ページがありません".into());
    }
    // The documents in the order they are first used; the first is the base.
    let mut order: Vec<u32> = Vec::new();
    for p in input.pages {
        if let Some(s) = p.source {
            if !order.contains(&s) {
                order.push(s);
            }
        }
    }
    let mut offsets: HashMap<u32, u32> = HashMap::new();
    let mut page_ids: HashMap<u32, Vec<ObjectId>> = HashMap::new();
    let mut other_catalogs: Vec<ObjectId> = Vec::new();
    let mut doc = match order.first() {
        Some(&base) => {
            let d = (**source(input, base)?).clone();
            offsets.insert(base, 0);
            page_ids.insert(base, d.get_pages().into_values().collect());
            d
        }
        None => new_document(),
    };
    for &s in order.iter().skip(1) {
        let mut d = (**source(input, s)?).clone();
        let offset = max_id(&doc);
        shift(&mut d, offset);
        offsets.insert(s, offset);
        page_ids.insert(s, d.get_pages().into_values().collect());
        if let Some(root) = d.trailer.get(b"Root").ok().and_then(ref_id) {
            other_catalogs.push(root);
        }
        doc.objects.extend(d.objects);
    }
    doc.max_id = max_id(&doc);
    let all_pages: HashSet<ObjectId> = page_ids.values().flatten().copied().collect();

    let mut font = Embedder::new(input.font.clone());

    // Form values, on the widgets as renumbered.
    let values: Vec<(ObjectId, FieldValue)> = input
        .forms
        .iter()
        .filter_map(|f| {
            let off = *offsets.get(&f.source)?;
            let (n, g) = parse_ref(&f.id)?;
            Some(((n + off, g), f.value.clone()))
        })
        .collect();
    forms::apply(&mut doc, &mut font, &values)?;

    // Each page as a direct child of one new page tree.
    let root_id = doc.new_object_id();
    let mut kids = Vec::with_capacity(input.pages.len());
    let mut used = HashSet::new();
    // Root fields of the widgets on the kept pages, with the document they came from.
    let mut fields: Vec<(ObjectId, u32)> = Vec::new();
    for spec in input.pages {
        let id = match spec.source {
            Some(s) => {
                let original = *page_ids[&s].get(spec.index).ok_or("ページが見つかりません。開き直してください")?;
                let mut page = flattened(&doc, original);
                let rotate = page.get(b"Rotate").ok().and_then(number).unwrap_or(0.0) as i32;
                page.set("Rotate", ((rotate + spec.rotate).rem_euclid(360) / 90 * 90) as i64);
                page.set("Parent", root_id);
                if used.insert(original) {
                    doc.objects.insert(original, Object::Dictionary(page));
                    original
                } else {
                    // The same page twice: a copy, without the original's
                    // annotations (a widget can only sit on one page).
                    page.remove(b"Annots");
                    doc.add_object(page)
                }
            }
            None => {
                let [w, h] = spec.size.unwrap_or([595.276, 841.89]);
                if !(w.is_finite() && h.is_finite() && w >= 3.0 && h >= 3.0 && w <= 14_400.0 && h <= 14_400.0) {
                    return Err("白紙のページの大きさが正しくありません".into());
                }
                doc.add_object(dictionary! {
                    "Type" => "Page",
                    "Parent" => root_id,
                    "MediaBox" => super::rect_array([0.0, 0.0, w, h]),
                    "Resources" => dictionary! {},
                    "Rotate" => (spec.rotate.rem_euclid(360) / 90 * 90) as i64,
                })
            }
        };
        if let Some(s) = spec.source {
            for f in widget_fields(&doc, id) {
                if !fields.iter().any(|(x, _)| *x == f) {
                    fields.push((f, s));
                }
            }
        }
        if !spec.annots.is_empty() {
            let mut refs = match doc.get_dictionary(id).ok().and_then(|p| get_resolved(&doc, p, b"Annots")) {
                Some(Object::Array(a)) => a.clone(),
                _ => Vec::new(),
            };
            let mut w = Writer { doc: &mut doc, font: &mut font, images: input.images };
            for a in &spec.annots {
                refs.push(Object::Reference(w.write(id, a)?));
            }
            doc.get_dictionary_mut(id).map_err(|e| e.to_string())?.set("Annots", Object::Array(refs));
        }
        kids.push(Object::Reference(id));
    }
    let count = kids.len() as i64;
    doc.objects
        .insert(root_id, Object::Dictionary(dictionary! { "Type" => "Pages", "Kids" => kids, "Count" => count }));
    {
        let catalog = doc.catalog_mut().map_err(|_| "PDF の目次（カタログ）が読めません")?;
        catalog.set("Pages", root_id);
    }
    merge_form(&mut doc, &fields, &other_catalogs);
    font.finish(&mut doc)?;

    // Pages left out: whatever pointed at them now points nowhere.
    let removed: HashSet<ObjectId> = all_pages.difference(&used).copied().collect();
    if !removed.is_empty() {
        cut_references(&mut doc, &removed);
    }
    prune(&mut doc);
    touch_info(&mut doc);
    if doc.version.as_str() < "1.5" {
        // Object streams need 1.5.
        doc.version = "1.7".into();
    }
    Ok(doc)
}

fn new_document() -> Document {
    let mut doc = Document::with_version("1.7");
    let catalog = doc.add_object(dictionary! { "Type" => "Catalog" });
    doc.trailer.set("Root", catalog);
    doc
}

fn max_id(doc: &Document) -> u32 {
    doc.objects.keys().map(|k| k.0).max().unwrap_or(0).max(doc.max_id)
}

/// Renumbers every object of `doc` by `offset`, references included.
fn shift(doc: &mut Document, offset: u32) {
    fn walk(o: &mut Object, offset: u32) {
        match o {
            Object::Reference(id) => id.0 += offset,
            Object::Array(a) => a.iter_mut().for_each(|x| walk(x, offset)),
            Object::Dictionary(d) => d.iter_mut().for_each(|(_, v)| walk(v, offset)),
            Object::Stream(s) => s.dict.iter_mut().for_each(|(_, v)| walk(v, offset)),
            _ => {}
        }
    }
    let objects = std::mem::take(&mut doc.objects);
    doc.objects = objects
        .into_iter()
        .map(|((n, g), mut o)| {
            walk(&mut o, offset);
            ((n + offset, g), o)
        })
        .collect();
    doc.trailer.iter_mut().for_each(|(_, v)| walk(v, offset));
    doc.max_id += offset;
}

/// The page with what it inherits from its page tree written on itself, so
/// it can move to a new tree.
fn flattened(doc: &Document, page: ObjectId) -> Dictionary {
    let mut d = doc.get_dictionary(page).cloned().unwrap_or_default();
    let mut parent = d.get(b"Parent").ok().and_then(ref_id);
    let mut depth = 0;
    while let Some(p) = parent {
        depth += 1;
        let Ok(node) = doc.get_dictionary(p) else { break };
        for key in INHERITED {
            if d.get(key).is_err() {
                if let Ok(v) = node.get(key) {
                    d.set(key, v.clone());
                }
            }
        }
        parent = node.get(b"Parent").ok().and_then(ref_id);
        if depth > 64 {
            break;
        }
    }
    if d.get(b"MediaBox").is_err() {
        // Required; US Letter is what readers assume.
        d.set("MediaBox", super::rect_array([0.0, 0.0, 612.0, 792.0]));
    }
    if d.get(b"Resources").is_err() {
        d.set("Resources", dictionary! {});
    }
    d
}

/// The top-level fields of the widgets on a page.
fn widget_fields(doc: &Document, page: ObjectId) -> Vec<ObjectId> {
    let Ok(p) = doc.get_dictionary(page) else { return Vec::new() };
    let Some(Object::Array(annots)) = get_resolved(doc, p, b"Annots") else { return Vec::new() };
    let mut out = Vec::new();
    for id in annots.iter().filter_map(ref_id) {
        let Ok(a) = doc.get_dictionary(id) else { continue };
        if get_name(a, b"Subtype") != Some(b"Widget") {
            continue;
        }
        let mut field = id;
        for _ in 0..32 {
            match doc.get_dictionary(field).ok().and_then(|f| f.get(b"Parent").ok()).and_then(ref_id) {
                Some(p) if doc.get_dictionary(p).is_ok_and(|d| get_name(d, b"Type") != Some(b"Pages")) => field = p,
                _ => break,
            }
        }
        out.push(field);
    }
    out
}

/// The form of the result: the fields on the kept pages (renamed where two
/// documents use the same name), the base's settings, and the fonts the
/// other documents' fields use.
fn merge_form(doc: &mut Document, fields: &[(ObjectId, u32)], other_catalogs: &[ObjectId]) {
    let form_entry = doc.catalog().ok().and_then(|c| c.get(b"AcroForm").ok()).cloned();
    if fields.is_empty() && form_entry.is_none() {
        return;
    }
    // Names in use, per document; a name from a later document that is
    // already taken gets "_2", "_3"…
    let mut taken: HashMap<String, u32> = HashMap::new();
    for &(f, s) in fields {
        let Ok(d) = doc.get_dictionary(f) else { continue };
        let name = super::get_text(d, b"T");
        if name.is_empty() {
            continue;
        }
        match taken.get(&name) {
            Some(&owner) if owner != s => {
                let mut n = 2;
                while taken.contains_key(&format!("{name}_{n}")) {
                    n += 1;
                }
                let new = format!("{name}_{n}");
                taken.insert(new.clone(), s);
                if let Ok(d) = doc.get_dictionary_mut(f) {
                    d.set("T", text_string(&new));
                }
            }
            _ => {
                taken.insert(name, s);
            }
        }
    }
    let mut form = match &form_entry {
        Some(Object::Reference(id)) => doc.get_dictionary(*id).cloned().unwrap_or_default(),
        Some(Object::Dictionary(d)) => d.clone(),
        _ => dictionary! { "DA" => Object::string_literal("/Helv 0 Tf 0 g") },
    };
    form.set("Fields", Object::Array(fields.iter().map(|(f, _)| Object::Reference(*f)).collect()));
    // The pages may have changed; the XFA template would no longer match.
    form.remove(b"XFA");
    let mut fonts: BTreeMap<Vec<u8>, Object> = BTreeMap::new();
    for &c in other_catalogs {
        let Some(other) = doc.get_dictionary(c).ok().and_then(|c| get_dict(doc, c, b"AcroForm")) else { continue };
        if let Some(f) = get_dict(doc, other, b"DR").and_then(|dr| get_dict(doc, dr, b"Font")) {
            for (k, v) in f.iter() {
                fonts.entry(k.clone()).or_insert_with(|| v.clone());
            }
        }
    }
    if !fonts.is_empty() {
        let mut dr = get_dict(doc, &form, b"DR").cloned().unwrap_or_default();
        let mut font = get_dict(doc, &dr, b"Font").cloned().unwrap_or_default();
        for (k, v) in fonts {
            if font.get(&k).is_err() {
                font.set(k, v);
            }
        }
        dr.set("Font", font);
        form.set("DR", dr);
    }
    match form_entry {
        Some(Object::Reference(id)) => {
            doc.objects.insert(id, Object::Dictionary(form));
        }
        _ => {
            if let Ok(c) = doc.catalog_mut() {
                c.set("AcroForm", form);
            }
        }
    }
}

/// Replaces references to `removed` with null, everywhere.
fn cut_references(doc: &mut Document, removed: &HashSet<ObjectId>) {
    fn walk(o: &mut Object, removed: &HashSet<ObjectId>) {
        match o {
            Object::Reference(id) if removed.contains(id) => *o = Object::Null,
            Object::Array(a) => a.iter_mut().for_each(|x| walk(x, removed)),
            Object::Dictionary(d) => d.iter_mut().for_each(|(_, v)| walk(v, removed)),
            Object::Stream(s) => s.dict.iter_mut().for_each(|(_, v)| walk(v, removed)),
            _ => {}
        }
    }
    for (id, o) in doc.objects.iter_mut() {
        if !removed.contains(id) {
            walk(o, removed);
        }
    }
    doc.trailer.iter_mut().for_each(|(_, v)| walk(v, removed));
}

/// Drops the objects nothing reaches from the trailer (lopdf's own
/// `prune_objects` searches a list for every reference, which takes minutes
/// on a large file).
fn prune(doc: &mut Document) {
    fn refs(o: &Object, out: &mut Vec<ObjectId>) {
        match o {
            Object::Reference(id) => out.push(*id),
            Object::Array(a) => a.iter().for_each(|x| refs(x, out)),
            Object::Dictionary(d) => d.iter().for_each(|(_, v)| refs(v, out)),
            Object::Stream(s) => s.dict.iter().for_each(|(_, v)| refs(v, out)),
            _ => {}
        }
    }
    let mut seen = HashSet::new();
    let mut todo = Vec::new();
    doc.trailer.iter().for_each(|(_, v)| refs(v, &mut todo));
    while let Some(id) = todo.pop() {
        if !seen.insert(id) {
            continue;
        }
        if let Some(o) = doc.objects.get(&id) {
            refs(o, &mut todo);
        }
    }
    doc.objects.retain(|id, _| seen.contains(id));
}

fn touch_info(doc: &mut Document) {
    let now = text_string(&super::pdf_date_now());
    if let Some(id) = doc.trailer.get(b"Info").ok().and_then(ref_id) {
        if let Ok(info) = doc.get_dictionary_mut(id) {
            info.set("ModDate", now);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pdf::open::{open_bytes, tests::sample};
    use crate::pdf::AnnotKind;
    use lopdf::Stream;

    fn opened(bytes: Vec<u8>) -> Arc<Document> {
        Arc::new(open_bytes(bytes, &mut ImageStore::default()).unwrap().doc.unwrap())
    }

    /// A document of `n` pages whose contents say which page they are.
    fn pages(n: usize) -> Vec<u8> {
        let mut doc = Document::with_version("1.4");
        let pages_id = doc.new_object_id();
        let mut kids = Vec::new();
        for i in 0..n {
            let c = doc.add_object(Stream::new(dictionary! {}, format!("% page {i}").into_bytes()));
            kids.push(Object::Reference(
                doc.add_object(dictionary! { "Type" => "Page", "Parent" => pages_id, "Contents" => c }),
            ));
        }
        // MediaBox and Rotate inherited from the tree.
        doc.objects.insert(
            pages_id,
            Object::Dictionary(dictionary! {
                "Type" => "Pages", "Kids" => kids, "Count" => n as i64,
                "MediaBox" => vec![0.into(), 0.into(), 300.into(), 400.into()], "Rotate" => 90,
            }),
        );
        let catalog = doc.add_object(dictionary! { "Type" => "Catalog", "Pages" => pages_id });
        doc.trailer.set("Root", catalog);
        let first = doc.get_pages()[&1];
        let outline_item = doc.add_object(
            dictionary! { "Title" => Object::string_literal("p1"), "Dest" => vec![first.into(), "Fit".into()] },
        );
        let outlines = doc.add_object(
            dictionary! { "Type" => "Outlines", "First" => outline_item, "Last" => outline_item, "Count" => 1 },
        );
        doc.catalog_mut().unwrap().set("Outlines", outlines);
        let mut out = Vec::new();
        doc.save_to(&mut out).unwrap();
        out
    }

    fn page_text(doc: &Document, page: ObjectId) -> String {
        String::from_utf8_lossy(&doc.get_page_content(page)).into_owned()
    }

    fn spec(source: u32, index: usize) -> PageSpec {
        PageSpec { source: Some(source), index, rotate: 0, size: None, annots: vec![] }
    }

    #[test]
    fn reorders_rotates_and_drops_pages() {
        let mut sources = HashMap::new();
        sources.insert(1, opened(pages(3)));
        let specs = vec![PageSpec { rotate: 90, ..spec(1, 2) }, spec(1, 1)];
        let images = ImageStore::default();
        let bytes =
            compose(Input { sources: &sources, pages: &specs, forms: &[], font: None, images: &images }).unwrap();
        let doc = Document::load_mem(&bytes).unwrap();
        let p = doc.get_pages();
        assert_eq!(p.len(), 2);
        assert!(page_text(&doc, p[&1]).contains("page 2"));
        assert!(page_text(&doc, p[&2]).contains("page 1"));
        let first = doc.get_dictionary(p[&1]).unwrap();
        // 90 inherited + 90 asked for; the box came down from the tree.
        assert_eq!(first.get(b"Rotate").unwrap().as_i64().unwrap(), 180);
        assert!(first.get(b"MediaBox").is_ok());
        // Page 0 is gone, and so is what pointed at it.
        assert!(!String::from_utf8_lossy(&bytes).contains("% page 0"));
    }

    #[test]
    fn merges_documents_and_blank_pages() {
        let mut sources = HashMap::new();
        sources.insert(1, opened(pages(2)));
        sources.insert(2, opened(pages(1)));
        let specs = vec![
            spec(1, 0),
            PageSpec { source: None, index: 0, rotate: 0, size: Some([200.0, 100.0]), annots: vec![] },
            spec(2, 0),
            spec(1, 1),
        ];
        let images = ImageStore::default();
        let doc = build(&Input { sources: &sources, pages: &specs, forms: &[], font: None, images: &images }).unwrap();
        let p = doc.get_pages();
        assert_eq!(p.len(), 4);
        assert!(page_text(&doc, p[&3]).contains("page 0"));
        assert!(page_text(&doc, p[&4]).contains("page 1"));
        assert_eq!(
            super::super::numbers(doc.get_dictionary(p[&2]).unwrap().get(b"MediaBox").unwrap()),
            [0.0, 0.0, 200.0, 100.0]
        );
    }

    #[test]
    fn writes_annotations_back() {
        let mut sources = HashMap::new();
        sources.insert(1, opened(sample(vec![])));
        let a = Annot {
            id: "pdfe-x".into(),
            kind: AnnotKind::Text,
            rect: Some([100.0, 100.0, 220.0, 140.0]),
            text: "見積書".into(),
            width: 0.0,
            ..Default::default()
        };
        let specs = vec![PageSpec { annots: vec![a.clone()], ..spec(1, 0) }];
        let images = ImageStore::default();
        let font = Some(crate::pdf::font::test_font());
        let bytes = compose(Input { sources: &sources, pages: &specs, forms: &[], font, images: &images }).unwrap();
        // Open again: the text box comes back as it was.
        let o = open_bytes(bytes, &mut ImageStore::default()).unwrap();
        assert_eq!(o.annots.len(), 1);
        let back = &o.annots[0].annot;
        assert_eq!((back.id.as_str(), back.text.as_str(), back.kind), ("pdfe-x", "見積書", AnnotKind::Text));
        assert_eq!(back.rect, a.rect);
    }

    #[test]
    fn a_page_twice_is_copied() {
        let mut sources = HashMap::new();
        sources.insert(1, opened(pages(1)));
        let specs = vec![spec(1, 0), spec(1, 0)];
        let images = ImageStore::default();
        let doc = build(&Input { sources: &sources, pages: &specs, forms: &[], font: None, images: &images }).unwrap();
        let p = doc.get_pages();
        assert_eq!(p.len(), 2);
        assert_ne!(p[&1], p[&2]);
    }
}

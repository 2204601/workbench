//! Form fields filled in on screen (pdf.js's form layer) written into the
//! file: the field's value (/V), and for text and choices a new appearance
//! in the embedded Japanese font, so the value shows in every viewer.
//!
//! The field's own /DA (often Helvetica) is left as it is: another app that
//! edits the field later makes its own appearance from it.

use super::content::{num, Content};
use super::font::{Embedder, RESOURCE_NAME};
use super::{color_from_array, get_dict, get_resolved, get_text, number, numbers, rect_of, ref_id, text_string};
use lopdf::{dictionary, Document, Object, ObjectId, Stream};
use serde::Deserialize;
use std::collections::BTreeMap;

/// What pdf.js keeps for a widget (its annotation storage): text, a check,
/// the chosen export value(s).
#[derive(Debug, Clone, Deserialize)]
#[serde(untagged)]
pub enum FieldValue {
    Bool(bool),
    Text(String),
    List(Vec<String>),
}

/// pdf.js names a widget by its object: "12R", or "12R3" for generation 3.
pub fn parse_ref(s: &str) -> Option<ObjectId> {
    let (num, gen) = s.split_once('R')?;
    Some((num.parse().ok()?, if gen.is_empty() { 0 } else { gen.parse().ok()? }))
}

const MULTILINE: i64 = 1 << 12;
const PASSWORD: i64 = 1 << 13;
const RADIO: i64 = 1 << 15;
const PUSHBUTTON: i64 = 1 << 16;
const COMBO: i64 = 1 << 17;
const COMB: i64 = 1 << 24;

/// The field a widget belongs to: itself when it has a name, else its parent.
fn field_of(doc: &Document, widget: ObjectId) -> ObjectId {
    match doc.get_dictionary(widget) {
        Ok(d) if d.get(b"T").is_err() => d.get(b"Parent").ok().and_then(ref_id).unwrap_or(widget),
        _ => widget,
    }
}

/// An entry that fields inherit from their parents (/FT, /Ff, /DA, /Q…).
fn inherited<'a>(doc: &'a Document, mut id: ObjectId, key: &[u8]) -> Option<&'a Object> {
    for _ in 0..32 {
        let d = doc.get_dictionary(id).ok()?;
        if let Some(v) = get_resolved(doc, d, key) {
            return Some(v);
        }
        id = d.get(b"Parent").ok().and_then(ref_id)?;
    }
    None
}

/// The widgets of a field: its kids, or the field itself.
fn widgets(doc: &Document, field: ObjectId) -> Vec<ObjectId> {
    let Ok(d) = doc.get_dictionary(field) else { return Vec::new() };
    match get_resolved(doc, d, b"Kids") {
        Some(Object::Array(kids)) => kids.iter().filter_map(ref_id).collect(),
        _ => vec![field],
    }
}

/// A check box's or radio button's "on" name (its appearance other than Off).
fn on_name(doc: &Document, widget: ObjectId) -> Option<Vec<u8>> {
    let d = doc.get_dictionary(widget).ok()?;
    let ap = get_dict(doc, d, b"AP")?;
    let n = get_dict(doc, ap, b"N")?;
    n.iter().map(|(k, _)| k.clone()).find(|k| k != b"Off")
}

pub fn apply(doc: &mut Document, font: &mut Embedder, values: &[(ObjectId, FieldValue)]) -> Result<(), String> {
    if values.is_empty() {
        return Ok(());
    }
    // Radio groups: which widget is on, per field.
    let mut radios: BTreeMap<ObjectId, Option<ObjectId>> = BTreeMap::new();
    for (widget, value) in values {
        let widget = *widget;
        if doc.get_dictionary(widget).is_err() {
            continue;
        }
        let field = field_of(doc, widget);
        let ft = inherited(doc, field, b"FT").and_then(|o| o.as_name().ok()).unwrap_or(b"").to_vec();
        let ff = inherited(doc, field, b"Ff").and_then(number).unwrap_or(0.0) as i64;
        match (ft.as_slice(), value) {
            (b"Tx", FieldValue::Text(text)) => {
                if doc.get_dictionary(field).map(|f| get_text(f, b"V")).unwrap_or_default() == *text {
                    continue;
                }
                set(doc, field, "V", text_string(text));
                for w in widgets(doc, field) {
                    let shown = if ff & PASSWORD != 0 { "*".repeat(text.chars().count()) } else { text.clone() };
                    text_appearance(doc, font, field, w, &[shown], None)?;
                }
            }
            (b"Btn", FieldValue::Bool(on)) if ff & PUSHBUTTON == 0 => {
                if ff & RADIO != 0 {
                    let entry = radios.entry(field).or_insert(None);
                    if *on {
                        *entry = Some(widget);
                    }
                    continue;
                }
                let name = if *on { on_name(doc, widget).unwrap_or_else(|| b"Yes".to_vec()) } else { b"Off".to_vec() };
                set(doc, field, "V", Object::Name(name.clone()));
                for w in widgets(doc, field) {
                    let state = if on_name(doc, w).as_deref() == Some(name.as_slice()) {
                        name.clone()
                    } else {
                        b"Off".to_vec()
                    };
                    set(doc, w, "AS", Object::Name(state));
                }
            }
            (b"Ch", FieldValue::Text(_) | FieldValue::List(_)) => {
                let chosen: Vec<String> = match value {
                    FieldValue::Text(t) => vec![t.clone()],
                    FieldValue::List(l) => l.clone(),
                    FieldValue::Bool(_) => unreachable!(),
                };
                let options = choice_options(doc, field);
                let v = match chosen.as_slice() {
                    [one] => text_string(one),
                    many => Object::Array(many.iter().map(|s| text_string(s)).collect()),
                };
                set(doc, field, "V", v);
                let indices: Vec<Object> = options
                    .iter()
                    .enumerate()
                    .filter(|(_, (export, _))| chosen.contains(export))
                    .map(|(i, _)| Object::Integer(i as i64))
                    .collect();
                if ff & COMBO == 0 {
                    set(doc, field, "I", Object::Array(indices));
                }
                for w in widgets(doc, field) {
                    if ff & COMBO != 0 {
                        let display = options
                            .iter()
                            .find(|(export, _)| chosen.first() == Some(export))
                            .map(|(_, shown)| shown.clone())
                            .or_else(|| chosen.first().cloned())
                            .unwrap_or_default();
                        text_appearance(doc, font, field, w, &[display], None)?;
                    } else {
                        let lines: Vec<String> = options.iter().map(|(_, shown)| shown.clone()).collect();
                        let picked: Vec<usize> = options
                            .iter()
                            .enumerate()
                            .filter(|(_, (e, _))| chosen.contains(e))
                            .map(|(i, _)| i)
                            .collect();
                        text_appearance(doc, font, field, w, &lines, Some(&picked))?;
                    }
                }
            }
            _ => {}
        }
    }
    for (field, on) in radios {
        let name = on.and_then(|w| on_name(doc, w)).unwrap_or_else(|| b"Off".to_vec());
        set(doc, field, "V", Object::Name(name.clone()));
        for w in widgets(doc, field) {
            let state =
                if on_name(doc, w).as_deref() == Some(name.as_slice()) { name.clone() } else { b"Off".to_vec() };
            set(doc, w, "AS", Object::Name(state));
        }
    }
    // A hybrid XFA form would make Acrobat show the XFA data instead of the
    // values just written.
    let form_id = doc.catalog().ok().and_then(|c| c.get(b"AcroForm").ok()).and_then(ref_id);
    match form_id {
        Some(id) => {
            if let Ok(f) = doc.get_dictionary_mut(id) {
                f.remove(b"XFA");
            }
        }
        None => {
            if let Ok(Object::Dictionary(f)) = doc.catalog_mut().and_then(|c| c.get_mut(b"AcroForm")) {
                f.remove(b"XFA");
            }
        }
    }
    Ok(())
}

fn set(doc: &mut Document, id: ObjectId, key: &str, value: Object) {
    if let Ok(d) = doc.get_dictionary_mut(id) {
        d.set(key, value);
    }
}

/// A choice field's options as (export value, shown text).
fn choice_options(doc: &Document, field: ObjectId) -> Vec<(String, String)> {
    let Some(Object::Array(opts)) = inherited(doc, field, b"Opt") else { return Vec::new() };
    opts.iter()
        .filter_map(|o| match super::resolve(doc, o) {
            Object::String(s, _) => {
                let t = super::decode_text(s);
                Some((t.clone(), t))
            }
            Object::Array(pair) if pair.len() == 2 => {
                let text = |o: &Object| match super::resolve(doc, o) {
                    Object::String(s, _) => Some(super::decode_text(s)),
                    _ => None,
                };
                Some((text(&pair[0])?, text(&pair[1])?))
            }
            _ => None,
        })
        .collect()
}

/// Breaks `text` into lines no wider than `max` (points): at spaces where
/// there are some, anywhere in Japanese, which has none.
pub fn wrap(font: &Embedder, text: &str, size: f64, max: f64) -> Vec<String> {
    let mut out = Vec::new();
    for para in text.split('\n') {
        let mut line = String::new();
        for c in para.chars() {
            let mut next = line.clone();
            next.push(c);
            if !line.is_empty() && font.width(&next, size) > max {
                // Back to the last space, if the line has one (Latin text).
                match line.rfind(' ').filter(|&i| i > 0 && c != ' ') {
                    Some(i) => {
                        let rest = line[i + 1..].to_string();
                        line.truncate(i);
                        out.push(std::mem::take(&mut line));
                        line = rest;
                    }
                    None => out.push(std::mem::take(&mut line)),
                }
                if c == ' ' {
                    continue;
                }
            }
            line.push(c);
        }
        out.push(line);
    }
    out
}

/// A text field's or choice field's appearance: its background and border,
/// then `lines` (wrapped when the field is multi-line). `picked`: a list
/// box's selected rows, drawn highlighted.
fn text_appearance(
    doc: &mut Document,
    font: &mut Embedder,
    field: ObjectId,
    widget: ObjectId,
    lines: &[String],
    picked: Option<&[usize]>,
) -> Result<(), String> {
    let Ok(w) = doc.get_dictionary(widget) else { return Ok(()) };
    let Some(rect) = w.get(b"Rect").ok().and_then(rect_of) else { return Ok(()) };
    let mk = get_dict(doc, w, b"MK");
    let rot = mk.and_then(|m| m.get(b"R").ok()).and_then(number).map(|r| (r as i64).rem_euclid(360)).unwrap_or(0);
    let (bw, bh) = if rot == 90 || rot == 270 {
        (rect[3] - rect[1], rect[2] - rect[0])
    } else {
        (rect[2] - rect[0], rect[3] - rect[1])
    };
    let bg = mk.and_then(|m| match get_resolved(doc, m, b"BG") {
        Some(Object::Array(a)) => color_from_array(a),
        _ => None,
    });
    let bc = mk.and_then(|m| match get_resolved(doc, m, b"BC") {
        Some(Object::Array(a)) => color_from_array(a),
        _ => None,
    });
    let border = match get_dict(doc, w, b"BS") {
        Some(bs) => bs.get(b"W").ok().and_then(number).unwrap_or(1.0),
        None => w.get(b"Border").map(numbers).ok().and_then(|b| b.get(2).copied()).unwrap_or(1.0),
    };
    let border = if bc.is_some() { border } else { 0.0 };
    let da = inherited(doc, widget, b"DA")
        .or_else(|| {
            doc.catalog().ok().and_then(|c| get_dict(doc, c, b"AcroForm")).and_then(|f| get_resolved(doc, f, b"DA"))
        })
        .and_then(|o| match o {
            Object::String(s, _) => Some(super::decode_text(s)),
            _ => None,
        })
        .unwrap_or_default();
    let tokens: Vec<&str> = da.split_whitespace().collect();
    let mut size = 0.0;
    let mut color = [0.0; 3];
    for (i, t) in tokens.iter().enumerate() {
        let n = |k: usize| tokens.get(i.wrapping_sub(k)).and_then(|s| s.parse::<f64>().ok());
        match *t {
            "Tf" => size = n(1).unwrap_or(0.0),
            "rg" => color = [n(3).unwrap_or(0.0), n(2).unwrap_or(0.0), n(1).unwrap_or(0.0)],
            "g" => color = [n(1).unwrap_or(0.0); 3],
            _ => {}
        }
    }
    let ff = inherited(doc, field, b"Ff").and_then(number).unwrap_or(0.0) as i64;
    let q = inherited(doc, field, b"Q").and_then(number).unwrap_or(0.0) as i64;
    let max_len = inherited(doc, field, b"MaxLen").and_then(number).unwrap_or(0.0) as usize;
    let multiline = ff & MULTILINE != 0 || picked.is_some();
    let pad = 2.0 + border;
    let (avail_w, avail_h) = ((bw - 2.0 * pad).max(1.0), (bh - 2.0 * pad).max(1.0));
    let (asc, desc) = font.vertical();

    // Size 0 means "fit the field".
    let auto = size <= 0.0;
    if auto {
        size = if multiline { 12.0 } else { (avail_h / (asc - desc)).clamp(4.0, 12.0) };
        if !multiline && picked.is_none() {
            if let Some(l) = lines.first() {
                let wide = font.width(l, size);
                if wide > avail_w {
                    size = (size * avail_w / wide).max(4.0);
                }
            }
        }
    }
    let line_height = |size: f64| size * (asc - desc) * 1.1;
    let shown: Vec<String> = if multiline && picked.is_none() {
        let mut v = wrap(font, &lines.join("\n"), size, avail_w);
        // Shrink a fitted field's text until it fits.
        while auto && v.len() as f64 * line_height(size) > avail_h && size > 4.0 {
            size -= 0.5;
            v = wrap(font, &lines.join("\n"), size, avail_w);
        }
        v
    } else {
        lines.to_vec()
    };
    let lh = line_height(size);

    let font_id = font.font_ref(doc);
    let mut c = Content::new();
    if let Some(bg) = bg {
        c.fill_rgb(bg).rect(0.0, 0.0, bw, bh).raw("f");
    }
    if let Some(bc) = bc {
        if border > 0.0 {
            c.stroke_rgb(bc).op(&[border], "w").rect(border / 2.0, border / 2.0, bw - border, bh - border).raw("S");
        }
    }
    c.raw("/Tx BMC").save();
    c.rect(border, border, (bw - 2.0 * border).max(0.0), (bh - 2.0 * border).max(0.0)).raw("W n");
    if let Some(picked) = picked {
        for &i in picked {
            let top = bh - pad - i as f64 * lh;
            c.fill_rgb([0.6, 0.75, 0.92]).rect(border, top - lh, bw - 2.0 * border, lh).raw("f");
        }
    }
    c.raw("BT").raw(&format!("/{RESOURCE_NAME} {} Tf", num(size))).fill_rgb(color);
    let comb = ff & COMB != 0 && max_len > 0 && !multiline;
    for (i, line) in shown.iter().enumerate() {
        if line.is_empty() {
            continue;
        }
        let y = if multiline {
            bh - pad - asc * size - i as f64 * lh
        } else {
            (bh - (asc - desc) * size) / 2.0 - desc * size
        };
        if comb {
            let cell = bw / max_len as f64;
            for (k, ch) in line.chars().take(max_len).enumerate() {
                let s = ch.to_string();
                let x = cell * k as f64 + (cell - font.width(&s, size)) / 2.0;
                c.op(&[1.0, 0.0, 0.0, 1.0, x, y], "Tm");
                let enc = font.encode(&s);
                c.raw(&format!("{enc} Tj"));
            }
            continue;
        }
        let wide = font.width(line, size);
        let x = match q {
            1 => (bw - wide) / 2.0,
            2 => bw - pad - wide,
            _ => pad,
        };
        c.op(&[1.0, 0.0, 0.0, 1.0, x, y], "Tm");
        let enc = font.encode(line);
        c.raw(&format!("{enc} Tj"));
    }
    c.raw("ET").restore().raw("EMC");
    let matrix: [f64; 6] = match rot {
        90 => [0.0, 1.0, -1.0, 0.0, 0.0, 0.0],
        180 => [-1.0, 0.0, 0.0, -1.0, 0.0, 0.0],
        270 => [0.0, -1.0, 1.0, 0.0, 0.0, 0.0],
        _ => [1.0, 0.0, 0.0, 1.0, 0.0, 0.0],
    };
    let mut s = Stream::new(
        dictionary! {
            "Type" => "XObject",
            "Subtype" => "Form",
            "BBox" => super::rect_array([0.0, 0.0, bw, bh]),
            "Matrix" => Object::Array(matrix.iter().map(|&v| Object::Real(v as f32)).collect()),
            "Resources" => dictionary! { "Font" => dictionary! { RESOURCE_NAME => font_id } },
        },
        c.into_bytes(),
    );
    let _ = s.compress();
    let ap = doc.add_object(s);
    set(doc, widget, "AP", Object::Dictionary(dictionary! { "N" => ap }));
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pdf::font::test_font;
    use crate::pdf::get_name;

    /// A document with a text field, a check box and a radio group of two.
    fn form() -> (Document, ObjectId, ObjectId, ObjectId, ObjectId) {
        let mut doc = Document::with_version("1.7");
        let on_off = |doc: &mut Document, on: &str| {
            let a = doc.add_object(Stream::new(dictionary! {}, b"".to_vec()));
            let b = doc.add_object(Stream::new(dictionary! {}, b"".to_vec()));
            dictionary! { "N" => dictionary! { on => a, "Off" => b } }
        };
        let text = doc.add_object(dictionary! {
            "Type" => "Annot", "Subtype" => "Widget", "FT" => "Tx", "T" => Object::string_literal("name"),
            "Rect" => vec![10.into(), 10.into(), 210.into(), 30.into()],
            "DA" => Object::string_literal("/Helv 0 Tf 0 g"), "Q" => 1,
        });
        let ap = on_off(&mut doc, "Yes");
        let check = doc.add_object(dictionary! {
            "Type" => "Annot", "Subtype" => "Widget", "FT" => "Btn", "T" => Object::string_literal("agree"),
            "Rect" => vec![10.into(), 40.into(), 20.into(), 50.into()], "AP" => ap, "AS" => "Off",
        });
        let group = doc.new_object_id();
        let ap1 = on_off(&mut doc, "A");
        let ap2 = on_off(&mut doc, "B");
        let r1 = doc.add_object(
            dictionary! { "Type" => "Annot", "Subtype" => "Widget", "Parent" => group, "AP" => ap1, "AS" => "A" },
        );
        let r2 = doc.add_object(
            dictionary! { "Type" => "Annot", "Subtype" => "Widget", "Parent" => group, "AP" => ap2, "AS" => "Off" },
        );
        doc.objects.insert(
            group,
            Object::Dictionary(dictionary! {
                "FT" => "Btn", "Ff" => RADIO | (1 << 14), "T" => Object::string_literal("size"), "V" => "A",
                "Kids" => vec![r1.into(), r2.into()],
            }),
        );
        (doc, text, check, r2, group)
    }

    #[test]
    fn values_and_appearances() {
        let (mut doc, text, check, r2, group) = form();
        let mut font = Embedder::new(Some(test_font()));
        let values = vec![
            (text, FieldValue::Text("Taro".into())),
            (check, FieldValue::Bool(true)),
            (r2, FieldValue::Bool(true)),
        ];
        apply(&mut doc, &mut font, &values).unwrap();
        font.finish(&mut doc).unwrap();
        let t = doc.get_dictionary(text).unwrap();
        assert_eq!(get_text(t, b"V"), "Taro");
        assert!(t.get(b"AP").unwrap().as_dict().unwrap().get(b"N").is_ok());
        let c = doc.get_dictionary(check).unwrap();
        assert_eq!(get_name(c, b"V"), Some(b"Yes".as_slice()));
        assert_eq!(get_name(c, b"AS"), Some(b"Yes".as_slice()));
        assert_eq!(get_name(doc.get_dictionary(group).unwrap(), b"V"), Some(b"B".as_slice()));
        assert_eq!(get_name(doc.get_dictionary(r2).unwrap(), b"AS"), Some(b"B".as_slice()));
    }

    #[test]
    fn refs_and_wrapping() {
        assert_eq!(parse_ref("12R"), Some((12, 0)));
        assert_eq!(parse_ref("7R2"), Some((7, 2)));
        assert_eq!(parse_ref("x"), None);
        let font = Embedder::new(Some(test_font()));
        let lines = wrap(&font, "hello world again", 10.0, 60.0);
        assert!(lines.len() >= 2, "{lines:?}");
        assert!(lines.iter().all(|l| !l.starts_with(' ')));
        assert_eq!(wrap(&font, "a\n\nb", 10.0, 100.0), ["a", "", "b"]);
    }
}

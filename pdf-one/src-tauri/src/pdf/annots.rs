//! Writes an annotation (`Annot`) as a PDF annotation dictionary with its
//! own appearance stream, so every viewer draws it the same way (Acrobat,
//! Edge, Chrome, Preview, pdf.js) without making one up.
//!
//! The standard entries (/QuadPoints, /InkList, /L, /IC, /BS…) are written
//! too, so other apps can edit them. What the standard has no place for (a
//! text box's fill and font size, a picture's turn) goes into
//! /PDFOneStyle, which open.rs reads back.

use super::content::Content;
use super::font::{Embedder, RESOURCE_NAME};
use super::image::{image_xobject, ImageStore};
use super::{color_array, parse_color, rect_array, text_string, Annot, AnnotKind, Rgb};
use lopdf::{dictionary, Dictionary, Document, Object, ObjectId, Stream};
use serde::{Deserialize, Serialize};

/// The private entry with what the standard can't say (see the module doc).
pub const STYLE_KEY: &[u8] = b"PDFOneStyle";

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Style {
    pub fill: Option<String>,
    pub font_size: Option<f64>,
    pub rotation: u16,
    pub width: Option<f64>,
    /// A seal's shape ("round" or "box"); see `Annot::seal`.
    pub seal: Option<String>,
}

/// The name under /Name of a seal the app drew (not a standard stamp name).
pub const SEAL_NAME: &str = "PDFOneSeal";

/// Room between a seal's frame and its words, as a share of its size.
pub const SEAL_PADDING: f64 = 0.08;

/// Line height of text boxes, as a multiple of the font size. The overlay
/// (src/components/Overlay.tsx) uses the same.
pub const LINE_HEIGHT: f64 = 1.25;
/// Room between a text box's edge and its text, in points (plus the border).
pub const TEXT_PADDING: f64 = 2.0;

pub struct Writer<'a> {
    pub doc: &'a mut Document,
    pub font: &'a mut Embedder,
    pub images: &'a ImageStore,
}

/// The rotation matrix that turns content by `deg` counterclockwise.
fn rotation_matrix(deg: u16) -> [f64; 6] {
    match deg % 360 {
        90 => [0.0, 1.0, -1.0, 0.0, 0.0, 0.0],
        180 => [-1.0, 0.0, 0.0, -1.0, 0.0, 0.0],
        270 => [0.0, -1.0, 1.0, 0.0, 0.0, 0.0],
        _ => [1.0, 0.0, 0.0, 1.0, 0.0, 0.0],
    }
}

fn bbox_of(points: impl Iterator<Item = (f64, f64)>) -> Option<[f64; 4]> {
    let mut r = [f64::INFINITY, f64::INFINITY, f64::NEG_INFINITY, f64::NEG_INFINITY];
    let mut any = false;
    for (x, y) in points {
        if !(x.is_finite() && y.is_finite()) {
            continue;
        }
        any = true;
        r = [r[0].min(x), r[1].min(y), r[2].max(x), r[3].max(y)];
    }
    any.then_some(r)
}

fn grow(r: [f64; 4], by: f64) -> [f64; 4] {
    [r[0] - by, r[1] - by, r[2] + by, r[3] + by]
}

fn valid_rect(r: Option<[f64; 4]>) -> Result<[f64; 4], String> {
    let r = r.ok_or("注釈の位置がありません")?;
    if r.iter().all(|v| v.is_finite()) && r[2] > r[0] && r[3] > r[1] {
        Ok(r)
    } else {
        Err("注釈の位置が正しくありません".into())
    }
}

impl Writer<'_> {
    /// An appearance stream (form XObject).
    fn form(&mut self, bbox: [f64; 4], matrix: Option<[f64; 6]>, resources: Dictionary, content: Content) -> ObjectId {
        let mut dict = dictionary! {
            "Type" => "XObject",
            "Subtype" => "Form",
            "BBox" => rect_array(bbox),
            "Resources" => resources,
        };
        if let Some(m) = matrix {
            dict.set("Matrix", Object::Array(m.iter().map(|&v| Object::Real(v as f32)).collect()));
        }
        let mut s = Stream::new(dict, content.into_bytes());
        let _ = s.compress();
        self.doc.add_object(s)
    }

    /// Resources with a graphics state for the opacity (and blend mode).
    fn gs_resources(opacity: f64, multiply: bool) -> Dictionary {
        let mut gs = dictionary! { "CA" => opacity as f32, "ca" => opacity as f32 };
        if multiply {
            gs.set("BM", "Multiply");
        }
        dictionary! { "ExtGState" => dictionary! { "G0" => gs } }
    }

    pub fn write(&mut self, page: ObjectId, a: &Annot) -> Result<ObjectId, String> {
        let color = parse_color(&a.color);
        let opacity = if a.opacity.is_finite() { a.opacity.clamp(0.05, 1.0) } else { 1.0 };
        let width = if a.width.is_finite() { a.width.clamp(0.0, 100.0) } else { 1.0 };
        let fill = a.fill.as_deref().map(parse_color);

        let mut d = dictionary! {
            "Type" => "Annot",
            "Rect" => rect_array([0.0; 4]),
            "F" => 4,
            "P" => page,
            "NM" => text_string(&a.id),
            "M" => text_string(&if a.modified.is_empty() { super::pdf_date_now() } else { a.modified.clone() }),
            "C" => color_array(color),
            "CA" => opacity as f32,
        };
        if !a.author.is_empty() {
            d.set("T", text_string(&a.author));
        }
        if !a.contents.is_empty() {
            d.set("Contents", text_string(&a.contents));
        }
        let mut style = Style { width: Some(width), ..Default::default() };

        let (subtype, rect, ap) = match a.kind {
            AnnotKind::Highlight | AnnotKind::Underline | AnnotKind::Strikeout => {
                let quads: Vec<[f64; 8]> =
                    a.quads.iter().filter(|q| q.iter().all(|v| v.is_finite())).copied().collect();
                let rect = bbox_of(
                    quads.iter().flat_map(|q| q.chunks(2).map(|p| (p[0], p[1]))).collect::<Vec<_>>().into_iter(),
                )
                .ok_or("マーカーの位置がありません")?;
                d.set("QuadPoints", Object::Array(quads.iter().flatten().map(|&v| Object::Real(v as f32)).collect()));
                let mut c = Content::new();
                let highlight = a.kind == AnnotKind::Highlight;
                c.gs("G0");
                for q in &quads {
                    let (ul, ur, ll, lr) = ((q[0], q[1]), (q[2], q[3]), (q[4], q[5]), (q[6], q[7]));
                    if highlight {
                        c.fill_rgb(color);
                        c.move_to(ll.0, ll.1).line_to(lr.0, lr.1).line_to(ur.0, ur.1).line_to(ul.0, ul.1).raw("h f");
                    } else {
                        // Across the line's height: the bottom (underline) or the middle.
                        let h = ((ul.0 - ll.0).powi(2) + (ul.1 - ll.1).powi(2)).sqrt().max(0.1);
                        let up = ((ul.0 - ll.0) / h, (ul.1 - ll.1) / h);
                        let t = (h / 14.0).max(0.6);
                        let at = if a.kind == AnnotKind::Underline { t / 2.0 + h * 0.04 } else { h * 0.45 };
                        c.stroke_rgb(color).op(&[t], "w");
                        c.move_to(ll.0 + up.0 * at, ll.1 + up.1 * at)
                            .line_to(lr.0 + up.0 * at, lr.1 + up.1 * at)
                            .raw("S");
                    }
                }
                let rect = grow(rect, 1.0);
                let ap = self.form(rect, None, Self::gs_resources(opacity, highlight), c);
                let subtype = match a.kind {
                    AnnotKind::Highlight => "Highlight",
                    AnnotKind::Underline => "Underline",
                    _ => "StrikeOut",
                };
                (subtype, rect, ap)
            }
            AnnotKind::Ink => {
                let paths: Vec<&Vec<f64>> = a.paths.iter().filter(|p| p.len() >= 2).collect();
                let rect = bbox_of(paths.iter().flat_map(|p| p.as_chunks::<2>().0.iter().map(|&[x, y]| (x, y))))
                    .ok_or("手書きの線がありません")?;
                let rect = grow(rect, width / 2.0 + 1.0);
                d.set(
                    "InkList",
                    Object::Array(
                        paths
                            .iter()
                            .map(|p| Object::Array(p.iter().map(|&v| Object::Real(v as f32)).collect()))
                            .collect(),
                    ),
                );
                d.set("BS", dictionary! { "W" => width as f32, "S" => "S" });
                let mut c = Content::new();
                c.gs("G0").stroke_rgb(color).op(&[width], "w").raw("1 J 1 j");
                for p in paths {
                    let mut pts = p.as_chunks::<2>().0.iter();
                    if let Some(first) = pts.next() {
                        c.move_to(first[0], first[1]);
                        let mut any = false;
                        for q in pts {
                            c.line_to(q[0], q[1]);
                            any = true;
                        }
                        if !any {
                            // A dot.
                            c.line_to(first[0] + 0.01, first[1]);
                        }
                        c.raw("S");
                    }
                }
                let ap = self.form(rect, None, Self::gs_resources(opacity, false), c);
                ("Ink", rect, ap)
            }
            AnnotKind::Rect | AnnotKind::Ellipse => {
                let r = valid_rect(a.rect)?;
                d.set("BS", dictionary! { "W" => width as f32, "S" => "S" });
                if let Some(f) = fill {
                    d.set("IC", color_array(f));
                }
                let inset = width / 2.0;
                let inner = [r[0] + inset, r[1] + inset, r[2] - inset, r[3] - inset];
                let mut c = Content::new();
                c.gs("G0").stroke_rgb(color).op(&[width], "w");
                if let Some(f) = fill {
                    c.fill_rgb(f);
                }
                if a.kind == AnnotKind::Rect {
                    c.rect(inner[0], inner[1], inner[2] - inner[0], inner[3] - inner[1]);
                } else {
                    c.ellipse(inner);
                }
                c.raw(match (fill.is_some(), width > 0.0) {
                    (true, true) => "B",
                    (true, false) => "f",
                    (false, true) => "S",
                    (false, false) => "n",
                });
                let ap = self.form(r, None, Self::gs_resources(opacity, false), c);
                (if a.kind == AnnotKind::Rect { "Square" } else { "Circle" }, r, ap)
            }
            AnnotKind::Line | AnnotKind::Arrow => {
                let l = a.line.filter(|l| l.iter().all(|v| v.is_finite())).ok_or("線の位置がありません")?;
                let head = 6.0 + width * 3.0;
                let rect = grow(bbox_of([(l[0], l[1]), (l[2], l[3])].into_iter()).unwrap(), head + width);
                d.set("L", Object::Array(l.iter().map(|&v| Object::Real(v as f32)).collect()));
                d.set("BS", dictionary! { "W" => width as f32, "S" => "S" });
                let mut c = Content::new();
                c.gs("G0").stroke_rgb(color).op(&[width], "w").raw("1 J 1 j");
                c.move_to(l[0], l[1]).line_to(l[2], l[3]).raw("S");
                if a.kind == AnnotKind::Arrow {
                    d.set("LE", vec![Object::Name(b"None".to_vec()), Object::Name(b"OpenArrow".to_vec())]);
                    let ang = (l[3] - l[1]).atan2(l[2] - l[0]);
                    let spread = 0.5;
                    let p1 = (l[2] - head * (ang - spread).cos(), l[3] - head * (ang - spread).sin());
                    let p2 = (l[2] - head * (ang + spread).cos(), l[3] - head * (ang + spread).sin());
                    c.move_to(p1.0, p1.1).line_to(l[2], l[3]).line_to(p2.0, p2.1).raw("S");
                }
                let ap = self.form(rect, None, Self::gs_resources(opacity, false), c);
                ("Line", rect, ap)
            }
            AnnotKind::Text => {
                let r = valid_rect(a.rect)?;
                let rot = a.rotation % 360;
                let (vw, vh) =
                    if rot == 90 || rot == 270 { (r[3] - r[1], r[2] - r[0]) } else { (r[2] - r[0], r[3] - r[1]) };
                let size = if a.font_size.is_finite() { a.font_size.clamp(4.0, 200.0) } else { 12.0 };
                let font = self.font.font_ref(self.doc);
                let mut c = Content::new();
                c.gs("G0");
                if let Some(f) = fill {
                    c.fill_rgb(f).rect(0.0, 0.0, vw, vh).raw("f");
                }
                if width > 0.0 {
                    let i = width / 2.0;
                    c.stroke_rgb(color).op(&[width], "w").rect(i, i, vw - width, vh - width).raw("S");
                }
                let lines: Vec<String> =
                    if a.lines.is_empty() { a.text.split('\n').map(str::to_string).collect() } else { a.lines.clone() };
                let (asc, desc) = self.font.vertical();
                let lh = size * LINE_HEIGHT;
                let pad = TEXT_PADDING + width;
                // CSS puts half the leading above the font's ascent; so do we.
                let first = vh - pad - (lh - (asc - desc) * size) / 2.0 - asc * size;
                c.raw("/Tx BMC").save();
                c.rect(pad, pad, (vw - 2.0 * pad).max(0.0), (vh - 2.0 * pad).max(0.0)).raw("W n");
                c.raw("BT").raw(&format!("/{RESOURCE_NAME} {} Tf", super::content::num(size))).fill_rgb(color);
                for (i, line) in lines.iter().enumerate() {
                    let text = line.trim_end_matches('\r');
                    if text.is_empty() {
                        continue;
                    }
                    c.op(&[1.0, 0.0, 0.0, 1.0, pad, first - i as f64 * lh], "Tm");
                    let s = self.font.encode(text);
                    c.raw(&format!("{s} Tj"));
                }
                c.raw("ET").restore().raw("EMC");
                let mut res = Self::gs_resources(opacity, false);
                res.set("Font", dictionary! { RESOURCE_NAME => font });
                let ap = self.form([0.0, 0.0, vw, vh], Some(rotation_matrix(rot)), res, c);
                d.set("Contents", text_string(&a.text));
                d.set(
                    "DA",
                    Object::string_literal(format!(
                        "/Helv {} Tf {} {} {} rg",
                        super::content::num(size),
                        super::content::num(color[0]),
                        super::content::num(color[1]),
                        super::content::num(color[2])
                    )),
                );
                d.set(
                    "DS",
                    Object::string_literal(format!(
                        "font: {}pt sans-serif; color: {}",
                        super::content::num(size),
                        a.color
                    )),
                );
                d.set("BS", dictionary! { "W" => width as f32 });
                if rot != 0 {
                    d.set("Rotate", rot as i64);
                }
                style.fill = a.fill.clone();
                style.font_size = Some(size);
                style.rotation = rot;
                ("FreeText", r, ap)
            }
            AnnotKind::Note => {
                let r = valid_rect(a.rect)?;
                d.set("Name", "Comment");
                d.set("Open", false);
                let (w, h) = (r[2] - r[0], r[3] - r[1]);
                let mut c = Content::new();
                c.save().op(&[w / 20.0, 0.0, 0.0, h / 20.0, 0.0, 0.0], "cm");
                // A speech bubble, in a 20 × 20 box.
                c.fill_rgb(color).stroke_rgb(darker(color)).op(&[1.0], "w").raw("1 j");
                c.move_to(2.0, 18.5).line_to(18.0, 18.5).line_to(18.0, 6.5).line_to(9.0, 6.5).line_to(4.5, 1.5);
                c.line_to(5.5, 6.5).line_to(2.0, 6.5).raw("h B");
                c.stroke_rgb(darker(darker(color))).op(&[1.2], "w");
                for y in [14.5, 10.5] {
                    c.move_to(5.0, y).line_to(15.0, y).raw("S");
                }
                c.restore();
                let ap = self.form([0.0, 0.0, w, h], None, Self::gs_resources(opacity, false), c);
                ("Text", r, ap)
            }
            AnnotKind::Seal => {
                let r = valid_rect(a.rect)?;
                let rot = a.rotation % 360;
                let (vw, vh) =
                    if rot == 90 || rot == 270 { (r[3] - r[1], r[2] - r[0]) } else { (r[2] - r[0], r[3] - r[1]) };
                let size = if a.font_size.is_finite() { a.font_size.clamp(4.0, 200.0) } else { 12.0 };
                let round = a.seal.as_deref() != Some("box");
                let font = self.font.font_ref(self.doc);
                let lines: Vec<&str> = a.text.lines().map(str::trim).collect();
                let layout = seal_layout(round, vw, vh, size, width, &lines, |t, s| self.font.width(t, s));
                let mut c = Content::new();
                c.gs("G0").stroke_rgb(color).fill_rgb(color).op(&[width.max(0.1)], "w");
                let i = width / 2.0;
                if round {
                    c.ellipse([i, i, vw - i, vh - i]).raw("S");
                } else {
                    c.rect(i, i, vw - width, vh - width).raw("S");
                }
                for (y, x1, x2) in &layout.dividers {
                    c.move_to(*x1, *y).line_to(*x2, *y).raw("S");
                }
                let (asc, desc) = self.font.vertical();
                c.raw("BT");
                for line in &layout.lines {
                    if line.text.is_empty() {
                        continue;
                    }
                    // Centred on the band: the baseline sits so that the
                    // glyphs' middle (between ascent and descent) is at `y`.
                    let baseline = line.y - (asc + desc) * line.size / 2.0;
                    c.raw(&format!("/{RESOURCE_NAME} {} Tf", super::content::num(line.size)));
                    c.op(&[1.0, 0.0, 0.0, 1.0, line.x, baseline], "Tm");
                    let s = self.font.encode(line.text);
                    c.raw(&format!("{s} Tj"));
                }
                c.raw("ET");
                let mut res = Self::gs_resources(opacity, false);
                res.set("Font", dictionary! { RESOURCE_NAME => font });
                let ap = self.form([0.0, 0.0, vw, vh], Some(rotation_matrix(rot)), res, c);
                d.set("Contents", text_string(&a.text));
                d.set("Name", SEAL_NAME);
                if rot != 0 {
                    d.set("Rotate", rot as i64);
                }
                style.font_size = Some(size);
                style.rotation = rot;
                style.seal = Some(if round { "round" } else { "box" }.into());
                ("Stamp", r, ap)
            }
            AnnotKind::Image => {
                let r = valid_rect(a.rect)?;
                let id = a.image.ok_or("画像がありません")?;
                let img = self.images.get(id).ok_or("画像が見つかりません。もう一度置いてください")?;
                let xobj = image_xobject(self.doc, &img)?;
                let rot = a.rotation % 360;
                let (vw, vh) =
                    if rot == 90 || rot == 270 { (r[3] - r[1], r[2] - r[0]) } else { (r[2] - r[0], r[3] - r[1]) };
                let mut c = Content::new();
                c.gs("G0").save().op(&[vw, 0.0, 0.0, vh, 0.0, 0.0], "cm").raw("/Im0 Do").restore();
                let mut res = Self::gs_resources(opacity, false);
                res.set("XObject", dictionary! { "Im0" => xobj });
                let ap = self.form([0.0, 0.0, vw, vh], Some(rotation_matrix(rot)), res, c);
                if rot != 0 {
                    d.set("Rotate", rot as i64);
                }
                style.rotation = rot;
                // Not one of the standard stamp names: viewers use the appearance.
                d.set("Name", "PDFOneImage");
                ("Stamp", r, ap)
            }
        };
        d.set("Subtype", subtype);
        d.set("Rect", rect_array(rect));
        d.set("AP", dictionary! { "N" => ap });
        if let Ok(json) = serde_json::to_string(&style) {
            d.set(STYLE_KEY, Object::string_literal(json));
        }
        Ok(self.doc.add_object(d))
    }
}

fn darker(c: Rgb) -> Rgb {
    c.map(|v| v * 0.6)
}

/// A line of a seal, placed: its left edge and the middle of its band.
pub struct SealLine<'a> {
    pub text: &'a str,
    pub size: f64,
    pub x: f64,
    pub y: f64,
}

pub struct SealLayout<'a> {
    pub lines: Vec<SealLine<'a>>,
    /// Horizontal lines across the seal: y, from x1 to x2.
    pub dividers: Vec<(f64, f64, f64)>,
}

/// Where a seal's words go, in its box of `w` × `h` (the same rule as
/// src/lib/seal.ts, so the screen matches the file). A round seal has
/// three bands, the middle one the date's; a box has its lines stacked.
/// A line wider than its band is shrunk to fit.
pub fn seal_layout<'a>(
    round: bool,
    w: f64,
    h: f64,
    size: f64,
    border: f64,
    lines: &[&'a str],
    measure: impl Fn(&str, f64) -> f64,
) -> SealLayout<'a> {
    let pad = w.min(h) * SEAL_PADDING + border;
    let fit = |text: &str, max: f64| -> f64 {
        let at = measure(text, size);
        if at <= max || at <= 0.0 {
            size
        } else {
            (size * max / at).max(4.0)
        }
    };
    let mut out = SealLayout { lines: Vec::new(), dividers: Vec::new() };
    if round {
        let (cx, cy) = (w / 2.0, h / 2.0);
        let (rx, ry) = (w / 2.0 - border / 2.0, h / 2.0 - border / 2.0);
        // The middle band's height is the date's line, with some air.
        let band = size * LINE_HEIGHT * 1.1;
        let ys = [cy + band / 2.0, cy - band / 2.0];
        // Chord of the ellipse at height y: how wide the seal is there.
        let chord = |y: f64| -> f64 {
            let t = ((y - cy) / ry).clamp(-1.0, 1.0);
            rx * (1.0 - t * t).sqrt()
        };
        for y in ys {
            let half = chord(y);
            out.dividers.push((y, cx - half, cx + half));
        }
        let centres = [(cy + band / 2.0 + ry) / 2.0, cy, (cy - band / 2.0 - ry) / 2.0];
        for (i, text) in lines.iter().take(3).enumerate() {
            let y = centres[i];
            let max = (chord(y) * 2.0 - 2.0 * pad).max(1.0);
            let s = fit(text, max);
            let x = cx - measure(text, s) / 2.0;
            out.lines.push(SealLine { text, size: s, x, y });
        }
    } else {
        let n = lines.len().max(1) as f64;
        let lh = size * LINE_HEIGHT;
        let top = h / 2.0 + (n - 1.0) * lh / 2.0;
        let max = (w - 2.0 * pad).max(1.0);
        for (i, text) in lines.iter().enumerate() {
            let s = fit(text, max);
            let x = w / 2.0 - measure(text, s) / 2.0;
            out.lines.push(SealLine { text, size: s, x, y: top - i as f64 * lh });
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pdf::font::test_font;

    fn writer_doc() -> (Document, ObjectId) {
        let mut doc = Document::with_version("1.7");
        let page = doc.add_object(dictionary! { "Type" => "Page" });
        (doc, page)
    }

    fn ap_content(doc: &Document, annot: ObjectId) -> String {
        let d = doc.get_dictionary(annot).unwrap();
        let ap = d.get(b"AP").unwrap().as_dict().unwrap().get(b"N").unwrap().as_reference().unwrap();
        let s = doc.get_object(ap).unwrap().as_stream().unwrap();
        String::from_utf8(s.decompressed_content().unwrap_or_else(|_| s.content.clone())).unwrap()
    }

    #[test]
    fn every_kind_gets_an_appearance() {
        let (mut doc, page) = writer_doc();
        let mut font = Embedder::new(Some(test_font()));
        let mut images = ImageStore::default();
        let img = images.add(crate::pdf::image::read_image(crate::pdf::image::test_png()).unwrap());
        let base = Annot { id: "pdfe-1".into(), color: "#ff0000".into(), ..Default::default() };
        let cases = [
            Annot {
                kind: AnnotKind::Highlight,
                quads: vec![[10.0, 20.0, 50.0, 20.0, 10.0, 10.0, 50.0, 10.0]],
                ..base.clone()
            },
            Annot {
                kind: AnnotKind::Underline,
                quads: vec![[10.0, 20.0, 50.0, 20.0, 10.0, 10.0, 50.0, 10.0]],
                ..base.clone()
            },
            Annot { kind: AnnotKind::Ink, paths: vec![vec![1.0, 1.0, 5.0, 5.0, 9.0, 1.0]], width: 2.0, ..base.clone() },
            Annot {
                kind: AnnotKind::Rect,
                rect: Some([10.0, 10.0, 60.0, 40.0]),
                fill: Some("#00ff00".into()),
                ..base.clone()
            },
            Annot { kind: AnnotKind::Ellipse, rect: Some([10.0, 10.0, 60.0, 40.0]), ..base.clone() },
            Annot { kind: AnnotKind::Arrow, line: Some([10.0, 10.0, 100.0, 50.0]), ..base.clone() },
            Annot {
                kind: AnnotKind::Text,
                rect: Some([100.0, 100.0, 200.0, 140.0]),
                text: "Hello\nworld".into(),
                width: 0.0,
                rotation: 90,
                ..base.clone()
            },
            Annot {
                kind: AnnotKind::Note,
                rect: Some([10.0, 10.0, 30.0, 30.0]),
                contents: "メモ".into(),
                ..base.clone()
            },
            Annot { kind: AnnotKind::Image, rect: Some([10.0, 10.0, 50.0, 50.0]), image: Some(img), ..base.clone() },
            Annot {
                kind: AnnotKind::Seal,
                rect: Some([300.0, 300.0, 368.0, 368.0]),
                text: "営業部\n2026.10.13\n鈴木".into(),
                seal: Some("round".into()),
                font_size: 9.0,
                width: 1.5,
                ..base.clone()
            },
        ];
        let mut w = Writer { doc: &mut doc, font: &mut font, images: &images };
        let ids: Vec<ObjectId> = cases.iter().map(|a| w.write(page, a).unwrap()).collect();
        font.finish(&mut doc).unwrap();
        let subtypes: Vec<String> = ids
            .iter()
            .map(|id| {
                String::from_utf8(doc.get_dictionary(*id).unwrap().get(b"Subtype").unwrap().as_name().unwrap().to_vec())
                    .unwrap()
            })
            .collect();
        assert_eq!(
            subtypes,
            ["Highlight", "Underline", "Ink", "Square", "Circle", "Line", "FreeText", "Text", "Stamp", "Stamp"]
        );
        // The seal: a frame, two dividers and three words in the embedded font.
        let seal = ap_content(&doc, ids[9]);
        assert_eq!(seal.matches(" Tj").count(), 3, "{seal}");
        assert_eq!(seal.lines().filter(|l| *l == "S").count(), 3, "{seal}");
        let sd = doc.get_dictionary(ids[9]).unwrap();
        assert_eq!(sd.get(b"Name").unwrap().as_name().unwrap(), SEAL_NAME.as_bytes());
        assert_eq!(crate::pdf::get_text(sd, b"Contents"), "営業部\n2026.10.13\n鈴木");
        assert!(ap_content(&doc, ids[0]).contains(" f"));
        assert!(ap_content(&doc, ids[3]).trim_end().ends_with('B'));
        // The text box's two lines, in the embedded font.
        let text = ap_content(&doc, ids[6]);
        assert_eq!(text.matches(" Tj").count(), 2, "{text}");
        assert!(text.contains("/PDFE 12 Tf"));
        let ft = doc.get_dictionary(ids[6]).unwrap();
        assert_eq!(ft.get(b"Rotate").unwrap().as_i64().unwrap(), 90);
        // The bubble's comment.
        let note = doc.get_dictionary(ids[7]).unwrap();
        assert_eq!(crate::pdf::get_text(note, b"Contents"), "メモ");
    }

    #[test]
    fn bad_positions_are_refused() {
        let (mut doc, page) = writer_doc();
        let mut font = Embedder::new(None);
        let images = ImageStore::default();
        let mut w = Writer { doc: &mut doc, font: &mut font, images: &images };
        let a = Annot { kind: AnnotKind::Rect, rect: Some([10.0, 10.0, 5.0, 40.0]), ..Default::default() };
        assert!(w.write(page, &a).is_err());
        let a =
            Annot { kind: AnnotKind::Image, rect: Some([0.0, 0.0, 5.0, 5.0]), image: Some(9), ..Default::default() };
        assert!(w.write(page, &a).is_err());
    }

    #[test]
    fn seal_words_fit_their_bands() {
        let measure = |t: &str, s: f64| t.chars().count() as f64 * s;
        let l = seal_layout(true, 68.0, 68.0, 9.0, 1.5, &["営業部", "2026.10.13", "鈴木"], measure);
        assert_eq!(l.lines.len(), 3);
        assert_eq!(l.dividers.len(), 2);
        // The date is as wide as the middle band allows, no wider.
        let date = &l.lines[1];
        assert!(date.size < 9.0 && date.size >= 4.0, "{}", date.size);
        assert!(date.x > 0.0 && date.x + measure(date.text, date.size) < 68.0);
        // Centred: the middle line sits on the middle of the box.
        assert!((date.y - 34.0).abs() < 0.01);
        let b = seal_layout(false, 80.0, 24.0, 14.0, 1.0, &["承認済み"], measure);
        assert_eq!(b.lines.len(), 1);
        assert!(b.dividers.is_empty());
        assert!((b.lines[0].y - 12.0).abs() < 0.01);
    }
}

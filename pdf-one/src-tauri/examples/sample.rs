//! Writes a PDF with one of each annotation, a Japanese text box and the
//! form values given, without the app: to check the output in other viewers
//! (Acrobat, Edge, Preview, pdftoppm).
//!
//! cargo run --example sample -- <in.pdf> <out.pdf> [picture.png]
//!
//! Without <in.pdf> ("-"), the pages are blank A4.

use pdf_one_lib::pdf::compose::{compose, Input, PageSpec};
use pdf_one_lib::pdf::image::{read_image, ImageStore};
use pdf_one_lib::pdf::open::open_bytes;
use pdf_one_lib::pdf::{font, Annot, AnnotKind};
use std::collections::HashMap;
use std::sync::Arc;

fn main() -> Result<(), String> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let [input, output, rest @ ..] = args.as_slice() else {
        return Err("cargo run --example sample -- <in.pdf|-> <out.pdf> [picture.png]".into());
    };
    let mut images = ImageStore::default();
    let mut sources = HashMap::new();
    let mut pages = Vec::new();
    if input != "-" {
        let opened = open_bytes(std::fs::read(input).map_err(|e| e.to_string())?, &mut images)?;
        let doc = opened.doc.ok_or_else(|| opened.read_only.unwrap_or_default())?;
        let n = doc.get_pages().len();
        sources.insert(1, Arc::new(doc));
        pages.extend((0..n).map(|i| PageSpec { source: Some(1), index: i, rotate: 0, size: None, annots: vec![] }));
    } else {
        pages.push(PageSpec { source: None, index: 0, rotate: 0, size: Some([595.0, 842.0]), annots: vec![] });
    }
    let base =
        Annot {
            id: "pdfe-sample".into(), author: "サンプル".into(), color: "#d62828".into(), ..Default::default()
        };
    let mut annots = vec![
        Annot {
            kind: AnnotKind::Seal,
            rect: Some([400.0, 700.0, 468.0, 768.0]),
            text: "営業部\n2026.10.13\n鈴木".into(),
            seal: Some("round".into()),
            font_size: 9.0,
            width: 1.5,
            ..base.clone()
        },
        Annot {
            kind: AnnotKind::Seal,
            rect: Some([400.0, 650.0, 490.0, 677.0]),
            text: "承認済み".into(),
            seal: Some("box".into()),
            font_size: 16.0,
            width: 1.5,
            ..base.clone()
        },
        Annot {
            kind: AnnotKind::Text,
            rect: Some([60.0, 700.0, 330.0, 780.0]),
            text: "見積書を確認しました。\n金額は ¥1,234,500 です。".into(),
            font_size: 14.0,
            width: 1.0,
            fill: Some("#fff6bf".into()),
            color: "#1d3557".into(),
            ..base.clone()
        },
        Annot {
            kind: AnnotKind::Highlight,
            quads: vec![[60.0, 680.0, 300.0, 680.0, 60.0, 664.0, 300.0, 664.0]],
            color: "#ffd400".into(),
            opacity: 0.5,
            ..base.clone()
        },
        Annot { kind: AnnotKind::Rect, rect: Some([60.0, 560.0, 200.0, 640.0]), width: 2.0, ..base.clone() },
        Annot {
            kind: AnnotKind::Ellipse,
            rect: Some([230.0, 560.0, 370.0, 640.0]),
            width: 2.0,
            fill: Some("#a8dadc".into()),
            ..base.clone()
        },
        Annot { kind: AnnotKind::Arrow, line: Some([400.0, 560.0, 520.0, 640.0]), width: 2.0, ..base.clone() },
        Annot {
            kind: AnnotKind::Ink,
            paths: vec![(0..40).flat_map(|i| [60.0 + i as f64 * 6.0, 500.0 + (i as f64 / 3.0).sin() * 20.0]).collect()],
            width: 3.0,
            color: "#2a9d8f".into(),
            ..base.clone()
        },
        Annot {
            kind: AnnotKind::Note,
            rect: Some([400.0, 700.0, 420.0, 720.0]),
            contents: "付箋のコメント".into(),
            ..base.clone()
        },
        Annot {
            kind: AnnotKind::Text,
            rect: Some([450.0, 300.0, 490.0, 500.0]),
            text: "回転した文字".into(),
            rotation: 90,
            width: 0.0,
            ..base.clone()
        },
    ];
    if let Some(png) = rest.first() {
        let img = images.add(read_image(std::fs::read(png).map_err(|e| e.to_string())?)?);
        annots.push(Annot {
            kind: AnnotKind::Image,
            rect: Some([400.0, 380.0, 480.0, 460.0]),
            image: Some(img),
            ..base
        });
    }
    pages[0].annots = annots;
    let font = font::system_font();
    eprintln!("font: {}", font.as_ref().map(|f| f.family.as_str()).unwrap_or("(none)"));
    let bytes = compose(Input { sources: &sources, pages: &pages, forms: &[], font, images: &images })?;
    std::fs::write(output, &bytes).map_err(|e| e.to_string())?;
    eprintln!("{output}: {} bytes", bytes.len());
    Ok(())
}

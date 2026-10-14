//! Tries the text fixing on a real file: lists the lines of text on a page,
//! and with a third argument writes a copy where every editable line has
//! "【直】" put in front of it.
//!
//!     cargo run --example lines -- in.pdf 1 [out.pdf]

use pdf_one_lib::pdf::compose::{compose, Input, PageSpec};
use pdf_one_lib::pdf::font::system_font;
use pdf_one_lib::pdf::image::ImageStore;
use pdf_one_lib::pdf::open::open_bytes;
use pdf_one_lib::pdf::{textedit, Annot, AnnotKind};
use std::collections::HashMap;
use std::sync::Arc;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let (path, page_no) = (&args[1], args[2].parse::<usize>().unwrap());
    let bytes = std::fs::read(path).unwrap();
    let doc = Arc::new(open_bytes(bytes, &mut ImageStore::default()).unwrap().doc.expect("editable"));
    let page = *doc.get_pages().values().nth(page_no - 1).unwrap();
    let lines = textedit::lines(&doc, page).unwrap();
    for l in &lines {
        println!(
            "{} {:>2}pt {:<14} {:?}  [{:.0},{:.0}–{:.0},{:.0}] ops={:?} {}",
            if l.editable { "○" } else { "×" },
            l.size.round(),
            l.font,
            l.text,
            l.rect[0],
            l.rect[1],
            l.rect[2],
            l.rect[3],
            l.ops,
            l.why
        );
    }
    let Some(out) = args.get(3) else { return };
    let annots: Vec<Annot> = lines
        .iter()
        .filter(|l| l.editable)
        .map(|l| Annot {
            id: format!("pdfe-{}", l.ops[0]),
            kind: AnnotKind::Edit,
            runs: l.ops.clone(),
            text: format!("【直】{}", l.text),
            font_size: l.size,
            color: l.color.clone(),
            rect: Some(l.rect),
            ..Default::default()
        })
        .collect();
    let mut sources = HashMap::new();
    sources.insert(1, doc);
    let specs = vec![PageSpec { source: Some(1), index: page_no - 1, rotate: 0, size: None, annots }];
    let images = ImageStore::default();
    let bytes =
        compose(Input { sources: &sources, pages: &specs, forms: &[], font: system_font(), images: &images }).unwrap();
    std::fs::write(out, bytes).unwrap();
    println!("→ {out}");
}

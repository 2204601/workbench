//! The app's PDF code (src-tauri/src/pdf/) in the browser.
//!
//! Each function stands for one Tauri command of src-tauri/src/commands.rs,
//! minus the files: the page hands over bytes and gets bytes back. The
//! documents and pictures stay here between calls, as in `AppState`.
//! src/dev/wasmBackend.ts answers the app's commands with these.

#[allow(dead_code)]
#[path = "../../src-tauri/src/pdf/mod.rs"]
mod pdf;

use lopdf::Document;
use pdf::compose::{self, FormEntry, PageSpec};
use pdf::font::FontFile;
use pdf::image::{read_image, ImageStore};
use pdf::open::{open_bytes, PageAnnot};
use pdf::textedit;
use serde::{Deserialize, Serialize};
use std::cell::RefCell;
use std::collections::HashMap;
use std::sync::Arc;
use wasm_bindgen::prelude::*;

#[derive(Default)]
struct State {
    next: u32,
    docs: HashMap<u32, Arc<Document>>,
    views: HashMap<u32, Vec<u8>>,
    images: ImageStore,
    font: Option<Arc<FontFile>>,
}

thread_local! {
    static STATE: RefCell<State> = RefCell::new(State::default());
}

fn with<T>(f: impl FnOnce(&mut State) -> T) -> T {
    STATE.with(|s| f(&mut s.borrow_mut()))
}

fn json<T: Serialize>(v: &T) -> Result<String, JsValue> {
    serde_json::to_string(v).map_err(|e| JsValue::from_str(&e.to_string()))
}

/// The Japanese font text is written in. The browser can't read the OS's
/// fonts, so the page fetches one and hands it over. False: it can't be used
/// (no Japanese, not embeddable, or a kind the subsetter can't do).
#[wasm_bindgen(js_name = setFont)]
pub fn set_font(bytes: Vec<u8>, family: &str) -> bool {
    let font = FontFile::from_bytes(bytes, 0, family, true).map(Arc::new);
    let ok = font.is_some();
    with(|s| s.font = font);
    ok
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Opened {
    id: u32,
    read_only: Option<String>,
    signed: bool,
    annots: Vec<PageAnnot>,
}

/// `open_pdf`: what the page needs to know; the bytes for pdf.js come from `takeView`.
#[wasm_bindgen]
pub fn open(bytes: Vec<u8>) -> Result<String, JsValue> {
    let mut images = ImageStore::default();
    let opened = open_bytes(bytes, &mut images).map_err(|e| JsValue::from_str(&e))?;
    with(|s| {
        s.images.merge(images);
        s.next += 1;
        let id = s.next;
        if let Some(doc) = opened.doc {
            s.docs.insert(id, Arc::new(doc));
        }
        s.views.insert(id, opened.view_bytes);
        json(&Opened { id, read_only: opened.read_only, signed: opened.signed, annots: opened.annots })
    })
}

/// `pdf_view_bytes`: once per document.
#[wasm_bindgen(js_name = takeView)]
pub fn take_view(id: u32) -> Result<Vec<u8>, JsValue> {
    with(|s| s.views.remove(&id)).ok_or_else(|| JsValue::from_str("PDF がもう閉じられています"))
}

#[wasm_bindgen]
pub fn close(id: u32) {
    with(|s| {
        s.docs.remove(&id);
        s.views.remove(&id);
    });
}

/// `text_lines`
#[wasm_bindgen(js_name = textLines)]
pub fn text_lines(id: u32, index: usize) -> Result<String, JsValue> {
    let doc = with(|s| s.docs.get(&id).cloned()).ok_or_else(|| JsValue::from_str("PDF がもう閉じられています"))?;
    let page = *doc.get_pages().values().nth(index).ok_or_else(|| JsValue::from_str("ページが見つかりません"))?;
    json(&textedit::lines(&doc, page).map_err(|e| JsValue::from_str(&e))?)
}

#[derive(Deserialize)]
struct ComposeRequest {
    pages: Vec<PageSpec>,
    #[serde(default)]
    forms: Vec<FormEntry>,
}

/// `save_pdf` and `compose_pdf`: the file as it would be saved.
#[wasm_bindgen]
pub fn compose(request: &str) -> Result<Vec<u8>, JsValue> {
    let r: ComposeRequest = serde_json::from_str(request).map_err(|e| JsValue::from_str(&e.to_string()))?;
    with(|s| {
        if r.pages.iter().any(|p| p.source.is_some_and(|id| !s.docs.contains_key(&id))) {
            return Err("表示だけの PDF のページは保存できません".to_string());
        }
        compose::compose(compose::Input {
            sources: &s.docs,
            pages: &r.pages,
            forms: &r.forms,
            font: s.font.clone(),
            images: &s.images,
        })
    })
    .map_err(|e| JsValue::from_str(&e))
}

#[derive(Serialize)]
struct ImageInfo {
    id: u32,
    width: u32,
    height: u32,
}

/// `add_image_bytes`
#[wasm_bindgen(js_name = addImage)]
pub fn add_image(bytes: Vec<u8>) -> Result<String, JsValue> {
    let img = read_image(bytes).map_err(|e| JsValue::from_str(&e))?;
    let (width, height) = (img.width, img.height);
    let id = with(|s| s.images.add(img));
    json(&ImageInfo { id, width, height })
}

/// `image_bytes`
#[wasm_bindgen(js_name = imageBytes)]
pub fn image_bytes(id: u32) -> Result<Vec<u8>, JsValue> {
    with(|s| s.images.get(id)).map(|i| i.bytes.clone()).ok_or_else(|| JsValue::from_str("画像が見つかりません"))
}

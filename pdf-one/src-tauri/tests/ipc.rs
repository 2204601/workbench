//! The commands called through IPC with the arguments the frontend sends
//! (src/lib/api.ts): argument names, camelCase fields and answers checked
//! end to end, on Tauri's mock runtime. Opening, editing as the screen
//! would, saving, and opening the result again.

use serde_json::{json, Value};
use std::path::Path;
use tauri::ipc::{CallbackFn, InvokeBody, InvokeResponseBody};
use tauri::test::{get_ipc_response, mock_builder, mock_context, noop_assets, INVOKE_KEY};
use tauri::webview::InvokeRequest;
use tauri::{App, WebviewWindow, WebviewWindowBuilder};

#[cfg(windows)]
const LOCAL: &str = "http://tauri.localhost";
#[cfg(not(windows))]
const LOCAL: &str = "tauri://localhost";

fn next() -> u128 {
    static N: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);
    N.fetch_add(1, std::sync::atomic::Ordering::Relaxed) as u128
}

struct Ui {
    _app: App<tauri::test::MockRuntime>,
    webview: WebviewWindow<tauri::test::MockRuntime>,
}

fn ui() -> Ui {
    let mut context = mock_context(noop_assets());
    context.config_mut().identifier =
        format!("dev.workbench.pdf-one.test-{}", std::process::id() as u128 * 1000 + next());
    let app = pdf_one_lib::with_commands(mock_builder()).build(context).expect("app");
    let webview = WebviewWindowBuilder::new(&app, "main", Default::default()).build().expect("window");
    Ui { _app: app, webview }
}

impl Ui {
    fn invoke(&self, cmd: &str, body: InvokeBody) -> Result<InvokeResponseBody, Value> {
        get_ipc_response(
            &self.webview,
            InvokeRequest {
                cmd: cmd.into(),
                callback: CallbackFn(0),
                error: CallbackFn(1),
                url: LOCAL.parse().unwrap(),
                body,
                headers: Default::default(),
                invoke_key: INVOKE_KEY.to_string(),
            },
        )
    }

    fn call(&self, cmd: &str, args: Value) -> Result<Value, Value> {
        self.invoke(cmd, InvokeBody::Json(args)).map(|b| b.deserialize::<Value>().unwrap())
    }

    fn raw(&self, cmd: &str, args: Value) -> Vec<u8> {
        match self.invoke(cmd, InvokeBody::Json(args)).unwrap() {
            InvokeResponseBody::Raw(b) => b.to_vec(),
            InvokeResponseBody::Json(j) => panic!("expected bytes, got {j}"),
        }
    }
}

/// A PDF of `n` letter-size pages with a line of text each, written by hand.
fn sample_pdf(path: &Path, n: usize) {
    let mut objects: Vec<String> = vec![String::new(), String::new()];
    objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>".into());
    let mut kids = Vec::new();
    for i in 0..n {
        let text = format!("BT /F1 24 Tf 72 700 Td (Page {}) Tj ET", i + 1);
        objects.push(format!("<< /Length {} >>\nstream\n{text}\nendstream", text.len()));
        let content = objects.len();
        objects.push(format!(
            "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents {content} 0 R >>"
        ));
        kids.push(format!("{} 0 R", objects.len()));
    }
    objects[0] = "<< /Type /Catalog /Pages 2 0 R >>".into();
    objects[1] = format!("<< /Type /Pages /Kids [{}] /Count {n} >>", kids.join(" "));
    let mut out = String::from("%PDF-1.7\n");
    let mut offsets = Vec::new();
    for (i, o) in objects.iter().enumerate() {
        offsets.push(out.len());
        out.push_str(&format!("{} 0 obj\n{o}\nendobj\n", i + 1));
    }
    let xref = out.len();
    out.push_str(&format!("xref\n0 {}\n0000000000 65535 f \n", objects.len() + 1));
    for o in offsets {
        out.push_str(&format!("{o:010} 00000 n \n"));
    }
    out.push_str(&format!("trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n", objects.len() + 1));
    std::fs::write(path, out).unwrap();
}

/// An annotation as src/lib/api.ts sends it (every field present).
fn annot(kind: &str, extra: Value) -> Value {
    let mut a = json!({
        "id": format!("pdfe-{kind}"),
        "kind": kind,
        "color": "#e5383b",
        "opacity": 1,
        "width": 2,
        "fill": null,
        "rect": null,
        "quads": [],
        "paths": [],
        "line": null,
        "text": "",
        "lines": [],
        "fontSize": 12,
        "rotation": 0,
        "image": null,
        "seal": null,
        "contents": "",
        "author": "テスト",
        "modified": "",
    });
    a.as_object_mut().unwrap().extend(extra.as_object().unwrap().clone());
    a
}

#[test]
fn open_edit_save_and_open_again() {
    let tmp = tempfile::tempdir().unwrap();
    let input = tmp.path().join("見積書.pdf");
    let other = tmp.path().join("添付.pdf");
    sample_pdf(&input, 3);
    sample_pdf(&other, 1);
    let ui = ui();

    let a = ui.call("open_pdf", json!({ "path": input })).unwrap();
    assert_eq!(a["name"], "見積書.pdf");
    assert_eq!(a["readOnly"], Value::Null);
    assert_eq!(a["annots"], json!([]));
    let a_id = a["id"].as_u64().unwrap();
    let view = ui.raw("pdf_view_bytes", json!({ "id": a_id }));
    assert!(view.starts_with(b"%PDF-"));
    // Handed over once.
    assert!(ui.call("pdf_view_bytes", json!({ "id": a_id })).is_err());

    let b = ui.call("open_pdf", json!({ "path": other })).unwrap();
    let b_id = b["id"].as_u64().unwrap();

    // A seal pasted from the clipboard (raw bytes, as api.addImageBytes sends).
    let img = ui.invoke("add_image_bytes", InvokeBody::Raw(image_png())).unwrap().deserialize::<Value>().unwrap();
    assert_eq!(img["width"], 2);

    // Page 3 first and turned, a page of the other file, a blank page; page 2 left out.
    let out = tmp.path().join("見積書_編集.pdf");
    let pages = json!([
        { "source": a_id, "index": 2, "rotate": 90, "size": null, "annots": [
            annot("text", json!({ "rect": [100, 600, 300, 640], "text": "確認済み", "lines": ["確認済み"], "width": 0, "rotation": 90 })),
            annot("highlight", json!({ "quads": [[72, 720, 200, 720, 72, 695, 200, 695]], "color": "#ffd400", "opacity": 0.4 })),
        ]},
        { "source": b_id, "index": 0, "rotate": 0, "size": null, "annots": [
            annot("image", json!({ "rect": [400, 100, 480, 180], "image": img["id"] })),
            annot("seal", json!({ "rect": [100, 100, 168, 168], "seal": "round", "text": "営業部\n2026.10.13\n鈴木", "fontSize": 9, "width": 1.5, "color": "#d62828" })),
        ]},
        { "source": null, "index": 0, "rotate": 0, "size": [595.276, 841.89], "annots": [
            annot("ink", json!({ "paths": [[10, 10, 50, 60, 90, 10]] })),
            annot("note", json!({ "rect": [300, 300, 320, 320], "contents": "ここを直してください" })),
        ]},
        { "source": a_id, "index": 0, "rotate": 0, "size": null, "annots": [] },
    ]);
    let saved = ui.call("save_pdf", json!({ "request": { "path": out, "pages": pages, "forms": [] } })).unwrap();
    assert_eq!(saved["backup"], Value::Null);
    assert!(saved["size"].as_u64().unwrap() > 1000);

    let c = ui.call("open_pdf", json!({ "path": out })).unwrap();
    let kinds: Vec<(u64, &str)> = c["annots"]
        .as_array()
        .unwrap()
        .iter()
        .map(|p| (p["page"].as_u64().unwrap(), p["annot"]["kind"].as_str().unwrap()))
        .collect();
    assert_eq!(kinds, [(0, "text"), (0, "highlight"), (1, "image"), (1, "seal"), (2, "ink"), (2, "note")]);
    let seal = &c["annots"][3]["annot"];
    assert_eq!(seal["text"], "営業部\n2026.10.13\n鈴木");
    assert_eq!(seal["seal"], "round");
    assert_eq!(seal["fontSize"], 9.0);
    let text = &c["annots"][0]["annot"];
    assert_eq!(text["text"], "確認済み");
    assert_eq!(text["rotation"], 90);
    assert_eq!(text["author"], "テスト");
    assert_eq!(c["annots"][5]["annot"]["contents"], "ここを直してください");
    let doc = lopdf::Document::load(&out).unwrap();
    let p = doc.get_pages();
    assert_eq!(p.len(), 4);
    let first = doc.get_dictionary(p[&1]).unwrap();
    assert_eq!(first.get(b"Rotate").unwrap().as_i64().unwrap(), 90);
    assert!(String::from_utf8_lossy(&doc.get_page_content(p[&1])).contains("Page 3"));
    assert!(String::from_utf8_lossy(&doc.get_page_content(p[&2])).contains("Page 1"));

    // The same pages as bytes, for printing: a PDF with the annotations in it.
    let printed = ui.raw("compose_pdf", json!({ "request": { "pages": pages, "forms": [] } }));
    assert!(printed.starts_with(b"%PDF-"));
    assert_eq!(lopdf::Document::load_mem(&printed).unwrap().get_pages().len(), 4);

    // Saving over a file keeps the old one in the backups.
    let again = ui
        .call("save_pdf", json!({ "request": { "path": out, "pages": [{ "source": a_id, "index": 1 }], "forms": [] } }))
        .unwrap();
    let backup = again["backup"].as_str().unwrap();
    assert!(Path::new(backup).is_file());
    assert_eq!(lopdf::Document::load(&out).unwrap().get_pages().len(), 1);

    ui.call("close_pdf", json!({ "id": a_id })).unwrap();
    let e = ui
        .call("save_pdf", json!({ "request": { "path": out, "pages": [{ "source": a_id, "index": 0 }] } }))
        .unwrap_err();
    assert!(e.as_str().unwrap().contains("保存できません") || e.as_str().unwrap().contains("閉じられて"), "{e}");
}

#[test]
fn errors_read_as_sentences() {
    let tmp = tempfile::tempdir().unwrap();
    let ui = ui();
    let text = tmp.path().join("memo.pdf");
    std::fs::write(&text, "not a pdf").unwrap();
    let e = ui.call("open_pdf", json!({ "path": text })).unwrap_err();
    assert!(e.as_str().unwrap().contains("PDF ファイルではありません"), "{e}");
    let e = ui.call("open_pdf", json!({ "path": tmp.path().join("none.pdf") })).unwrap_err();
    assert!(e.as_str().unwrap().contains("開けませんでした"), "{e}");
    let e = ui.call("save_pdf", json!({ "request": { "path": tmp.path().join("x.txt"), "pages": [] } })).unwrap_err();
    assert!(e.as_str().unwrap().contains(".pdf"), "{e}");
    let e = ui.invoke("add_image_bytes", InvokeBody::Raw(b"GIF89a".to_vec())).unwrap_err();
    assert!(e.as_str().unwrap().contains("PNG"), "{e}");
}

#[test]
fn settings_and_stamps() {
    let tmp = tempfile::tempdir().unwrap();
    let ui = ui();
    let s = ui.call("get_app_settings", json!({})).unwrap();
    assert_eq!(s["autoUpdate"], true);
    assert_eq!(s["author"], "");
    let mut s = s.clone();
    s["author"] = json!("山田");
    ui.call("set_app_settings", json!({ "settings": s })).unwrap();
    assert_eq!(ui.call("get_app_settings", json!({})).unwrap()["author"], "山田");

    let png = tmp.path().join("社印.png");
    std::fs::write(&png, image_png()).unwrap();
    let stamp = ui.call("add_stamp", json!({ "path": png })).unwrap();
    assert_eq!(stamp["name"], "社印");
    let list = ui.call("list_stamps", json!({})).unwrap();
    assert_eq!(list.as_array().unwrap().len(), 1);
    let img = ui.call("use_stamp", json!({ "id": stamp["id"] })).unwrap();
    let bytes = ui.raw("image_bytes", json!({ "id": img["id"] }));
    assert!(bytes.starts_with(b"\x89PNG"));
    ui.call("remove_stamp", json!({ "id": stamp["id"] })).unwrap();
    assert_eq!(ui.call("list_stamps", json!({})).unwrap(), json!([]));
    assert!(ui.call("use_stamp", json!({ "id": "../settings.json" })).is_err());
}

/// A 2 × 1 PNG: a red pixel and a clear one.
fn image_png() -> Vec<u8> {
    let img = image::RgbaImage::from_raw(2, 1, vec![220, 30, 30, 255, 0, 0, 0, 0]).unwrap();
    let mut out = Vec::new();
    img.write_to(&mut std::io::Cursor::new(&mut out), image::ImageFormat::Png).unwrap();
    out
}

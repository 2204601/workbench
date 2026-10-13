//! The commands called through IPC with the arguments the frontend sends
//! (src/lib/api.ts): argument names, camelCase fields and answers checked
//! end to end, on Tauri's mock runtime.

use serde_json::{json, Value};
use std::fs;
use tauri::ipc::{CallbackFn, InvokeBody};
use tauri::test::{get_ipc_response, mock_builder, mock_context, noop_assets, INVOKE_KEY};
use tauri::webview::InvokeRequest;
use tauri::{App, WebviewWindow, WebviewWindowBuilder};

/// The app's own page, which may call its commands.
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
    // Its own app folders, apart from other tests.
    context.config_mut().identifier =
        format!("dev.workbench.disk-analyzer.test-{}", std::process::id() as u128 * 1000 + next());
    let app = disk_analyzer_lib::with_commands(mock_builder()).build(context).expect("app");
    let webview = WebviewWindowBuilder::new(&app, "main", Default::default()).build().expect("window");
    Ui { _app: app, webview }
}

impl Ui {
    fn call(&self, cmd: &str, args: Value) -> Result<Value, Value> {
        get_ipc_response(
            &self.webview,
            InvokeRequest {
                cmd: cmd.into(),
                callback: CallbackFn(0),
                error: CallbackFn(1),
                url: LOCAL.parse().unwrap(),
                body: InvokeBody::Json(args),
                headers: Default::default(),
                invoke_key: INVOKE_KEY.to_string(),
            },
        )
        .map(|b| b.deserialize::<Value>().unwrap())
    }
}

fn write(path: &std::path::Path, bytes: usize) {
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, vec![b'x'; bytes]).unwrap();
}

#[test]
fn scan_then_look_around() {
    let tmp = tempfile::tempdir().unwrap();
    let r = tmp.path();
    write(&r.join("動画/展示会.mp4"), 90_000);
    write(&r.join("動画/研修.mp4"), 9_000);
    write(&r.join("見積/見積_001.xlsx"), 900);
    for i in 0..20 {
        write(&r.join(format!("見積/小さい_{i:02}.pdf")), 5);
    }
    let ui = ui();

    // Nothing scanned yet.
    assert!(ui.call("folder_info", json!({ "id": 0, "limit": 10 })).is_err());

    let s = ui.call("scan_folder", json!({ "path": r })).unwrap();
    assert_eq!(s["files"], 23);
    assert_eq!(s["dirs"], 3);
    assert_eq!(s["bytes"], 100_000);
    assert_eq!(s["cancelled"], false);
    assert_eq!(s["unreadable"], 0);
    assert_eq!(s["cloudFiles"], 0);
    assert!(s["space"]["total"].as_u64().unwrap() > 0);

    // The list of the folder scanned.
    let f = ui.call("folder_info", json!({ "id": 0, "limit": 10 })).unwrap();
    assert_eq!(f["size"], 100_000);
    assert_eq!(f["parent"], Value::Null);
    let names: Vec<&str> = f["items"].as_array().unwrap().iter().map(|i| i["name"].as_str().unwrap()).collect();
    assert_eq!(names, ["動画", "見積"]);
    let video = f["items"][0]["id"].as_u64().unwrap();

    // What a chart draws: the twenty small PDFs fold into one item.
    let v = ui.call("view_tree", json!({ "id": 0, "depth": 3, "minShare": 0.001 })).unwrap();
    let estimates = &v["children"][1];
    assert_eq!(estimates["name"], "見積");
    let kids = estimates["children"].as_array().unwrap();
    assert_eq!(kids.len(), 2);
    assert_eq!(kids[1]["id"], Value::Null);
    assert_eq!(kids[1]["folded"], 20);

    // Into a folder, and its path.
    let f = ui.call("folder_info", json!({ "id": video, "limit": 1 })).unwrap();
    assert_eq!(f["crumbs"].as_array().unwrap().len(), 2);
    assert_eq!(f["more"], 1);
    assert_eq!(f["moreSize"], 9_000);
    let file = f["items"][0]["id"].as_u64().unwrap();
    let p = ui.call("item_path", json!({ "id": file })).unwrap();
    assert_eq!(p.as_str().unwrap(), r.join("動画").join("展示会.mp4").display().to_string());

    // Back to the start: the result is let go.
    ui.call("close_scan", json!({})).unwrap();
    assert!(ui.call("view_tree", json!({ "id": 0, "depth": 1, "minShare": 0.0 })).is_err());
}

#[test]
fn a_missing_folder_is_an_error_that_reads() {
    let ui = ui();
    let e = ui.call("scan_folder", json!({ "path": "/no/such/folder" })).unwrap_err();
    assert!(e.as_str().unwrap().contains("見つかりません"), "{e}");
}

#[test]
fn places_and_settings() {
    let ui = ui();
    let places = ui.call("list_places", json!({})).unwrap();
    let kinds: Vec<&str> = places.as_array().unwrap().iter().map(|p| p["kind"].as_str().unwrap()).collect();
    assert!(kinds.contains(&"drive"));
    assert_eq!(kinds.last(), Some(&"home"));

    let s = ui.call("get_app_settings", json!({})).unwrap();
    assert_eq!(s["autoUpdate"], true);
}

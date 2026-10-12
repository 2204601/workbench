//! The commands called through IPC with the arguments the frontend sends
//! (src/lib/api.ts): argument names, camelCase fields and answers checked
//! end to end, on Tauri's mock runtime.

use serde_json::{json, Value};
use std::fs;
use tauri::ipc::{CallbackFn, InvokeBody};
use tauri::test::{get_ipc_response, mock_builder, mock_context, noop_assets, INVOKE_KEY};
use tauri::webview::InvokeRequest;
use tauri::{App, Manager, WebviewWindow, WebviewWindowBuilder};

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
    // Its own app folders (the journal goes there), apart from other tests.
    context.config_mut().identifier =
        format!("jp.co.jazmf.renamer.test-{}", std::process::id() as u128 * 1000 + next());
    let app = renamer_lib::with_commands(mock_builder()).build(context).expect("app");
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

fn query(extra: Value) -> Value {
    let mut q = json!({
        "exts": [], "contains": "", "sort": "name", "desc": false, "unchecked": [],
        "rule": null, "includeExt": false
    });
    q.as_object_mut().unwrap().extend(extra.as_object().unwrap().clone());
    json!({ "query": q })
}

#[test]
fn read_a_folder_and_list_it() {
    let tmp = tempfile::tempdir().unwrap();
    for name in ["写真10.JPG", "写真2.jpg", "memo.txt", "desktop.ini"] {
        fs::write(tmp.path().join(name), name).unwrap();
    }
    let ui = ui();

    // ⌘O: a new list from a folder.
    let s = ui.call("add_paths", json!({ "paths": [tmp.path()], "replace": true, "includeHidden": false })).unwrap();
    assert_eq!(s["added"], 3);
    assert_eq!(s["excluded"], 1);
    assert_eq!(s["replaced"], true);

    let l = ui.call("list_files", query(json!({}))).unwrap();
    let names: Vec<&str> = l["rows"].as_array().unwrap().iter().map(|r| r["name"].as_str().unwrap()).collect();
    assert_eq!(names, ["memo.txt", "写真2.jpg", "写真10.JPG"]);
    let row = &l["rows"][0];
    for key in ["id", "dir", "name", "newName", "status", "message", "checked", "size", "modified", "created"] {
        assert!(row.get(key).is_some(), "row has {key}: {row}");
    }
    assert_eq!(row["status"], "same");
    assert_eq!(l["summary"]["total"], 3);
    assert_eq!(l["summary"]["folders"][0]["network"], false);

    // Filtered by extension, and unticked rows come back unticked.
    let id = l["rows"][1]["id"].clone();
    let l = ui.call("list_files", query(json!({ "exts": ["jpg"], "unchecked": [id] }))).unwrap();
    assert_eq!(l["rows"].as_array().unwrap().len(), 2);
    assert_eq!(l["rows"][0]["checked"], false);

    // A drop of files only adds to the list.
    let other = tempfile::tempdir().unwrap();
    let extra = other.path().join("追加.pdf");
    fs::write(&extra, "x").unwrap();
    let s = ui.call("add_paths", json!({ "paths": [extra], "replace": null, "includeHidden": false })).unwrap();
    assert_eq!((s["added"].as_u64(), s["replaced"].as_bool()), (Some(1), Some(false)));
    let l = ui.call("list_files", query(json!({}))).unwrap();
    assert_eq!(l["summary"]["total"], 4);
    assert_eq!(l["summary"]["folders"].as_array().unwrap().len(), 2);

    ui.call("clear_files", json!({})).unwrap();
    let l = ui.call("list_files", query(json!({}))).unwrap();
    assert_eq!(l["summary"]["total"], 0);
}

#[test]
fn bad_arguments_are_errors_not_panics() {
    let ui = ui();
    assert!(ui.call("list_files", json!({ "query": { "sort": "colour" } })).is_err());
    assert!(ui.call("add_paths", json!({ "paths": "not a list" })).is_err());
}

/// Each rule in the shape src/lib/ruleDraft.ts `ruleOf` sends it.
#[test]
fn rules_as_the_frontend_sends_them() {
    let tmp = tempfile::tempdir().unwrap();
    for name in ["IMG_0001.JPG", "IMG_0002.JPG", "ｶﾀﾛｸﾞ.pdf"] {
        fs::write(tmp.path().join(name), name).unwrap();
    }
    let ui = ui();
    ui.call("add_paths", json!({ "paths": [tmp.path()], "replace": true, "includeHidden": false })).unwrap();
    let new_names = |rule: Value, include_ext: bool| -> Vec<String> {
        let l = ui.call("list_files", query(json!({ "rule": rule, "includeExt": include_ext }))).unwrap();
        assert!(l["ruleError"].is_null(), "{}", l["ruleError"]);
        l["rows"].as_array().unwrap().iter().map(|r| r["newName"].as_str().unwrap().to_string()).collect()
    };
    let replace = json!({ "kind": "replace", "find": "IMG_", "with": "写真_", "regex": false, "caseSensitive": false, "firstOnly": false });
    assert_eq!(new_names(replace, false), ["写真_0001.JPG", "写真_0002.JPG", "ｶﾀﾛｸﾞ.pdf"]);
    let insert = json!({ "kind": "insert", "text": "済_", "atEnd": false });
    assert_eq!(new_names(insert, false)[2], "済_ｶﾀﾛｸﾞ.pdf");
    let trim = json!({ "kind": "trim", "start": 4, "end": 0 });
    assert_eq!(new_names(trim, false)[0], "0001.JPG");
    let number = json!({ "kind": "template", "template": "{n:3}_{name}", "start": 1, "step": 1 });
    assert_eq!(new_names(number, false), ["001_IMG_0001.JPG", "002_IMG_0002.JPG", "003_ｶﾀﾛｸﾞ.pdf"]);
    let normalize = json!({
        "kind": "normalize", "width": true, "kana": true, "case": "lower", "spaces": true,
        "spaceTo": "", "forbidden": "keep", "nfc": true
    });
    assert_eq!(new_names(normalize, true), ["img_0001.jpg", "img_0002.jpg", "カタログ.pdf"]);

    // A rule that can't be used says why.
    let bad = json!({ "kind": "replace", "find": "(", "with": "", "regex": true, "caseSensitive": false, "firstOnly": false });
    let l = ui.call("list_files", query(json!({ "rule": bad }))).unwrap();
    assert!(l["ruleError"].as_str().unwrap().contains("正規表現"));
}

/// ⌘Enter then ⌘Z, through the commands: files on disk renamed and back,
/// the list following, the journal saying what can be undone.
#[test]
fn run_and_undo() {
    let tmp = tempfile::tempdir().unwrap();
    for name in ["1.jpg", "2.jpg", "memo.txt"] {
        fs::write(tmp.path().join(name), name).unwrap();
    }
    let ui = ui();
    let data = ui._app.handle().path().app_data_dir().unwrap();
    ui.call("add_paths", json!({ "paths": [tmp.path()], "replace": true, "includeHidden": false })).unwrap();
    let names = || {
        let mut v: Vec<String> =
            fs::read_dir(tmp.path()).unwrap().map(|e| e.unwrap().file_name().to_string_lossy().into_owned()).collect();
        v.sort();
        v
    };
    let status = || ui.call("journal_status", json!({})).unwrap();
    assert_eq!(status()["canUndo"], false);

    // Numbered backwards: 1.jpg → 3.jpg, 2.jpg stays, memo.txt → 1.txt.
    let rule = json!({ "kind": "template", "template": "{n}", "start": 3, "step": -1 });
    let out = ui.call("run_rename", query(json!({ "rule": rule }))).unwrap();
    assert_eq!(out["kind"], "completed", "{out}");
    assert_eq!(out["renamed"], 2);
    assert_eq!(names(), ["1.txt", "2.jpg", "3.jpg"]);
    assert_eq!(fs::read_to_string(tmp.path().join("3.jpg")).unwrap(), "1.jpg");
    // The list knows the new names.
    let l = ui.call("list_files", query(json!({}))).unwrap();
    let listed: Vec<&str> = l["rows"].as_array().unwrap().iter().map(|r| r["name"].as_str().unwrap()).collect();
    assert_eq!(listed, ["1.txt", "2.jpg", "3.jpg"]);
    let st = status();
    assert_eq!(
        (st["canUndo"].as_bool(), st["interrupted"].as_bool(), st["renamed"].as_u64()),
        (Some(true), Some(false), Some(2))
    );

    let r = ui.call("undo_rename", json!({})).unwrap();
    assert_eq!(r["restored"], 2, "{r}");
    assert_eq!(names(), ["1.jpg", "2.jpg", "memo.txt"]);
    assert_eq!(status()["canUndo"], false);
    assert!(ui.call("undo_rename", json!({})).is_err());

    // A list with a problem doesn't run.
    let clash = json!({ "kind": "template", "template": "same", "start": 1, "step": 1 });
    let e = ui.call("run_rename", query(json!({ "rule": clash, "includeExt": true }))).unwrap_err();
    assert!(e.as_str().unwrap().contains("問題のある行"), "{e}");
    assert_eq!(names(), ["1.jpg", "2.jpg", "memo.txt"]);
    let _ = fs::remove_dir_all(data);
}

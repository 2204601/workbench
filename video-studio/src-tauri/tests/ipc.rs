//! The commands called through IPC with the arguments the frontend sends
//! (src/lib/api.ts), on Tauri's mock runtime, with a real ffmpeg: media made
//! with ffmpeg's test sources is probed, prepared and exported, and the
//! export is probed back.

use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::ipc::{CallbackFn, InvokeBody};
use tauri::test::{get_ipc_response, mock_builder, mock_context, noop_assets, INVOKE_KEY};
use tauri::webview::InvokeRequest;
use tauri::{App, WebviewWindow, WebviewWindowBuilder};

#[cfg(windows)]
const LOCAL: &str = "http://tauri.localhost";
#[cfg(not(windows))]
const LOCAL: &str = "tauri://localhost";

struct Ui {
    _app: App<tauri::test::MockRuntime>,
    webview: WebviewWindow<tauri::test::MockRuntime>,
}

fn ui() -> Ui {
    let mut context = mock_context(noop_assets());
    context.config_mut().identifier =
        format!("dev.workbench.video-studio.test-{}", std::process::id());
    let app = video_studio_lib::with_commands(mock_builder())
        .build(context)
        .expect("app");
    let webview = WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .expect("window");
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

/// A test clip: colour bars with a beep (or silent), `secs` long.
fn make_video(path: &Path, secs: u32, size: &str, audio: bool) {
    let mut c = Command::new(video_studio_lib::ffmpeg::binary());
    c.args([
        "-v",
        "error",
        "-y",
        "-f",
        "lavfi",
        "-i",
        &format!("testsrc2=s={size}:r=30:d={secs}"),
    ]);
    if audio {
        c.args([
            "-f",
            "lavfi",
            "-i",
            &format!("sine=f=440:d={secs}"),
            "-c:a",
            "aac",
        ]);
    }
    let ok = c
        .args(["-c:v", "libx264", "-pix_fmt", "yuv420p", "-shortest"])
        .arg(path)
        .status()
        .unwrap()
        .success();
    assert!(ok, "ffmpeg could not make {}", path.display());
}

/// A 1×1 transparent PNG.
const PNG: &str = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

#[test]
fn probe_prepare_export() {
    let dir = tempfile::tempdir().unwrap();
    let a = dir.path().join("a.mp4");
    let b = dir.path().join("b clip.mp4");
    make_video(&a, 3, "320x240", true);
    make_video(&b, 2, "240x320", false);
    let ui = ui();
    let s = |p: &PathBuf| p.to_string_lossy().into_owned();

    let probe = ui.call("probe_media", json!({ "path": s(&a) })).unwrap();
    assert_eq!(probe["kind"], "video");
    assert_eq!(probe["width"], 320);
    assert_eq!(probe["hasAudio"], true);
    assert!(
        (probe["duration"].as_f64().unwrap() - 3.0).abs() < 0.1,
        "{probe}"
    );
    let err = ui
        .call(
            "probe_media",
            json!({ "path": s(&dir.path().join("none.mp4")) }),
        )
        .unwrap_err();
    assert!(err.as_str().unwrap().contains("見つかりません"));

    let prepared = ui
        .call(
            "prepare_media",
            json!({ "id": "m1", "path": s(&a), "forceProxy": true }),
        )
        .unwrap();
    for key in ["proxy", "wave"] {
        assert!(
            Path::new(prepared[key].as_str().unwrap()).is_file(),
            "{key}: {prepared}"
        );
    }
    assert!(Path::new(prepared["thumbs"]["path"].as_str().unwrap()).is_file());
    assert_eq!(prepared["thumbs"]["count"], 3);
    // b plays as it is: no copy, and no waveform without sound.
    let prepared = ui
        .call(
            "prepare_media",
            json!({ "id": "m2", "path": s(&b), "forceProxy": false }),
        )
        .unwrap();
    assert!(
        prepared["proxy"].is_null() && prepared["wave"].is_null(),
        "{prepared}"
    );

    let out = dir.path().join("out.mp4");
    let job = json!({
        "width": 320, "height": 180, "fps": 30, "quality": "small",
        "clips": [
            { "source": { "kind": "video", "path": s(&a), "start": 0.5, "hasAudio": true, "fit": "contain" }, "duration": 2.0, "volume": 1.0, "transition": null },
            { "source": { "kind": "video", "path": s(&b), "start": 0.0, "hasAudio": false, "fit": "cover" }, "duration": 1.5, "volume": 1.0,
              "transition": { "kind": "circleopen", "duration": 0.5 } },
            { "source": { "kind": "image", "png": PNG }, "duration": 1.0, "volume": 1.0, "transition": null },
            { "source": { "kind": "video", "path": s(&a), "start": 0.0, "hasAudio": true, "fit": "contain" }, "duration": 1.0, "volume": 0.5,
              "transition": { "kind": "slideleft", "duration": 0.4 } }
        ],
        "overlays": [
            { "png": PNG, "x": 160.0, "y": 90.0, "start": 0.2, "end": 2.5, "animIn": "pop", "animOut": "fade" },
            { "png": PNG, "x": 100.0, "y": 150.0, "start": 1.0, "end": 4.0, "animIn": "slide", "animOut": "rise" }
        ]
    });
    let res = ui
        .call("export_video", json!({ "job": job, "output": s(&out) }))
        .unwrap();
    assert_eq!(res["path"], s(&out));
    assert!(!out.with_extension("part.mp4").exists());

    let probe = ui.call("probe_media", json!({ "path": s(&out) })).unwrap();
    assert_eq!(
        (probe["width"].as_u64(), probe["height"].as_u64()),
        (Some(320), Some(180))
    );
    assert_eq!(probe["hasAudio"], true);
    // 2 + 1.5 + 1 + 1 - 0.5 - 0.4 = 4.6 s
    assert!(
        (probe["duration"].as_f64().unwrap() - 4.6).abs() < 0.1,
        "{probe}"
    );
}

#[test]
fn projects_save_only_as_cutter_files() {
    let dir = tempfile::tempdir().unwrap();
    let ui = ui();
    let p = dir.path().join("my.cutter").to_string_lossy().into_owned();
    ui.call(
        "save_project",
        json!({ "path": p, "text": "{\"version\":1}" }),
    )
    .unwrap();
    assert_eq!(
        ui.call("load_project", json!({ "path": p })).unwrap(),
        "{\"version\":1}"
    );
    let other = dir.path().join("x.txt").to_string_lossy().into_owned();
    assert!(ui
        .call("save_project", json!({ "path": other, "text": "" }))
        .is_err());
}

mod drag_watch;
mod proxy;
mod shelf;
mod update;

use std::path::PathBuf;

use shelf::{Shelf, ShelfItem};
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, PhysicalPosition, State, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder, WindowEvent,
};
use tauri_plugin_opener::OpenerExt;

type CmdResult<T> = Result<T, String>;

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

/// Lets the webview load image thumbnails through the asset protocol, one
/// shelved file at a time, instead of opening up the whole disk.
fn allow_thumbnails(app: &AppHandle, paths: impl IntoIterator<Item = PathBuf>) {
    let scope = app.asset_protocol_scope();
    for path in paths {
        if path.is_file() {
            let _ = scope.allow_file(&path);
        }
    }
}

#[tauri::command]
fn list_items(shelf: State<Shelf>) -> Vec<ShelfItem> {
    shelf.list()
}

#[tauri::command]
fn add_paths(
    app: AppHandle,
    shelf: State<Shelf>,
    paths: Vec<PathBuf>,
) -> CmdResult<Vec<ShelfItem>> {
    let added = shelf.add(&paths).map_err(err)?;
    if !added.is_empty() {
        drag_watch::note_drop();
    }
    allow_thumbnails(&app, added);
    // Files can also be dropped on the edge strip; let the shelf catch up.
    let _ = app.emit_to("main", "shelf-changed", ());
    Ok(shelf.list())
}

#[tauri::command]
fn remove_items(
    app: AppHandle,
    shelf: State<Shelf>,
    paths: Vec<String>,
) -> CmdResult<Vec<ShelfItem>> {
    shelf.remove(&paths).map_err(err)?;
    Ok(hide_if_empty(&app, shelf.list()))
}

#[tauri::command]
fn prune_missing(
    app: AppHandle,
    shelf: State<Shelf>,
    paths: Vec<String>,
) -> CmdResult<Vec<ShelfItem>> {
    shelf.prune_missing(&paths).map_err(err)?;
    Ok(hide_if_empty(&app, shelf.list()))
}

#[tauri::command]
fn clear_items(app: AppHandle, shelf: State<Shelf>) -> CmdResult<Vec<ShelfItem>> {
    shelf.clear().map_err(err)?;
    Ok(hide_if_empty(&app, shelf.list()))
}

#[tauri::command]
fn edge_drag_enter(app: AppHandle) {
    drag_watch::drag_reached_edge(&app);
}

/// The shelf gets out of the way once its last item has been taken out; the
/// next drag brings it back.
fn hide_if_empty(app: &AppHandle, items: Vec<ShelfItem>) -> Vec<ShelfItem> {
    if items.is_empty() {
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.hide();
        }
    }
    items
}

#[tauri::command]
fn reveal_item(app: AppHandle, path: String) -> CmdResult<()> {
    app.opener().reveal_item_in_dir(path).map_err(err)
}

#[tauri::command]
fn open_item(app: AppHandle, path: String) -> CmdResult<()> {
    app.opener().open_path(path, None::<&str>).map_err(err)
}

fn toggle_window(window: &WebviewWindow) {
    if window.is_visible().unwrap_or(false) {
        let _ = window.hide();
    } else {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// Parks the window at the right edge of the primary screen, vertically centred.
fn dock_to_right_edge(window: &WebviewWindow) -> tauri::Result<()> {
    let Some(monitor) = window.primary_monitor()? else {
        return Ok(());
    };
    let area = monitor.work_area();
    let mut size = window.outer_size()?;
    if size.width == 0 {
        // GTK reports no outer size until a window manager has framed the window.
        size = window.inner_size()?;
    }
    let margin = (16.0 * monitor.scale_factor()) as i32;
    let x = area.position.x + area.size.width as i32 - size.width as i32 - margin;
    let y = area.position.y + (area.size.height as i32 - size.height as i32) / 2;
    window.set_position(PhysicalPosition::new(x, y))
}

/// Creates the thin strip along the right edge of the primary screen that
/// brings up the shelf when a drag touches it.
fn create_edge_strip(app: &AppHandle) -> tauri::Result<()> {
    const WIDTH: f64 = 4.0;
    let Some(monitor) = app.primary_monitor()? else {
        return Ok(());
    };
    let scale = monitor.scale_factor();
    let area = monitor.work_area();
    let (x, y) = (
        area.position.x as f64 / scale,
        area.position.y as f64 / scale,
    );
    let (w, h) = (
        area.size.width as f64 / scale,
        area.size.height as f64 / scale,
    );
    // Middle half of the edge: easy to hit, leaves the corners alone.
    let height = (h / 2.0).round();

    WebviewWindowBuilder::new(app, "edge", WebviewUrl::App("edge.html".into()))
        .title("Shelf edge")
        .inner_size(WIDTH, height)
        .position(x + w - WIDTH, y + (h - height) / 2.0)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .resizable(false)
        .always_on_top(true)
        .visible_on_all_workspaces(true)
        .skip_taskbar(true)
        .focused(false)
        .focusable(false)
        .build()?;
    Ok(())
}

fn setup_tray(app: &AppHandle) -> tauri::Result<()> {
    let toggle = MenuItem::with_id(app, "toggle", "表示 / 非表示", true, None::<&str>)?;
    let update = MenuItem::with_id(app, "update", update::MENU_LABEL, true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "終了", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[
            &toggle,
            &PredefinedMenuItem::separator(app)?,
            &update,
            &PredefinedMenuItem::separator(app)?,
            &quit,
        ],
    )?;
    app.manage(update::MenuEntry(update));

    let mut tray = TrayIconBuilder::with_id("main")
        .tooltip(format!("Shelf v{}", app.package_info().version))
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "toggle" => {
                if let Some(window) = app.get_webview_window("main") {
                    toggle_window(&window);
                }
            }
            "update" => update::check(app, true),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                if let Some(window) = tray.app_handle().get_webview_window("main") {
                    toggle_window(&window);
                }
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_drag::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            // Menu-bar utility on macOS: no Dock icon, just the tray.
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            let store = app.path().app_data_dir()?.join("shelf.json");
            let first_run = !store.exists();
            let shelf = Shelf::load(store);
            let has_items = !shelf.list().is_empty();
            allow_thumbnails(
                app.handle(),
                shelf
                    .list()
                    .into_iter()
                    .map(|item| PathBuf::from(item.path)),
            );
            app.manage(shelf);

            setup_tray(app.handle())?;
            create_edge_strip(app.handle())?;
            update::check_periodically(app.handle());
            #[cfg(target_os = "macos")]
            drag_watch::macos::install(app.handle().clone());

            if let Some(window) = app.get_webview_window("main") {
                let _ = dock_to_right_edge(&window);
                // Otherwise the shelf waits, hidden, for the next drag. It is
                // shown on the very first launch so people see it exists.
                if has_items || first_run {
                    window.show()?;
                }
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            // Closing the shelf only hides it; quit from the tray menu.
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            list_items,
            add_paths,
            remove_items,
            prune_missing,
            clear_items,
            reveal_item,
            open_item,
            edge_drag_enter,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

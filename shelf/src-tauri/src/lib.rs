mod shelf;

use std::path::PathBuf;

use shelf::{Shelf, ShelfItem};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, PhysicalPosition, State, WebviewWindow, WindowEvent,
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
    allow_thumbnails(&app, added);
    Ok(shelf.list())
}

#[tauri::command]
fn remove_items(shelf: State<Shelf>, paths: Vec<String>) -> CmdResult<Vec<ShelfItem>> {
    shelf.remove(&paths).map_err(err)?;
    Ok(shelf.list())
}

#[tauri::command]
fn prune_missing(shelf: State<Shelf>, paths: Vec<String>) -> CmdResult<Vec<ShelfItem>> {
    shelf.prune_missing(&paths).map_err(err)?;
    Ok(shelf.list())
}

#[tauri::command]
fn clear_items(shelf: State<Shelf>) -> CmdResult<Vec<ShelfItem>> {
    shelf.clear().map_err(err)?;
    Ok(shelf.list())
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

fn setup_tray(app: &AppHandle) -> tauri::Result<()> {
    let toggle = MenuItem::with_id(app, "toggle", "表示 / 非表示", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "終了", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&toggle, &quit])?;

    let mut tray = TrayIconBuilder::with_id("main")
        .tooltip("Shelf")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "toggle" => {
                if let Some(window) = app.get_webview_window("main") {
                    toggle_window(&window);
                }
            }
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
        .setup(|app| {
            // Menu-bar utility on macOS: no Dock icon, just the tray.
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            let store = app.path().app_data_dir()?.join("shelf.json");
            let shelf = Shelf::load(store);
            allow_thumbnails(
                app.handle(),
                shelf
                    .list()
                    .into_iter()
                    .map(|item| PathBuf::from(item.path)),
            );
            app.manage(shelf);

            setup_tray(app.handle())?;

            if let Some(window) = app.get_webview_window("main") {
                let _ = dock_to_right_edge(&window);
                window.show()?;
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

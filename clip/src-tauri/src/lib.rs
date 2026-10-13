mod clipboard;
mod login_item;
mod paste;
mod proxy;
mod shortcut;
mod store;
mod tray_icon;
mod update;

use std::sync::{
    atomic::{AtomicBool, Ordering},
    Mutex,
};

use serde::Serialize;
use store::{HistoryItem, Settings, Snippet, Store};
use tauri::{
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
    AppHandle, Emitter, Manager, PhysicalPosition, State, WebviewWindow, WindowEvent, Wry,
};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

type CmdResult<T> = Result<T, String>;

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

/// The app that was in front when the popup came up; focus goes back to it
/// when the popup closes, and that is where the paste lands.
#[derive(Default)]
struct Previous(Mutex<Option<paste::Target>>);

/// Whether the shortcut in the settings could be registered.
struct ShortcutActive(AtomicBool);

/// The tray menu items that follow the settings.
struct TrayItems {
    open: MenuItem<Wry>,
    record: CheckMenuItem<Wry>,
}

#[derive(Serialize)]
struct Entries {
    snippets: Vec<Snippet>,
    history: Vec<HistoryItem>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Status {
    /// Whether choosing an entry can type it in, or only copy it (macOS
    /// without the Accessibility permission).
    auto_paste: bool,
    shortcut: String,
    shortcut_active: bool,
    version: String,
}

/// Tells both windows to reload what they show.
fn changed(app: &AppHandle) {
    let _ = app.emit("entries-changed", ());
}

#[tauri::command]
fn entries(store: State<Store>) -> Entries {
    Entries { snippets: store.snippets(), history: store.history() }
}

#[tauri::command]
fn status(app: AppHandle, store: State<Store>) -> Status {
    Status {
        auto_paste: paste::trusted(),
        shortcut: store.settings().shortcut,
        shortcut_active: app.state::<ShortcutActive>().0.load(Ordering::SeqCst),
        version: app.package_info().version.to_string(),
    }
}

/// Puts `text` on the clipboard, closes the popup and, when `paste` is set
/// and allowed, types it into the app that was in front.
///
/// Async so that it runs off the main thread, which the clipboard access
/// waits on (macOS).
#[tauri::command]
async fn choose(app: AppHandle, text: String, history_id: Option<u64>, paste: bool) -> CmdResult<()> {
    if !clipboard::write_text(&app, &text) {
        return Err("クリップボードに書き込めませんでした".into());
    }
    if let Some(id) = history_id {
        app.state::<Store>().touch(id).map_err(err)?;
        changed(&app);
    }
    let returned = hide_popup(&app, true);
    if paste && returned && paste::trusted() {
        paste::paste_soon();
    }
    Ok(())
}

#[tauri::command]
fn close_popup(app: AppHandle) {
    hide_popup(&app, true);
}

#[tauri::command]
fn add_snippet(app: AppHandle, store: State<Store>, label: String, text: String) -> CmdResult<Snippet> {
    let snippet = store.add_snippet(&label, &text).map_err(err)?;
    changed(&app);
    Ok(snippet)
}

#[tauri::command]
fn update_snippet(app: AppHandle, store: State<Store>, id: u64, label: String, text: String) -> CmdResult<()> {
    store.update_snippet(id, &label, &text).map_err(err)?;
    changed(&app);
    Ok(())
}

#[tauri::command]
fn delete_snippet(app: AppHandle, store: State<Store>, id: u64) -> CmdResult<()> {
    store.delete_snippet(id).map_err(err)?;
    changed(&app);
    Ok(())
}

#[tauri::command]
fn move_snippet(app: AppHandle, store: State<Store>, id: u64, by: i64) -> CmdResult<()> {
    store.move_snippet(id, by).map_err(err)?;
    changed(&app);
    Ok(())
}

#[tauri::command]
fn snippet_from_history(app: AppHandle, store: State<Store>, id: u64) -> CmdResult<Option<Snippet>> {
    let snippet = store.snippet_from_history(id).map_err(err)?;
    changed(&app);
    Ok(snippet)
}

#[tauri::command]
fn remove_history(app: AppHandle, store: State<Store>, id: u64) -> CmdResult<()> {
    store.remove_history(id).map_err(err)?;
    changed(&app);
    Ok(())
}

/// Asks before clearing the history, with the system's dialog.
#[tauri::command]
fn ask_clear_history(app: AppHandle) {
    confirm_clear_history(&app);
}

#[tauri::command]
fn settings(store: State<Store>) -> Settings {
    store.settings()
}

#[tauri::command]
fn set_settings(app: AppHandle, store: State<Store>, settings: Settings) -> CmdResult<Settings> {
    let old = store.settings();
    if settings.shortcut != old.shortcut {
        if !store::SHORTCUTS.contains(&settings.shortcut.as_str()) {
            return Err(format!("{} は選べません", settings.shortcut));
        }
        if !shortcut::register(&app, &settings.shortcut) {
            let active = shortcut::register(&app, &old.shortcut);
            app.state::<ShortcutActive>().0.store(active, Ordering::SeqCst);
            return Err(format!("{} はほかのアプリが使っているため、使えません", settings.shortcut));
        }
        app.state::<ShortcutActive>().0.store(true, Ordering::SeqCst);
    }
    let saved = store.set_settings(settings).map_err(err)?;
    sync_tray(&app, &saved);
    changed(&app);
    Ok(saved)
}

#[tauri::command]
fn open_manager(app: AppHandle) {
    hide_popup(&app, false);
    show_manager(&app);
}

/// Asks for the Accessibility permission and opens its pane in System
/// Settings, where Clip has to be switched on (macOS).
#[tauri::command]
fn request_accessibility(app: AppHandle) {
    hide_popup(&app, false);
    paste::request_trust();
    #[cfg(target_os = "macos")]
    {
        use tauri_plugin_opener::OpenerExt;
        let pane = "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility";
        let _ = app.opener().open_url(pane, None::<&str>);
    }
}

/// The shortcut: brings up the popup, or closes it if it is already up.
pub fn toggle_popup(app: &AppHandle) {
    let Some(window) = app.get_webview_window("popup") else {
        return;
    };
    if window.is_visible().unwrap_or(false) {
        hide_popup(app, true);
        return;
    }
    *app.state::<Previous>().0.lock().unwrap() = paste::frontmost();
    let _ = place_popup(&window);
    let _ = window.show();
    let _ = window.set_focus();
    update::bring_to_front(app);
    let _ = window.emit("popup-shown", ());
}

/// Hides the popup. With `give_back_focus`, the app that was in front before
/// becomes active again; returns whether there was one.
fn hide_popup(app: &AppHandle, give_back_focus: bool) -> bool {
    // Taken first: hiding the window loses its focus, which comes back here
    // without `give_back_focus` and would otherwise take it.
    let previous = app.state::<Previous>().0.lock().unwrap().take();
    if let Some(window) = app.get_webview_window("popup") {
        let _ = window.hide();
    }
    match previous {
        Some(target) if give_back_focus => {
            paste::activate(target);
            true
        }
        _ => false,
    }
}

fn show_manager(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("manage") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
        update::bring_to_front(app);
    }
}

/// Centres the popup near the top of the screen the mouse is on, like
/// Spotlight.
fn place_popup(window: &WebviewWindow) -> tauri::Result<()> {
    let app = window.app_handle();
    let under_mouse = app.cursor_position().ok().and_then(|p| app.monitor_from_point(p.x, p.y).ok().flatten());
    let Some(monitor) = under_mouse.or(window.primary_monitor()?) else {
        return Ok(());
    };
    let area = monitor.work_area();
    let size = window.outer_size()?;
    let x = area.position.x + (area.size.width as i32 - size.width as i32) / 2;
    let y = area.position.y + area.size.height as i32 / 5;
    window.set_position(PhysicalPosition::new(x, y))
}

fn confirm_clear_history(app: &AppHandle) {
    update::bring_to_front(app);
    let handle = app.clone();
    app.dialog()
        .message("コピーの履歴をすべて消去しますか？\nスニペットは消えません。")
        .title("履歴を消去")
        .kind(MessageDialogKind::Warning)
        .buttons(MessageDialogButtons::OkCancelCustom("消去".into(), "キャンセル".into()))
        .show(move |ok| {
            if ok {
                match handle.state::<Store>().clear_history() {
                    Ok(()) => changed(&handle),
                    Err(e) => eprintln!("clear history: {e}"),
                }
            }
        });
}

fn toggle_recording(app: &AppHandle) {
    let store = app.state::<Store>();
    let settings = Settings { record_history: !store.settings().record_history, ..store.settings() };
    match store.set_settings(settings) {
        Ok(saved) => {
            sync_tray(app, &saved);
            changed(app);
        }
        Err(e) => eprintln!("settings: {e}"),
    }
}

/// Shows the current shortcut and recording state in the tray menu.
fn sync_tray(app: &AppHandle, settings: &Settings) {
    let Some(items) = app.try_state::<TrayItems>() else {
        return;
    };
    let active = app.state::<ShortcutActive>().0.load(Ordering::SeqCst);
    let _ = items.open.set_accelerator(active.then_some(settings.shortcut.as_str()));
    let _ = items.record.set_checked(settings.record_history);
}

fn setup_tray(app: &AppHandle) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Clip を開く", true, None::<&str>)?;
    let manage = MenuItem::with_id(app, "manage", "スニペットと設定…", true, None::<&str>)?;
    let record = CheckMenuItem::with_id(app, "record", "履歴を記録する", true, true, None::<&str>)?;
    let clear = MenuItem::with_id(app, "clear", "履歴を消去…", true, None::<&str>)?;
    let login =
        CheckMenuItem::with_id(app, "login", login_item::MENU_LABEL, true, login_item::is_enabled(app), None::<&str>)?;
    let update = MenuItem::with_id(app, "update", update::MENU_LABEL, true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "終了", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[
            &open,
            &manage,
            &PredefinedMenuItem::separator(app)?,
            &record,
            &clear,
            &PredefinedMenuItem::separator(app)?,
            &login,
            &update,
            &PredefinedMenuItem::separator(app)?,
            &quit,
        ],
    )?;
    app.manage(update::MenuEntry(update));
    app.manage(TrayItems { open, record });
    sync_tray(app, &app.state::<Store>().settings());

    let tray = TrayIconBuilder::with_id(tray_icon::ID)
        .tooltip(format!("Clip v{}", app.package_info().version))
        .menu(&menu)
        // Any click opens the menu, as in Shelf (decisions/adr-0001).
        .show_menu_on_left_click(true)
        .on_menu_event(move |app, event| match event.id().as_ref() {
            "open" => toggle_popup(app),
            "manage" => show_manager(app),
            "record" => toggle_recording(app),
            "clear" => confirm_clear_history(app),
            "login" => login_item::toggle(app, &login),
            "update" => update::check(app, true),
            "quit" => app.exit(0),
            _ => {}
        });
    tray_icon::apply(tray)?.build(app)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // First, so a second launch exits before setting anything else up.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| show_manager(app)))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(login_item::plugin())
        .plugin(shortcut::plugin())
        .setup(|app| {
            // Menu-bar utility on macOS: no Dock icon, just the tray.
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            let store = Store::load(app.path().app_data_dir()?);
            let shortcut = store.settings().shortcut;
            app.manage(store);
            app.manage(Previous::default());

            login_item::enable_once(app.handle());
            let active = shortcut::register(app.handle(), &shortcut);
            app.manage(ShortcutActive(AtomicBool::new(active)));
            setup_tray(app.handle())?;
            clipboard::watch(app.handle());
            update::check_periodically(app.handle());

            // Opened by hand: show the window, so people see Clip is there
            // and can register their snippets. At login it waits in the tray.
            if !login_item::launched_at_login() {
                show_manager(app.handle());
            }
            Ok(())
        })
        .on_window_event(|window, event| match event {
            // Closing a window only hides it; quit from the tray menu.
            WindowEvent::CloseRequested { api, .. } => {
                api.prevent_close();
                let _ = window.hide();
            }
            // The popup goes away when another app is clicked, like a menu.
            WindowEvent::Focused(false) if window.label() == "popup" => {
                hide_popup(window.app_handle(), false);
            }
            // Windows: the taskbar may have switched between light and dark.
            WindowEvent::ThemeChanged(_) => tray_icon::refresh(window.app_handle()),
            _ => {}
        })
        .invoke_handler(tauri::generate_handler![
            entries,
            status,
            choose,
            close_popup,
            add_snippet,
            update_snippet,
            delete_snippet,
            move_snippet,
            snippet_from_history,
            remove_history,
            ask_clear_history,
            settings,
            set_settings,
            open_manager,
            request_accessibility,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

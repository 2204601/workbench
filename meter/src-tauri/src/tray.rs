//! The tray: on Windows one icon per metric with its value drawn in
//! (badge.rs), on macOS one menu-bar item with the values as text. A left
//! click opens the popup, a right click the menu (Optional Standard
//! "トレイ常駐").
//!
//! Windows: all four icons are created at launch, in the same order every
//! time, and the ones not chosen are hidden. Windows remembers by each
//! icon's number which icons were moved out of the overflow menu ("^"), and
//! the numbers follow the order of creation, so this keeps them apart.

use std::{collections::HashMap, sync::Mutex};

use tauri::{
    image::Image,
    menu::{CheckMenuItem, Menu, MenuEvent, MenuItem, PredefinedMenuItem, Submenu},
    tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, Wry,
};

use crate::{
    badge::{self, Badge},
    format, login_item, popup,
    sampler::Sample,
    settings::{self, Metric, Settings, INTERVALS},
    update,
};

/// The macOS menu-bar item's id.
const MAC_ID: &str = "main";

/// The menu items that follow the settings, and what the tray shows now
/// (only what changed is sent to the OS again).
pub struct Tray {
    metrics: Vec<(Metric, CheckMenuItem<Wry>)>,
    intervals: Vec<(u64, CheckMenuItem<Wry>)>,
    login: CheckMenuItem<Wry>,
    shown: Mutex<Shown>,
}

#[derive(Default)]
struct Shown {
    badges: HashMap<Metric, (Badge, u32)>,
    tooltip: String,
    title: String,
    last: Option<Sample>,
}

fn uses_title() -> bool {
    cfg!(target_os = "macos")
}

pub fn setup(app: &AppHandle) -> tauri::Result<()> {
    let settings = app.state::<settings::Store>().get();

    let open = MenuItem::with_id(app, "popup", "詳細を表示", true, None::<&str>)?;
    let where_ = if uses_title() { "メニューバーに表示" } else { "タスクトレイに表示" };
    let metrics: Vec<(Metric, CheckMenuItem<Wry>)> = Metric::ALL
        .into_iter()
        .map(|m| {
            let item = CheckMenuItem::with_id(app, format!("tray:{}", m.id()), m.title(), true, false, None::<&str>);
            item.map(|item| (m, item))
        })
        .collect::<tauri::Result<_>>()?;
    let intervals: Vec<(u64, CheckMenuItem<Wry>)> = INTERVALS
        .into_iter()
        .map(|s| {
            let item =
                CheckMenuItem::with_id(app, format!("interval:{s}"), format!("{s} 秒"), true, false, None::<&str>);
            item.map(|item| (s, item))
        })
        .collect::<tauri::Result<_>>()?;
    let show_menu = Submenu::with_id(app, "tray", where_, true)?;
    for (_, item) in &metrics {
        show_menu.append(item)?;
    }
    let interval_menu = Submenu::with_id(app, "interval", "更新の間隔", true)?;
    for (_, item) in &intervals {
        interval_menu.append(item)?;
    }
    let login =
        CheckMenuItem::with_id(app, "login", login_item::MENU_LABEL, true, login_item::is_enabled(app), None::<&str>)?;
    let update = MenuItem::with_id(app, "update", update::MENU_LABEL, true, None::<&str>)?;
    let logs = MenuItem::with_id(app, "logs", "ログを表示", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "終了", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[
            &open,
            &PredefinedMenuItem::separator(app)?,
            &show_menu,
            &interval_menu,
            &PredefinedMenuItem::separator(app)?,
            &login,
            &update,
            &logs,
            &PredefinedMenuItem::separator(app)?,
            &quit,
        ],
    )?;
    app.manage(update::MenuEntry(update));
    app.manage(Tray { metrics, intervals, login, shown: Mutex::new(Shown::default()) });
    // Once for the whole app: a handler given to each tray would run once
    // per tray for every click.
    app.on_menu_event(on_menu);

    let tooltip = format!("Meter v{}", app.package_info().version);
    if uses_title() {
        TrayIconBuilder::with_id(MAC_ID)
            .title("Meter")
            .tooltip(&tooltip)
            .menu(&menu)
            .show_menu_on_left_click(false)
            .on_tray_icon_event(on_click)
            .build(app)?;
    } else {
        let size = badge::tray_size();
        for metric in Metric::ALL {
            let blank = Badge { label: "", value: String::new(), color: [0x55, 0x55, 0x55] };
            let tray = TrayIconBuilder::with_id(metric.id())
                .icon(Image::new_owned(badge::render(&blank, size), size, size))
                .tooltip(&tooltip)
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_tray_icon_event(on_click)
                .build(app)?;
            if !settings.shows(metric) {
                tray.set_visible(false)?;
            }
        }
    }
    sync_menu(app, &settings);
    Ok(())
}

fn on_click(tray: &TrayIcon, event: TrayIconEvent) {
    if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, rect, .. } = event {
        popup::toggle(tray.app_handle(), Some(rect));
    }
}

fn on_menu(app: &AppHandle, event: MenuEvent) {
    let id = event.id().as_ref();
    if let Some(metric) = id.strip_prefix("tray:").and_then(Metric::from_id) {
        let store = app.state::<settings::Store>();
        change(app, store.get().toggled(metric));
    } else if let Some(secs) = id.strip_prefix("interval:").and_then(|s| s.parse().ok()) {
        let store = app.state::<settings::Store>();
        change(app, store.get().with_interval(secs));
    } else {
        match id {
            "popup" => popup::show(app, None),
            "login" => login_item::toggle(app, &app.state::<Tray>().login),
            "update" => update::check(app, true),
            "logs" => crate::reveal_log(app),
            "quit" => app.exit(0),
            _ => {}
        }
    }
}

fn change(app: &AppHandle, settings: Settings) {
    let saved = match app.state::<settings::Store>().set(settings) {
        Ok(saved) => saved,
        Err(e) => {
            log::error!("settings: {e}");
            app.state::<settings::Store>().get()
        }
    };
    sync_menu(app, &saved);
    if !uses_title() {
        for metric in Metric::ALL {
            if let Some(tray) = app.tray_by_id(metric.id()) {
                let _ = tray.set_visible(saved.shows(metric));
            }
        }
    }
    // Show the change now rather than at the next reading.
    let last = app.state::<Tray>().shown.lock().unwrap().last.clone();
    if let Some(sample) = last {
        show_sample(app, &sample);
    }
}

/// Ticks the menu items that match the settings. A check item flips itself
/// when clicked, so this also undoes a click that was refused (the last
/// metric in the tray).
fn sync_menu(app: &AppHandle, settings: &Settings) {
    let tray = app.state::<Tray>();
    for (metric, item) in &tray.metrics {
        let _ = item.set_checked(settings.shows(*metric));
    }
    for (secs, item) in &tray.intervals {
        let _ = item.set_checked(*secs == settings.interval_secs);
    }
}

/// Puts a reading into the tray.
pub fn show_sample(app: &AppHandle, sample: &Sample) {
    let Some(tray) = app.try_state::<Tray>() else {
        return;
    };
    let settings = app.state::<settings::Store>().get();
    let mut shown = tray.shown.lock().unwrap();
    shown.last = Some(sample.clone());

    let tooltip = format::tooltip(&app.package_info().version.to_string(), sample);
    let tooltip_changed = shown.tooltip != tooltip;
    shown.tooltip.clone_from(&tooltip);

    if uses_title() {
        let title = format::title(&settings.tray, sample);
        if let Some(item) = app.tray_by_id(MAC_ID) {
            if shown.title != title {
                let _ = item.set_title(Some(&title));
                shown.title = title;
            }
            if tooltip_changed {
                let _ = item.set_tooltip(Some(&tooltip));
            }
        }
        return;
    }

    let size = badge::tray_size();
    for &metric in &settings.tray {
        let Some(item) = app.tray_by_id(metric.id()) else {
            continue;
        };
        let badge = badge::for_metric(metric, sample);
        if shown.badges.get(&metric) != Some(&(badge.clone(), size)) {
            let _ = item.set_icon(Some(Image::new_owned(badge::render(&badge, size), size, size)));
            shown.badges.insert(metric, (badge, size));
        }
        if tooltip_changed {
            let _ = item.set_tooltip(Some(&tooltip));
        }
    }
    // A hidden icon is added again when it comes back, without its picture.
    for metric in Metric::ALL.into_iter().filter(|m| !settings.shows(*m)) {
        shown.badges.remove(&metric);
    }
}

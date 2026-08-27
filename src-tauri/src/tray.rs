//! System tray integration for Glimpse.

use std::path::PathBuf;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{App, AppHandle, Emitter, Manager, WebviewWindow, WindowEvent};
use tracing::{debug, error, warn};

use crate::store::settings::load_settings;

const MAIN_WINDOW_LABEL: &str = "main";
const SHOW_MENU_ID: &str = "tray-show";
const HIDE_MENU_ID: &str = "tray-hide";
const QUIT_MENU_ID: &str = "tray-quit";

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct WindowFocusedPayload {
    selected_text: Option<String>,
}

pub fn setup_tray(app: &mut App, settings_path: PathBuf) -> tauri::Result<()> {
    let is_quitting = Arc::new(AtomicBool::new(false));

    register_close_to_tray_handler(app, settings_path, is_quitting.clone());

    let show = MenuItem::with_id(app, SHOW_MENU_ID, "Show Glimpse", true, None::<&str>)?;
    let hide = MenuItem::with_id(app, HIDE_MENU_ID, "Hide", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, QUIT_MENU_ID, "Quit", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(app, &[&show, &hide, &separator, &quit])?;

    let icon = app.default_window_icon().cloned();
    let mut tray = TrayIconBuilder::with_id("main")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .tooltip("Glimpse")
        .on_tray_icon_event(|tray, event| {
            let should_show = matches!(
                event,
                TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                } | TrayIconEvent::DoubleClick {
                    button: MouseButton::Left,
                    ..
                }
            );

            if should_show {
                show_main_window(tray.app_handle());
            }
        });

    if let Some(icon) = icon {
        tray = tray.icon(icon);
    } else {
        warn!("default window icon not found; tray icon may be unavailable");
    }

    tray.on_menu_event(move |app, event| match event.id().as_ref() {
        SHOW_MENU_ID => show_main_window(app),
        HIDE_MENU_ID => hide_main_window(app),
        QUIT_MENU_ID => {
            is_quitting.store(true, Ordering::SeqCst);
            app.exit(0);
        }
        _ => {}
    })
    .build(app)?;

    Ok(())
}

fn register_close_to_tray_handler(
    app: &mut App,
    settings_path: PathBuf,
    is_quitting: Arc<AtomicBool>,
) {
    let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) else {
        warn!("main window not found; close-to-tray handler was not registered");
        return;
    };

    let window_for_close = window.clone();

    window.on_window_event(move |event| {
        let WindowEvent::CloseRequested { api, .. } = event else {
            return;
        };

        if is_quitting.load(Ordering::SeqCst) {
            return;
        }

        if !load_settings(&settings_path).ui.close_to_tray {
            return;
        }

        api.prevent_close();

        if let Err(error) = window_for_close.hide() {
            error!(
                error = %error,
                "failed to hide main window on close request"
            );
        } else {
            debug!("hid main window on close request");
        }
    });
}

fn show_main_window(app: &AppHandle) {
    let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) else {
        warn!("main window not found");
        return;
    };

    if let Err(error) = window.show() {
        error!(
            error = %error,
            "failed to show main window"
        );
        return;
    }

    if window.is_minimized().unwrap_or(false) {
        if let Err(error) = window.unminimize() {
            warn!(
                error = %error,
                "failed to unminimize main window"
            );
        }
    }

    focus_main_window(&window);
}

fn hide_main_window(app: &AppHandle) {
    let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) else {
        warn!("main window not found");
        return;
    };

    if let Err(error) = window.hide() {
        error!(
            error = %error,
            "failed to hide main window"
        );
    }
}

fn focus_main_window(window: &WebviewWindow) {
    if let Err(error) = window.set_focus() {
        warn!(
            error = %error,
            "failed to focus main window"
        );
    }

    if let Err(error) = window.emit(
        "window-focused",
        WindowFocusedPayload {
            selected_text: None,
        },
    ) {
        warn!(
            error = %error,
            "failed to emit window-focused event"
        );
    }
}

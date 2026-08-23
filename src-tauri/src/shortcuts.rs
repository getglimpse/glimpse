//! Global shortcut registration for Glimpse.

use crate::models::settings::{AppSettings, KeybindingValue};

use serde::Serialize;
use std::path::Path;

use tauri::{AppHandle, Emitter, Manager, WebviewWindow};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
use tracing::{debug, error, info, warn};

const TOGGLE_MAIN_WINDOW_ACTION: &str = "toggleMainWindow";
const MAX_SELECTED_TEXT_QUERY_CHARS: usize = 500;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct WindowFocusedPayload {
    selected_text: Option<String>,
}

pub fn register_global_shortcuts_from_settings_path(
    app: &AppHandle,
    settings_path: &Path,
) -> Result<(), String> {
    debug!(
        settings_path = %settings_path.display(),
        "registering global shortcuts from settings path"
    );

    let settings = load_settings(settings_path)?;
    register_global_shortcuts(app, &settings)
}

pub fn register_global_shortcuts(app: &AppHandle, settings: &AppSettings) -> Result<(), String> {
    let shortcuts = get_toggle_main_window_shortcuts(settings);
    let capture_selected_text_on_activation =
        settings.experimental.capture_selected_text_on_activation;

    info!(
        action = TOGGLE_MAIN_WINDOW_ACTION,
        shortcuts = ?shortcuts,
        capture_selected_text_on_activation,
        "registering global shortcuts"
    );

    let global_shortcut = app.global_shortcut();

    global_shortcut.unregister_all().map_err(|error| {
        error!(
            error = %error,
            "failed to unregister global shortcuts"
        );
        error.to_string()
    })?;

    debug!("unregistered existing global shortcuts");

    for shortcut in shortcuts {
        let Some(parsed) = parse_shortcut(&shortcut) else {
            warn!(
                shortcut = %shortcut,
                "invalid global shortcut ignored"
            );
            continue;
        };

        debug!(
            shortcut = %shortcut,
            parsed = ?parsed,
            "registering global shortcut"
        );

        let app_handle = app.clone();
        let capture_selected_text_on_activation = capture_selected_text_on_activation;

        global_shortcut
            .on_shortcut(parsed, move |_app, pressed_shortcut, event| {
                if pressed_shortcut == &parsed && event.state() == ShortcutState::Pressed {
                    debug!(
                        shortcut = ?pressed_shortcut,
                        "global shortcut pressed"
                    );

                    toggle_window(&app_handle, capture_selected_text_on_activation);
                }
            })
            .map_err(|error| {
                error!(
                    shortcut = %shortcut,
                    error = %error,
                    "failed to register global shortcut"
                );
                error.to_string()
            })?;
    }

    Ok(())
}

fn load_settings(settings_path: &Path) -> Result<AppSettings, String> {
    debug!(
        settings_path = %settings_path.display(),
        "loading settings for global shortcuts"
    );

    let content = std::fs::read_to_string(settings_path).map_err(|error| {
        error!(
            settings_path = %settings_path.display(),
            error = %error,
            "failed to read settings file"
        );
        error.to_string()
    })?;

    serde_json::from_str(&content).map_err(|error| {
        error!(
            settings_path = %settings_path.display(),
            error = %error,
            "failed to parse settings file"
        );
        error.to_string()
    })
}

fn get_toggle_main_window_shortcuts(settings: &AppSettings) -> Vec<String> {
    match settings.keybindings.get(TOGGLE_MAIN_WINDOW_ACTION) {
        Some(KeybindingValue::One(shortcut)) => vec![shortcut.clone()],
        Some(KeybindingValue::Many(shortcuts)) => shortcuts.clone(),
        None => vec![default_toggle_shortcut_label()],
    }
}

fn default_toggle_shortcut_label() -> String {
    #[cfg(target_os = "windows")]
    let shortcut = "Alt+Space";

    #[cfg(target_os = "linux")]
    let shortcut = "Ctrl+Space";

    #[cfg(target_os = "macos")]
    let shortcut = "Meta+Space";

    shortcut.to_string()
}

fn normalize_selected_text_for_query(text: &str) -> Option<String> {
    let normalized = text.split_whitespace().collect::<Vec<_>>().join(" ");
    let trimmed = normalized.trim();

    if trimmed.is_empty() {
        return None;
    }

    Some(trim_to_char_limit(trimmed, MAX_SELECTED_TEXT_QUERY_CHARS))
}

fn trim_to_char_limit(value: &str, limit: usize) -> String {
    value.chars().take(limit).collect()
}

fn parse_shortcut(value: &str) -> Option<Shortcut> {
    let mut modifiers = Modifiers::empty();
    let mut code: Option<Code> = None;

    for part in value.split('+').map(str::trim) {
        match part.to_lowercase().as_str() {
            "ctrl" | "control" => modifiers |= Modifiers::CONTROL,
            "shift" => modifiers |= Modifiers::SHIFT,
            "alt" => modifiers |= Modifiers::ALT,
            "meta" | "cmd" | "command" | "super" => modifiers |= Modifiers::SUPER,
            key => {
                code = parse_code(key);
            }
        }
    }

    code.map(|code| {
        if modifiers.is_empty() {
            Shortcut::new(None, code)
        } else {
            Shortcut::new(Some(modifiers), code)
        }
    })
}

fn parse_code(key: &str) -> Option<Code> {
    match key.to_lowercase().as_str() {
        "space" => Some(Code::Space),
        "enter" => Some(Code::Enter),
        "escape" | "esc" => Some(Code::Escape),
        "tab" => Some(Code::Tab),
        "arrowup" => Some(Code::ArrowUp),
        "arrowdown" => Some(Code::ArrowDown),
        "arrowleft" => Some(Code::ArrowLeft),
        "arrowright" => Some(Code::ArrowRight),
        "home" => Some(Code::Home),
        "end" => Some(Code::End),
        "pageup" => Some(Code::PageUp),
        "pagedown" => Some(Code::PageDown),
        "," => Some(Code::Comma),
        "/" => Some(Code::Slash),
        "." => Some(Code::Period),
        key if key.len() == 1 => {
            let ch = key.chars().next()?;

            match ch {
                'a' => Some(Code::KeyA),
                'b' => Some(Code::KeyB),
                'c' => Some(Code::KeyC),
                'd' => Some(Code::KeyD),
                'e' => Some(Code::KeyE),
                'f' => Some(Code::KeyF),
                'g' => Some(Code::KeyG),
                'h' => Some(Code::KeyH),
                'i' => Some(Code::KeyI),
                'j' => Some(Code::KeyJ),
                'k' => Some(Code::KeyK),
                'l' => Some(Code::KeyL),
                'm' => Some(Code::KeyM),
                'n' => Some(Code::KeyN),
                'o' => Some(Code::KeyO),
                'p' => Some(Code::KeyP),
                'q' => Some(Code::KeyQ),
                'r' => Some(Code::KeyR),
                's' => Some(Code::KeyS),
                't' => Some(Code::KeyT),
                'u' => Some(Code::KeyU),
                'v' => Some(Code::KeyV),
                'w' => Some(Code::KeyW),
                'x' => Some(Code::KeyX),
                'y' => Some(Code::KeyY),
                'z' => Some(Code::KeyZ),
                '0' => Some(Code::Digit0),
                '1' => Some(Code::Digit1),
                '2' => Some(Code::Digit2),
                '3' => Some(Code::Digit3),
                '4' => Some(Code::Digit4),
                '5' => Some(Code::Digit5),
                '6' => Some(Code::Digit6),
                '7' => Some(Code::Digit7),
                '8' => Some(Code::Digit8),
                '9' => Some(Code::Digit9),
                _ => None,
            }
        }
        _ => None,
    }
}

fn toggle_window(app: &AppHandle, capture_selected_text_on_activation: bool) {
    let Some(window) = app.get_webview_window("main") else {
        warn!("main window not found");
        return;
    };

    let is_visible = window.is_visible().unwrap_or(false);
    let is_minimized = window.is_minimized().unwrap_or(false);
    let is_active = is_main_window_active(&window);

    debug!(is_visible, is_minimized, is_active, "toggling main window");

    if is_visible && is_active {
        if let Err(error) = window.hide() {
            error!(
                error = %error,
                "failed to hide main window"
            );
        }
    } else {
        let selected_text = if capture_selected_text_on_activation {
            get_selected_text_for_query()
        } else {
            None
        };

        if let Err(error) = window.show() {
            error!(
                error = %error,
                "failed to show main window"
            );
            return;
        }

        if is_minimized {
            if let Err(error) = window.unminimize() {
                warn!(
                    error = %error,
                    "failed to unminimize main window"
                );
            }
        }

        if let Err(error) = window.set_focus() {
            warn!(
                error = %error,
                "failed to focus main window"
            );
        }

        if let Err(error) = window.emit("window-focused", WindowFocusedPayload { selected_text }) {
            warn!(
                error = %error,
                "failed to emit window-focused event"
            );
        }
    }
}

fn is_main_window_active(window: &WebviewWindow) -> bool {
    window.is_focused().unwrap_or(false) || is_foreground_window(window)
}

#[cfg(target_os = "windows")]
fn is_foreground_window(window: &WebviewWindow) -> bool {
    use windows::Win32::UI::WindowsAndMessaging::GetForegroundWindow;

    let Ok(hwnd) = window.hwnd() else {
        return false;
    };

    unsafe { GetForegroundWindow() == hwnd }
}

#[cfg(not(target_os = "windows"))]
fn is_foreground_window(_window: &WebviewWindow) -> bool {
    false
}

#[cfg(target_os = "windows")]
fn get_selected_text_for_query() -> Option<String> {
    match windows_selection::read_selected_text() {
        Ok(selected_text) => {
            selected_text.and_then(|text| normalize_selected_text_for_query(&text))
        }
        Err(error) => {
            debug!(
                error = %error,
                "failed to read selected text for shortcut query"
            );
            None
        }
    }
}

#[cfg(not(target_os = "windows"))]
fn get_selected_text_for_query() -> Option<String> {
    None
}

#[cfg(target_os = "windows")]
mod windows_selection {
    use std::collections::VecDeque;

    use tracing::debug;
    use windows::core::HRESULT;
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_INPROC_SERVER,
        COINIT_APARTMENTTHREADED,
    };
    use windows::Win32::UI::Accessibility::{
        CUIAutomation, IUIAutomation, IUIAutomationElement, IUIAutomationTextPattern,
        IUIAutomationTreeWalker, UIA_TextPatternId,
    };
    use windows::Win32::UI::WindowsAndMessaging::GetForegroundWindow;

    const MAX_ANCESTORS_TO_CHECK: usize = 8;
    const MAX_DESCENDANTS_TO_CHECK: usize = 80;
    const MAX_CHILDREN_PER_ELEMENT: usize = 32;
    const RPC_E_CHANGED_MODE: HRESULT = HRESULT(0x80010106u32 as i32);

    pub fn read_selected_text() -> Result<Option<String>, String> {
        let _com = ComApartment::initialize()?;

        unsafe {
            let automation: IUIAutomation =
                CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER)
                    .map_err(|error| format!("CoCreateInstance failed: {error}"))?;

            if let Ok(focused) = automation.GetFocusedElement() {
                if let Some(text) = selected_text_from_element(&focused)? {
                    debug!(
                        source = "focused",
                        char_count = text.chars().count(),
                        "read selected text for shortcut query"
                    );
                    return Ok(Some(text));
                }

                let walker = automation
                    .RawViewWalker()
                    .map_err(|error| format!("RawViewWalker failed: {error}"))?;

                if let Some(text) = selected_text_from_ancestors(&walker, &focused)? {
                    debug!(
                        source = "ancestor",
                        char_count = text.chars().count(),
                        "read selected text for shortcut query"
                    );
                    return Ok(Some(text));
                }
            }

            let foreground_hwnd = GetForegroundWindow();
            if foreground_hwnd.is_invalid() {
                return Ok(None);
            }

            let root = automation
                .ElementFromHandle(foreground_hwnd)
                .map_err(|error| format!("ElementFromHandle failed: {error}"))?;
            let walker = automation
                .RawViewWalker()
                .map_err(|error| format!("RawViewWalker failed: {error}"))?;

            let selected_text = selected_text_from_descendants(&walker, &root)?;

            if let Some(text) = &selected_text {
                debug!(
                    source = "foreground_descendant",
                    char_count = text.chars().count(),
                    "read selected text for shortcut query"
                );
            } else {
                debug!("no selected text found for shortcut query");
            }

            Ok(selected_text)
        }
    }

    fn selected_text_from_ancestors(
        walker: &IUIAutomationTreeWalker,
        element: &IUIAutomationElement,
    ) -> Result<Option<String>, String> {
        let mut current = element.clone();

        for _ in 0..MAX_ANCESTORS_TO_CHECK {
            let Ok(parent) = (unsafe { walker.GetParentElement(&current) }) else {
                break;
            };

            if let Some(text) = selected_text_from_element(&parent)? {
                return Ok(Some(text));
            }

            current = parent;
        }

        Ok(None)
    }

    fn selected_text_from_descendants(
        walker: &IUIAutomationTreeWalker,
        root: &IUIAutomationElement,
    ) -> Result<Option<String>, String> {
        let mut queue = VecDeque::from([root.clone()]);
        let mut checked_count = 0usize;

        while let Some(element) = queue.pop_front() {
            checked_count += 1;
            if checked_count > MAX_DESCENDANTS_TO_CHECK {
                break;
            }

            if let Some(text) = selected_text_from_element(&element)? {
                return Ok(Some(text));
            }

            enqueue_children(walker, &element, &mut queue);
        }

        Ok(None)
    }

    fn enqueue_children(
        walker: &IUIAutomationTreeWalker,
        element: &IUIAutomationElement,
        queue: &mut VecDeque<IUIAutomationElement>,
    ) {
        let Ok(mut child) = (unsafe { walker.GetFirstChildElement(element) }) else {
            return;
        };

        for _ in 0..MAX_CHILDREN_PER_ELEMENT {
            queue.push_back(child.clone());

            let Ok(next_sibling) = (unsafe { walker.GetNextSiblingElement(&child) }) else {
                break;
            };

            child = next_sibling;
        }
    }

    fn selected_text_from_element(
        element: &IUIAutomationElement,
    ) -> Result<Option<String>, String> {
        let Ok(text_pattern) =
            (unsafe { element.GetCurrentPatternAs::<IUIAutomationTextPattern>(UIA_TextPatternId) })
        else {
            return Ok(None);
        };

        let Ok(ranges) = (unsafe { text_pattern.GetSelection() }) else {
            return Ok(None);
        };
        let Ok(length) = (unsafe { ranges.Length() }) else {
            return Ok(None);
        };

        if length <= 0 {
            return Ok(None);
        }

        let mut selected_parts = Vec::new();

        for index in 0..length {
            let Ok(range) = (unsafe { ranges.GetElement(index) }) else {
                continue;
            };
            let Ok(text) = (unsafe { range.GetText(-1) }) else {
                continue;
            };
            let text = text.to_string();

            if !text.trim().is_empty() {
                selected_parts.push(text);
            }
        }

        if selected_parts.is_empty() {
            Ok(None)
        } else {
            Ok(Some(selected_parts.join(" ")))
        }
    }

    struct ComApartment {
        should_uninitialize: bool,
    }

    impl ComApartment {
        fn initialize() -> Result<Self, String> {
            let result = unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) };

            if result.is_ok() {
                return Ok(Self {
                    should_uninitialize: true,
                });
            }

            if result == RPC_E_CHANGED_MODE {
                return Ok(Self {
                    should_uninitialize: false,
                });
            }

            Err(format!("CoInitializeEx failed: {result:?}"))
        }
    }

    impl Drop for ComApartment {
        fn drop(&mut self) {
            if self.should_uninitialize {
                unsafe {
                    CoUninitialize();
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    use std::collections::HashMap;

    fn settings_with_keybinding(value: KeybindingValue) -> AppSettings {
        let mut settings = AppSettings::default();

        settings
            .keybindings
            .insert(TOGGLE_MAIN_WINDOW_ACTION.to_string(), value);

        settings
    }

    #[test]
    fn get_toggle_main_window_shortcuts_returns_single_shortcut() {
        let settings = settings_with_keybinding(KeybindingValue::One("Ctrl+Space".to_string()));

        assert_eq!(
            get_toggle_main_window_shortcuts(&settings),
            vec!["Ctrl+Space".to_string()]
        );
    }

    #[test]
    fn get_toggle_main_window_shortcuts_returns_many_shortcuts() {
        let settings = settings_with_keybinding(KeybindingValue::Many(vec![
            "Ctrl+Space".to_string(),
            "Alt+Space".to_string(),
        ]));

        assert_eq!(
            get_toggle_main_window_shortcuts(&settings),
            vec!["Ctrl+Space".to_string(), "Alt+Space".to_string()]
        );
    }

    #[test]
    fn get_toggle_main_window_shortcuts_returns_default_when_missing() {
        let mut settings = AppSettings::default();
        settings.keybindings = HashMap::new();

        assert_eq!(
            get_toggle_main_window_shortcuts(&settings),
            vec![default_toggle_shortcut_label()]
        );
    }

    #[test]
    fn parse_shortcut_accepts_ctrl_space() {
        let shortcut = parse_shortcut("Ctrl+Space");

        assert!(shortcut.is_some());
    }

    #[test]
    fn parse_shortcut_accepts_modifier_aliases() {
        assert!(parse_shortcut("Control+Space").is_some());
        assert!(parse_shortcut("Cmd+Space").is_some());
        assert!(parse_shortcut("Command+Space").is_some());
        assert!(parse_shortcut("Super+Space").is_some());
        assert!(parse_shortcut("Meta+Space").is_some());
    }

    #[test]
    fn parse_shortcut_accepts_lowercase_and_spaces() {
        let shortcut = parse_shortcut(" ctrl + space ");

        assert!(shortcut.is_some());
    }

    #[test]
    fn parse_shortcut_accepts_single_key() {
        let shortcut = parse_shortcut("Space");

        assert!(shortcut.is_some());
    }

    #[test]
    fn parse_shortcut_rejects_unknown_key() {
        let shortcut = parse_shortcut("Ctrl+UnknownKey");

        assert!(shortcut.is_none());
    }

    #[test]
    fn parse_shortcut_rejects_modifier_only() {
        let shortcut = parse_shortcut("Ctrl+Shift");

        assert!(shortcut.is_none());
    }

    #[test]
    fn parse_code_accepts_special_keys() {
        assert_eq!(parse_code("space"), Some(Code::Space));
        assert_eq!(parse_code("enter"), Some(Code::Enter));
        assert_eq!(parse_code("escape"), Some(Code::Escape));
        assert_eq!(parse_code("esc"), Some(Code::Escape));
        assert_eq!(parse_code("tab"), Some(Code::Tab));
        assert_eq!(parse_code("arrowup"), Some(Code::ArrowUp));
        assert_eq!(parse_code("arrowdown"), Some(Code::ArrowDown));
        assert_eq!(parse_code("arrowleft"), Some(Code::ArrowLeft));
        assert_eq!(parse_code("arrowright"), Some(Code::ArrowRight));
        assert_eq!(parse_code("home"), Some(Code::Home));
        assert_eq!(parse_code("end"), Some(Code::End));
        assert_eq!(parse_code("pageup"), Some(Code::PageUp));
        assert_eq!(parse_code("pagedown"), Some(Code::PageDown));
    }

    #[test]
    fn parse_code_accepts_symbols() {
        assert_eq!(parse_code(","), Some(Code::Comma));
        assert_eq!(parse_code("/"), Some(Code::Slash));
        assert_eq!(parse_code("."), Some(Code::Period));
    }

    #[test]
    fn parse_code_accepts_letters() {
        assert_eq!(parse_code("a"), Some(Code::KeyA));
        assert_eq!(parse_code("z"), Some(Code::KeyZ));
        assert_eq!(parse_code("A"), Some(Code::KeyA));
    }

    #[test]
    fn parse_code_accepts_digits() {
        assert_eq!(parse_code("0"), Some(Code::Digit0));
        assert_eq!(parse_code("9"), Some(Code::Digit9));
    }

    #[test]
    fn parse_code_rejects_unknown_key() {
        assert_eq!(parse_code("unknown"), None);
    }

    #[test]
    fn parse_code_rejects_empty_key() {
        assert_eq!(parse_code(""), None);
    }

    #[test]
    fn normalize_selected_text_for_query_trims_and_collapses_whitespace() {
        assert_eq!(
            normalize_selected_text_for_query("  hello\r\n  world\tagain  "),
            Some("hello world again".to_string())
        );
    }

    #[test]
    fn normalize_selected_text_for_query_rejects_blank_text() {
        assert_eq!(normalize_selected_text_for_query(" \n\t "), None);
    }

    #[test]
    fn trim_to_char_limit_preserves_char_boundaries() {
        assert_eq!(trim_to_char_limit("日本語abc", 4), "日本語a");
    }
}

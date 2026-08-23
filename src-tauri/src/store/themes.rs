//! Custom CSS theme storage.
//!
//! This module manages user-provided CSS themes.
//!
//! Theme files are stored under:
//!
//! ```text
//! <app_data_dir>/themes/*.css
//! ```
//!
//! Each `.css` file becomes one custom theme.
//!
//! Example:
//!
//! ```text
//! tokyo-night.css
//! ```
//!
//! becomes:
//!
//! ```text
//! id   = "tokyo-night"
//! name = "Tokyo Night"
//! ```

use std::fs;
use std::path::{Path, PathBuf};

use tracing::{debug, info, warn};

use crate::models::theme::CssTheme;

const THEMES_DIR: &str = "themes";
const MAX_THEME_CSS_SIZE_BYTES: u64 = 100 * 1024;

const BUILT_IN_THEME_IDS: &[&str] = &["dark", "nord", "sepia"];

pub fn themes_dir(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join(THEMES_DIR)
}

pub fn ensure_themes_dir(app_data_dir: &Path) -> Result<PathBuf, String> {
    let dir = themes_dir(app_data_dir);

    debug!(
        themes_dir = %dir.display(),
        "ensuring themes directory"
    );

    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    Ok(dir)
}

pub fn load_custom_themes(app_data_dir: &Path) -> Result<Vec<CssTheme>, String> {
    let dir = ensure_themes_dir(app_data_dir)?;

    debug!(
        themes_dir = %dir.display(),
        "loading custom CSS themes"
    );

    let mut themes = Vec::new();

    for entry in fs::read_dir(&dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();

        if !path.is_file() {
            continue;
        }

        if is_hidden_file(&path) {
            continue;
        }

        if path.extension().and_then(|ext| ext.to_str()) != Some("css") {
            continue;
        }

        let Some(id) = theme_id_from_path(&path) else {
            warn!(
                theme_path = %path.display(),
                "theme skipped because file name is invalid"
            );
            continue;
        };

        if BUILT_IN_THEME_IDS.contains(&id.as_str()) {
            warn!(
                theme_path = %path.display(),
                id = %id,
                "custom theme skipped because it conflicts with a built-in theme"
            );
            continue;
        }

        let metadata = fs::metadata(&path).map_err(|e| e.to_string())?;

        if metadata.len() > MAX_THEME_CSS_SIZE_BYTES {
            warn!(
                theme_path = %path.display(),
                size = metadata.len(),
                max_size = MAX_THEME_CSS_SIZE_BYTES,
                "custom theme skipped because CSS file is too large"
            );
            continue;
        }

        let css = fs::read_to_string(&path).map_err(|e| e.to_string())?;

        if css.trim().is_empty() {
            warn!(
                theme_path = %path.display(),
                "custom theme skipped because CSS file is empty"
            );
            continue;
        }

        if !contains_theme_selector(&css, &id) {
            warn!(
                theme_path = %path.display(),
                id = %id,
                "custom theme skipped because the matching data-theme selector was not found"
            );
            continue;
        }

        debug!(
            theme_path = %path.display(),
            id = %id,
            "loaded custom CSS theme"
        );

        themes.push(CssTheme {
            name: theme_name_from_id(&id),
            id,
            css,
        });
    }

    themes.sort_by(|a, b| a.name.cmp(&b.name));

    info!(count = themes.len(), "custom CSS themes loaded");

    Ok(themes)
}

fn is_hidden_file(path: &Path) -> bool {
    path.file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| name.starts_with('.'))
}

fn theme_id_from_path(path: &Path) -> Option<String> {
    let id = path.file_stem()?.to_str()?.trim();

    if is_valid_theme_id(id) {
        Some(id.to_string())
    } else {
        None
    }
}

fn is_valid_theme_id(id: &str) -> bool {
    !id.is_empty()
        && id
            .chars()
            .all(|ch| ch.is_ascii_lowercase() || ch.is_ascii_digit() || ch == '-')
}

fn theme_name_from_id(id: &str) -> String {
    id.split('-')
        .filter(|part| !part.is_empty())
        .map(capitalize_ascii)
        .collect::<Vec<_>>()
        .join(" ")
}

fn capitalize_ascii(value: &str) -> String {
    let mut chars = value.chars();

    let Some(first) = chars.next() else {
        return String::new();
    };

    format!("{}{}", first.to_ascii_uppercase(), chars.as_str())
}

fn contains_theme_selector(css: &str, theme_id: &str) -> bool {
    let double_quoted = format!(r#"[data-theme="{theme_id}"]"#);
    let single_quoted = format!("[data-theme='{theme_id}']");

    css.contains(&double_quoted) || css.contains(&single_quoted)
}

#[cfg(test)]
mod tests {
    use super::*;

    use std::time::{SystemTime, UNIX_EPOCH};

    fn unique_test_dir(name: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();

        std::env::temp_dir().join(format!("glimpse_css_themes_test_{unique}_{name}"))
    }

    fn sample_theme_css(id: &str) -> String {
        format!(
            r#"
[data-theme="{id}"] {{
  --background: #1a1b26;
  --foreground: #c0caf5;
  --app-bg: #16161e;
  --main-bg: #1a1b26;
}}
"#
        )
    }

    #[test]
    fn themes_dir_returns_themes_subdirectory() {
        let app_dir = PathBuf::from("/tmp/glimpse");

        assert_eq!(themes_dir(&app_dir), app_dir.join("themes"));
    }

    #[test]
    fn ensure_themes_dir_creates_directory() {
        let app_dir = unique_test_dir("create_directory");

        let themes_dir = ensure_themes_dir(&app_dir).unwrap();

        assert!(themes_dir.is_dir());
        assert_eq!(themes_dir, app_dir.join("themes"));

        fs::remove_dir_all(app_dir).ok();
    }

    #[test]
    fn load_custom_themes_creates_directory_when_missing() {
        let app_dir = unique_test_dir("missing_directory");

        let themes = load_custom_themes(&app_dir).unwrap();

        assert!(themes.is_empty());
        assert!(app_dir.join("themes").is_dir());

        fs::remove_dir_all(app_dir).ok();
    }

    #[test]
    fn load_custom_themes_loads_valid_css_theme() {
        let app_dir = unique_test_dir("valid_theme");
        let themes_dir = ensure_themes_dir(&app_dir).unwrap();

        fs::write(
            themes_dir.join("tokyo-night.css"),
            sample_theme_css("tokyo-night"),
        )
        .unwrap();

        let themes = load_custom_themes(&app_dir).unwrap();

        assert_eq!(themes.len(), 1);
        assert_eq!(themes[0].id, "tokyo-night");
        assert_eq!(themes[0].name, "Tokyo Night");
        assert!(themes[0].css.contains(r#"[data-theme="tokyo-night"]"#));

        fs::remove_dir_all(app_dir).ok();
    }

    #[test]
    fn load_custom_themes_accepts_single_quoted_selector() {
        let app_dir = unique_test_dir("single_quotes");
        let themes_dir = ensure_themes_dir(&app_dir).unwrap();

        fs::write(
            themes_dir.join("tokyo-night.css"),
            r#"
[data-theme='tokyo-night'] {
  --app-bg: #16161e;
}
"#,
        )
        .unwrap();

        let themes = load_custom_themes(&app_dir).unwrap();

        assert_eq!(themes.len(), 1);
        assert_eq!(themes[0].id, "tokyo-night");

        fs::remove_dir_all(app_dir).ok();
    }

    #[test]
    fn load_custom_themes_ignores_non_css_files() {
        let app_dir = unique_test_dir("non_css");
        let themes_dir = ensure_themes_dir(&app_dir).unwrap();

        fs::write(
            themes_dir.join("tokyo-night.json"),
            r#"{"id":"tokyo-night"}"#,
        )
        .unwrap();

        fs::write(themes_dir.join("README.md"), "# Custom themes").unwrap();

        let themes = load_custom_themes(&app_dir).unwrap();

        assert!(themes.is_empty());

        fs::remove_dir_all(app_dir).ok();
    }

    #[test]
    fn load_custom_themes_skips_hidden_css_files() {
        let app_dir = unique_test_dir("hidden");
        let themes_dir = ensure_themes_dir(&app_dir).unwrap();

        fs::write(
            themes_dir.join(".tokyo-night.css"),
            sample_theme_css("tokyo-night"),
        )
        .unwrap();

        let themes = load_custom_themes(&app_dir).unwrap();

        assert!(themes.is_empty());

        fs::remove_dir_all(app_dir).ok();
    }

    #[test]
    fn load_custom_themes_skips_empty_css_files() {
        let app_dir = unique_test_dir("empty");
        let themes_dir = ensure_themes_dir(&app_dir).unwrap();

        fs::write(themes_dir.join("empty.css"), " \n\t ").unwrap();

        let themes = load_custom_themes(&app_dir).unwrap();

        assert!(themes.is_empty());

        fs::remove_dir_all(app_dir).ok();
    }

    #[test]
    fn load_custom_themes_skips_built_in_theme_ids() {
        let app_dir = unique_test_dir("built_in");
        let themes_dir = ensure_themes_dir(&app_dir).unwrap();

        for id in BUILT_IN_THEME_IDS {
            fs::write(themes_dir.join(format!("{id}.css")), sample_theme_css(id)).unwrap();
        }

        let themes = load_custom_themes(&app_dir).unwrap();

        assert!(themes.is_empty());

        fs::remove_dir_all(app_dir).ok();
    }

    #[test]
    fn load_custom_themes_skips_oversized_css_files() {
        let app_dir = unique_test_dir("oversized");
        let themes_dir = ensure_themes_dir(&app_dir).unwrap();

        let mut css = sample_theme_css("large-theme");
        css.push_str(&" ".repeat(MAX_THEME_CSS_SIZE_BYTES as usize + 1));

        fs::write(themes_dir.join("large-theme.css"), css).unwrap();

        let themes = load_custom_themes(&app_dir).unwrap();

        assert!(themes.is_empty());

        fs::remove_dir_all(app_dir).ok();
    }

    #[test]
    fn load_custom_themes_skips_css_without_matching_selector() {
        let app_dir = unique_test_dir("missing_selector");
        let themes_dir = ensure_themes_dir(&app_dir).unwrap();

        fs::write(
            themes_dir.join("broken.css"),
            sample_theme_css("tokyo-night"),
        )
        .unwrap();

        let themes = load_custom_themes(&app_dir).unwrap();

        assert!(themes.is_empty());

        fs::remove_dir_all(app_dir).ok();
    }

    #[test]
    fn load_custom_themes_ignores_css_in_subdirectories() {
        let app_dir = unique_test_dir("subdirectory");
        let themes_dir = ensure_themes_dir(&app_dir).unwrap();
        let nested_dir = themes_dir.join("nested");

        fs::create_dir_all(&nested_dir).unwrap();

        fs::write(
            nested_dir.join("tokyo-night.css"),
            sample_theme_css("tokyo-night"),
        )
        .unwrap();

        let themes = load_custom_themes(&app_dir).unwrap();

        assert!(themes.is_empty());

        fs::remove_dir_all(app_dir).ok();
    }

    #[test]
    fn load_custom_themes_sorts_by_name() {
        let app_dir = unique_test_dir("sorting");
        let themes_dir = ensure_themes_dir(&app_dir).unwrap();

        fs::write(
            themes_dir.join("zebra-theme.css"),
            sample_theme_css("zebra-theme"),
        )
        .unwrap();

        fs::write(
            themes_dir.join("alpha-theme.css"),
            sample_theme_css("alpha-theme"),
        )
        .unwrap();

        let themes = load_custom_themes(&app_dir).unwrap();

        assert_eq!(themes.len(), 2);
        assert_eq!(themes[0].name, "Alpha Theme");
        assert_eq!(themes[1].name, "Zebra Theme");

        fs::remove_dir_all(app_dir).ok();
    }

    #[test]
    fn theme_id_from_path_accepts_lowercase_kebab_case() {
        let path = PathBuf::from("tokyo-night-2.css");

        assert_eq!(theme_id_from_path(&path), Some("tokyo-night-2".to_string()));
    }

    #[test]
    fn theme_id_from_path_rejects_invalid_ids() {
        assert_eq!(theme_id_from_path(Path::new("Tokyo-Night.css")), None);

        assert_eq!(theme_id_from_path(Path::new("tokyo_night.css")), None);

        assert_eq!(theme_id_from_path(Path::new("tokyo night.css")), None);
    }

    #[test]
    fn theme_name_from_id_converts_kebab_case_to_title_case() {
        assert_eq!(theme_name_from_id("tokyo-night"), "Tokyo Night");

        assert_eq!(theme_name_from_id("dark-2"), "Dark 2");
    }

    #[test]
    fn contains_theme_selector_accepts_matching_double_quoted_selector() {
        let css = r#"
[data-theme="tokyo-night"] {
  --app-bg: #16161e;
}
"#;

        assert!(contains_theme_selector(css, "tokyo-night"));
    }

    #[test]
    fn contains_theme_selector_accepts_matching_single_quoted_selector() {
        let css = r#"
[data-theme='tokyo-night'] {
  --app-bg: #16161e;
}
"#;

        assert!(contains_theme_selector(css, "tokyo-night"));
    }

    #[test]
    fn contains_theme_selector_rejects_different_theme_id() {
        let css = r#"
[data-theme="tokyo-night"] {
  --app-bg: #16161e;
}
"#;

        assert!(!contains_theme_selector(css, "broken"));
    }

    #[test]
    fn contains_theme_selector_rejects_missing_selector() {
        let css = r#"
:root {
  --app-bg: #16161e;
}
"#;

        assert!(!contains_theme_selector(css, "tokyo-night"));
    }
}

//! CSS theme definitions.
//!
//! This module defines user-provided CSS themes used by the Glimpse frontend.
//!
//! Theme files are loaded from:
//!
//! ```text
//! <app_data_dir>/themes/*.css
//! ```
//!
//! Each CSS file is treated as one theme.
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

use serde::{Deserialize, Serialize};

/// User-provided CSS theme.
///
/// The frontend injects `css` into a `<style>` element and activates the
/// theme by setting:
///
/// ```text
/// document.documentElement.dataset.theme = id
/// ```
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CssTheme {
    /// Stable theme identifier.
    ///
    /// Derived from the CSS filename stem.
    ///
    /// Example:
    ///
    /// ```text
    /// tokyo-night.css → tokyo-night
    /// ```
    pub id: String,

    /// User-visible theme name.
    ///
    /// Currently derived from the theme id.
    ///
    /// Example:
    ///
    /// ```text
    /// tokyo-night → Tokyo Night
    /// ```
    pub name: String,

    /// Raw CSS content.
    ///
    /// Expected to contain a selector such as:
    ///
    /// ```css
    /// [data-theme="tokyo-night"] {
    ///   --app-bg: #1a1b26;
    /// }
    /// ```
    pub css: String,
}

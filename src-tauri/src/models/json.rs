//! JSON index file models.
//!
//! This module defines the JSON format used to create searchable items from
//! external data files.
//!
//! Parsing flow:
//!
//! ```text
//! *.json
//!     ↓
//! JsonIndexFile
//!     ↓
//! JsonIndexItem
//!     ↓
//! IndexItem
//!     ↓
//! Search index
//! ```
//!
//! These models intentionally represent parser input only.
//! The normalized internal representation is [`IndexItem`].

use serde::Deserialize;

use crate::models::{IndexMetadata, OpenAction};

/// Root structure of a JSON index file.
///
/// A single JSON file can generate multiple searchable items.
///
/// Example:
///
/// ```json
/// {
///   "items": [
///     {
///       "title": "Rust Book",
///       "url": "https://doc.rust-lang.org/book/"
///     }
///   ]
/// }
/// ```
#[derive(Debug, Deserialize)]
pub struct JsonIndexFile {
    /// Collection of indexed entries.
    ///
    /// Each entry is converted into an `IndexItem` during parsing.
    pub items: Vec<JsonIndexItem>,
}

/// Raw JSON-defined search item.
///
/// This structure represents parser input before normalization into the
/// internal [`IndexItem`] model.
///
/// Typical use cases:
///
/// - documentation links
/// - bookmarks
/// - websites
/// - searchable link collections
/// - curated reference databases
#[derive(Debug, Deserialize)]
pub struct JsonIndexItem {
    /// User-visible title.
    ///
    /// Displayed in:
    ///
    /// - search results
    /// - sidebar lists
    /// - preview tabs
    pub title: String,

    /// Optional target URL.
    ///
    /// Used for:
    ///
    /// - iframe previews
    /// - browser opening
    /// - external actions
    ///
    /// If omitted, the item behaves as a local searchable note unless
    /// another open action is specified.
    #[serde(default)]
    pub url: Option<String>,

    /// Optional searchable description.
    ///
    /// This field improves search quality beyond title-only matching.
    ///
    /// Examples:
    ///
    /// ```text
    /// "Official Rust programming language book"
    /// ```
    #[serde(default)]
    pub desc: String,

    /// Search metadata attached to this item.
    ///
    /// Supports:
    ///
    /// - tags
    /// - aliases
    /// - starred items
    /// - hidden items
    /// - ranking boosts
    #[serde(default)]
    pub metadata: IndexMetadata,

    /// Whether the URL should be rendered inside an iframe preview.
    ///
    /// When enabled:
    ///
    /// ```text
    /// Preview → iframe
    /// Enter   → external browser
    /// ```
    ///
    /// When disabled:
    ///
    /// ```text
    /// Preview → local text
    /// Enter   → external browser
    /// ```
    ///
    /// Default:
    ///
    /// ```text
    /// true
    /// ```
    #[serde(default = "default_iframe")]
    pub iframe: bool,

    /// Optional open action override.
    ///
    /// If omitted, the parser will usually create:
    ///
    /// ```text
    /// OpenAction::External { url }
    /// ```
    #[serde(default)]
    pub open: Option<OpenAction>,
}

/// Default iframe behavior.
///
/// External URLs are rendered as iframe previews unless explicitly disabled.
fn default_iframe() -> bool {
    true
}

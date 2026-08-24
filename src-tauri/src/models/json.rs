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

use serde::{Deserialize, Deserializer};

use crate::models::DefaultAction;

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
    /// If omitted, the item behaves as a local searchable note unless a
    /// command is specified.
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

    /// Optional full description. Wins over `desc` when both are present.
    #[serde(default)]
    pub description: String,

    /// Searchable tags.
    #[serde(default, deserialize_with = "deserialize_string_vec")]
    pub tags: Vec<String>,

    /// Searchable aliases.
    #[serde(default, deserialize_with = "deserialize_string_vec")]
    pub aliases: Vec<String>,

    /// Starred state.
    #[serde(default)]
    pub star: bool,

    /// Hidden state.
    #[serde(default)]
    pub hidden: bool,

    /// Search ranking boost.
    #[serde(default)]
    pub boost: f32,

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
    #[serde(default)]
    pub iframe: Option<bool>,

    /// Optional command associated with the item.
    #[serde(default)]
    pub command: Option<String>,

    /// Optional explicit default action.
    #[serde(default, alias = "defaultAction")]
    pub default_action: Option<DefaultAction>,
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum StringOrStringVec {
    Single(String),
    Multiple(Vec<String>),
}

fn deserialize_string_vec<'de, D>(deserializer: D) -> Result<Vec<String>, D::Error>
where
    D: Deserializer<'de>,
{
    let values = match StringOrStringVec::deserialize(deserializer)? {
        StringOrStringVec::Single(value) => vec![value],
        StringOrStringVec::Multiple(values) => values,
    };

    Ok(values)
}

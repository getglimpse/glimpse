//! Search dictionary definitions.
//!
//! This module defines searchable content sources available in Glimpse.
//!
//! A dictionary represents a logical search source such as:
//!
//! - built-in internal pages
//! - local filesystem collections
//! - future prebuilt indexes
//!
//! Dictionaries may participate in:
//!
//! - indexing
//! - search
//! - target group selection
//! - global search

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// Search dictionary metadata.
///
/// A dictionary represents one searchable source inside Glimpse.
///
/// Examples:
///
/// - internal pages (`Settings`, `Help`)
/// - local Markdown collections
/// - future premium/prebuilt indexes
///
/// Dictionaries are intentionally lightweight metadata objects.
/// The actual indexing and search implementation lives elsewhere.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Dictionary {
    /// Stable unique identifier.
    ///
    /// This ID is used internally for:
    ///
    /// - search requests
    /// - settings
    /// - target groups
    pub id: String,

    /// User-visible dictionary name.
    pub name: String,

    /// Dictionary source type.
    pub kind: DictionaryKind,

    /// Whether the dictionary participates in indexing and search.
    pub is_enabled: bool,
}

/// Dictionary source variants.
///
/// This enum encodes valid source states at the type level.
///
/// Examples:
///
/// - `Internal` never has a filesystem path.
/// - `Custom` always requires a local path.
/// - `Premium` stores version information.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum DictionaryKind {
    /// Built-in internal dictionary.
    ///
    /// Examples:
    ///
    /// - settings
    /// - help
    /// - calculator
    /// - date utilities
    Internal,

    /// User-managed local filesystem source.
    ///
    /// Files under this path are indexed and searched locally.
    ///
    /// Current backend:
    ///
    /// - SQLite FTS5
    Custom {
        /// Absolute filesystem path.
        path: PathBuf,
    },

    /// Prebuilt large-scale dictionary source.
    ///
    /// Intended for future distribution of official indexes or
    /// premium content packages.
    ///
    /// Possible future implementations:
    ///
    /// - Tantivy indexes
    /// - downloadable search packs
    /// - offline documentation bundles
    Premium {
        /// Dictionary version identifier.
        version: String,
    },
}

impl Dictionary {
    /// Creates a built-in internal dictionary.
    ///
    /// Newly created dictionaries are enabled by default.
    pub fn new_internal(id: impl Into<String>, name: impl Into<String>) -> Self {
        Self {
            id: id.into(),
            name: name.into(),
            kind: DictionaryKind::Internal,
            is_enabled: true,
        }
    }

    /// Creates a custom filesystem dictionary.
    ///
    /// The supplied path should point to the root directory to be indexed.
    ///
    /// Newly created dictionaries are enabled by default.
    pub fn new_custom(id: impl Into<String>, name: impl Into<String>, path: PathBuf) -> Self {
        Self {
            id: id.into(),
            name: name.into(),
            kind: DictionaryKind::Custom { path },
            is_enabled: true,
        }
    }

    /// Creates a premium dictionary definition.
    ///
    /// Newly created dictionaries are enabled by default.
    pub fn new_premium(
        id: impl Into<String>,
        name: impl Into<String>,
        version: impl Into<String>,
    ) -> Self {
        Self {
            id: id.into(),
            name: name.into(),
            kind: DictionaryKind::Premium {
                version: version.into(),
            },
            is_enabled: true,
        }
    }

    /// Sets whether this dictionary is enabled.
    ///
    /// Disabled dictionaries may be excluded from indexing and search,
    /// depending on the active runtime configuration.
    pub fn set_enabled(mut self, is_enabled: bool) -> Self {
        self.is_enabled = is_enabled;
        self
    }
}

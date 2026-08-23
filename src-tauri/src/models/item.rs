//! Core searchable item models.
//!
//! This module defines the primary domain models used throughout Glimpse.
//!
//! Main structures:
//!
//! ```text
//! IndexItem
//! ├─ IndexMetadata
//! ├─ Preview
//! └─ OpenAction?
//! ```
//!
//! `IndexItem` is the central object exchanged between:
//!
//! - filesystem indexer
//! - search engines
//! - SQLite storage
//! - IPC commands
//! - frontend UI
//!
//! Most backend operations eventually produce or consume `IndexItem`.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

/// Search and ranking metadata attached to an [`IndexItem`].
///
/// This structure intentionally groups metadata separately from the core item
/// so that search-related features can evolve without expanding the main
/// structure excessively.
///
/// Current responsibilities:
///
/// - searchable tags
/// - searchable aliases
/// - starred state
/// - hidden state
/// - ranking boost
///
/// Future additions may include:
///
/// - archived
/// - language
/// - ranking decay
/// - source classification
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexMetadata {
    /// Searchable tags.
    ///
    /// Tags are indexed separately and support:
    ///
    /// - filtering (`#tag`)
    /// - categorization
    /// - search ranking
    #[serde(default)]
    pub tags: Vec<String>,

    /// Alternative searchable names.
    ///
    /// Examples:
    ///
    /// ```text
    /// title: "Visual Studio Code"
    /// aliases:
    /// - vscode
    /// - code
    /// ```
    #[serde(default)]
    pub aliases: Vec<String>,

    /// Whether the item should appear near the top of search results.
    #[serde(default, alias = "pinned")]
    pub star: bool,

    /// Whether the item is hidden from normal search results.
    #[serde(default)]
    pub hidden: bool,

    /// Search ranking multiplier.
    ///
    /// Examples:
    ///
    /// - `1.0` → neutral
    /// - `2.0` → boosted
    /// - `0.5` → lower priority
    ///
    /// The final ranking behavior depends on the active search engine.
    #[serde(default)]
    pub boost: f32,
}

impl Default for IndexMetadata {
    fn default() -> Self {
        Self {
            tags: Vec::new(),
            aliases: Vec::new(),
            star: false,
            hidden: false,
            boost: 1.0,
        }
    }
}

impl IndexMetadata {
    /// Returns a safe ranking multiplier.
    ///
    /// Values are clamped to:
    ///
    /// ```text
    /// 0.1 ..= 10.0
    /// ```
    pub fn normalized_boost(&self) -> f32 {
        self.boost.clamp(0.1, 10.0)
    }
}

/// Core searchable item model.
///
/// `IndexItem` represents one searchable entity inside Glimpse.
///
/// Examples:
///
/// - Markdown notes
/// - Raw text documents
/// - External links
/// - Command launchers
/// - Internal pages
///
/// Each item contains:
///
/// - metadata used for ranking and filtering
/// - preview content for the main panel
/// - optional open action
///
/// The structure intentionally mirrors the frontend TypeScript type to make
/// IPC serialization predictable.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexItem {
    /// Stable item identifier.
    ///
    /// For filesystem-backed items, this is the source ID derived from the
    /// configured target directory.
    ///
    /// Examples:
    ///
    /// ```text
    /// notes/rust.md
    /// docs/api.gjson::0
    /// internal://settings
    /// ```
    ///
    /// Unlike `source_path`, this identifier is independent of the absolute
    /// filesystem location and remains stable across machines using the same
    /// workspace layout.
    pub id: String,

    /// User-visible title.
    pub title: String,

    /// Absolute filesystem path of the source file.
    ///
    /// Used for:
    ///
    /// - opening the source file
    /// - revealing the file in the system file manager
    /// - reading file contents
    ///
    /// This value is OS-specific and should not be used as a persistent
    /// identifier.
    pub source_path: Option<String>,

    /// Last update timestamp.
    ///
    /// Used by:
    ///
    /// - recent item sorting
    /// - ranking heuristics
    /// - indexing statistics
    pub updated_at: DateTime<Utc>,

    /// Search and ranking metadata.
    pub metadata: IndexMetadata,

    /// Preview displayed in the main panel.
    pub preview: Preview,

    /// Optional action executed when the item is opened.
    pub open: Option<OpenAction>,
}

impl IndexItem {
    /// Creates a minimal searchable item.
    ///
    /// Metadata uses default values and may be customized using the builder
    /// methods below.
    pub fn new(
        id: impl Into<String>,
        title: impl Into<String>,
        updated_at: DateTime<Utc>,
        preview: Preview,
    ) -> Self {
        Self {
            id: id.into(),
            title: title.into(),
            source_path: None,
            updated_at,
            metadata: IndexMetadata::default(),
            preview,
            open: None,
        }
    }

    /// Sets searchable tags.
    pub fn with_tags(mut self, tags: Vec<String>) -> Self {
        self.metadata.tags = tags;
        self
    }

    /// Sets searchable aliases.
    pub fn with_aliases(mut self, aliases: Vec<String>) -> Self {
        self.metadata.aliases = aliases;
        self
    }

    /// Sets starred state.
    pub fn set_star(mut self, star: bool) -> Self {
        self.metadata.star = star;
        self
    }

    /// Sets hidden state.
    pub fn set_hidden(mut self, hidden: bool) -> Self {
        self.metadata.hidden = hidden;
        self
    }

    /// Sets search ranking boost.
    pub fn set_boost(mut self, boost: f32) -> Self {
        self.metadata.boost = boost.clamp(0.1, 10.0);
        self
    }

    /// Configures the open action.
    pub fn with_open_action(mut self, open: OpenAction) -> Self {
        self.open = Some(open);
        self
    }

    /// Attaches a source file path.
    pub fn with_source_path(mut self, source_path: impl Into<String>) -> Self {
        self.source_path = Some(source_path.into());
        self
    }
}

/// Preview representation displayed in the main panel.
///
/// This enum is serialized as a tagged union so that the frontend can perform
/// discriminated union matching.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum Preview {
    /// Markdown preview rendered locally.
    Markdown { content: String },

    /// Plain text preview.
    Raw { content: String },

    /// External webpage preview.
    External { url: String },

    /// Preview rendered by a frontend plugin viewer.
    PluginViewer {
        #[serde(rename = "pluginId", alias = "plugin_id")]
        plugin_id: String,
        #[serde(rename = "viewerId", alias = "viewer_id")]
        viewer_id: String,
    },
}

#[cfg(test)]
mod tests {
    use super::Preview;

    #[test]
    fn plugin_viewer_preview_serializes_camel_case_fields() {
        let preview = Preview::PluginViewer {
            plugin_id: "pdf-viewer-plugin".to_string(),
            viewer_id: "pdf".to_string(),
        };

        let value = serde_json::to_value(preview).unwrap();

        assert_eq!(value["type"], "pluginViewer");
        assert_eq!(value["pluginId"], "pdf-viewer-plugin");
        assert_eq!(value["viewerId"], "pdf");
        assert!(value.get("plugin_id").is_none());
        assert!(value.get("viewer_id").is_none());
    }
}

/// Action executed when an item is opened.
///
/// Preview and open actions are intentionally separated because:
///
/// - an item may preview locally but open externally
/// - an item may render text but execute a command
/// - preview does not imply execution
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum OpenAction {
    /// Opens a URL using the system browser.
    External { url: String },

    /// Executes a command.
    ///
    /// The path is validated before execution.
    Command { path: String },
}

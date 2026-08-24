//! Application statistics models.
//!
//! This module defines aggregated statistics about the current Glimpse index.
//!
//! Statistics are calculated from the SQLite database and exposed to the
//! frontend through IPC commands.
//!
//! Typical consumers:
//!
//! - About page
//! - Debug page
//! - Internal diagnostics
//!
//! Statistics represent the currently indexed state and are updated as files
//! are indexed, modified, or removed.

use serde::Serialize;

/// Aggregated application statistics.
///
/// All values represent counts of indexed items or metadata derived from the
/// current search index.
///
/// Statistics are collected by:
///
/// - `store::item_repository::get_app_stats()`
///
/// and exposed through:
///
/// - `commands::stats::get_stats()`
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppStats {
    /// Total number of indexed items.
    pub total_items: i64,

    /// Number of Markdown preview items.
    pub markdown_items: i64,

    /// Number of raw text preview items.
    pub raw_items: i64,

    /// Number of external preview items.
    ///
    /// These are usually iframe or URL previews.
    pub external_items: i64,

    /// Number of command-launcher items.
    ///
    /// Items with an item command.
    pub command_items: i64,

    /// Number of items that open external URLs.
    ///
    /// Items with an item URL.
    pub external_open_items: i64,

    /// Number of starred items.
    pub star_items: i64,

    /// Number of items with at least one tag.
    pub tagged_items: i64,

    /// Number of items with at least one alias.
    pub alias_items: i64,
}

/// Aggregated tag usage for the current visible index.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TagCloudEntry {
    /// Normalized tag text.
    pub tag: String,

    /// Number of visible items that have this tag.
    pub count: i64,
}

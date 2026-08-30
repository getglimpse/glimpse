//! Fuzzy search support for the SQLite search backend.
//!
//! This module provides a fallback-style fuzzy filter used when a query should
//! match items even if it does not exactly match the SQLite FTS index.
//!
//! Fuzzy matching is performed in two steps:
//!
//! 1. Load a bounded number of search candidates from SQLite.
//! 2. Score each candidate in Rust using Jaro-Winkler similarity.
//!
//! The fuzzy score is calculated from:
//!
//! - item title
//! - metadata tags
//! - metadata aliases
//!
//! This module intentionally keeps the candidate set bounded because fuzzy
//! scoring runs in memory and is more expensive than normal FTS matching.

use rusqlite::Connection;
use strsim::jaro_winkler;

use crate::models::IndexItem;
use crate::search::{SearchError, SearchResult};

use super::mapper::map_search_result;
use super::sql;

/// Maximum number of SQLite rows loaded before in-memory fuzzy scoring.
///
/// This prevents fuzzy search from scanning the entire index on large
/// workspaces.
const FUZZY_CANDIDATE_LIMIT: i64 = 500;

/// Minimum Jaro-Winkler score required for a fuzzy match.
///
/// Values closer to `1.0` are stricter. Values closer to `0.0` are looser.
const FUZZY_THRESHOLD: f64 = 0.75;

/// Performs fuzzy filtering against SQLite search candidates.
///
/// The query is normalized and compared against each candidate's title, tags,
/// and aliases. Results below [`FUZZY_THRESHOLD`] are discarded.
///
/// Returned results are sorted by fuzzy score in descending order and truncated
/// to `limit`, or ascending score order when `reverse_order` is enabled.
///
/// Returns an empty list when the query is blank.
pub fn fuzzy_filter_results(
    db: &Connection,
    query: &str,
    limit: usize,
    unstar_only: bool,
    hidden_only: bool,
    reverse_order: bool,
) -> Result<Vec<SearchResult>, SearchError> {
    let query = query.trim();

    if query.is_empty() {
        return Ok(Vec::new());
    }

    let mut stmt = db
        .prepare(sql::SELECT_FUZZY_CANDIDATES)
        .map_err(|e| SearchError::DbError(e.to_string()))?;

    let hidden_i64 = if hidden_only { 1_i64 } else { 0_i64 };
    let unstar_i64 = if unstar_only { 1_i64 } else { 0_i64 };

    let rows = stmt
        .query_map(
            [hidden_i64, unstar_i64, FUZZY_CANDIDATE_LIMIT],
            map_search_result,
        )
        .map_err(|e| SearchError::DbError(e.to_string()))?;

    let mut scored = Vec::new();

    for row in rows {
        let mut result = row.map_err(|e| SearchError::DbError(e.to_string()))?;

        let score = fuzzy_score(query, &result.item);

        if score >= FUZZY_THRESHOLD {
            result.score = score as f32;
            scored.push(result);
        }
    }

    scored.sort_by(|a, b| {
        let ordering = a
            .score
            .partial_cmp(&b.score)
            .unwrap_or(std::cmp::Ordering::Equal);

        if reverse_order {
            ordering
        } else {
            ordering.reverse()
        }
    });

    scored.truncate(limit);

    Ok(scored)
}

/// Calculates the fuzzy similarity score for an index item.
///
/// The final score is the highest Jaro-Winkler similarity among:
///
/// - title
/// - tags
/// - aliases
///
/// Content body is intentionally not included to keep fuzzy scoring lightweight.
fn fuzzy_score(query: &str, item: &IndexItem) -> f64 {
    let query = normalize(query);

    let title_score = jaro_winkler(&query, &normalize(&item.title));

    let tag_score = item
        .metadata
        .tags
        .iter()
        .map(|tag| jaro_winkler(&query, &normalize(tag)))
        .fold(0.0, f64::max);

    let alias_score = item
        .metadata
        .aliases
        .iter()
        .map(|alias| jaro_winkler(&query, &normalize(alias)))
        .fold(0.0, f64::max);

    title_score.max(tag_score).max(alias_score)
}

/// Normalizes text before fuzzy comparison.
///
/// Current normalization:
///
/// - trims surrounding whitespace
/// - converts text to lowercase
fn normalize(value: &str) -> String {
    value.trim().to_lowercase()
}

#[cfg(test)]
mod tests {
    use super::*;

    use chrono::Utc;

    use crate::models::{IndexItem, Preview};

    #[test]
    fn fuzzy_score_matches_similar_title() {
        let item = IndexItem::new(
            "item-1",
            "Rust Book",
            Utc::now(),
            Preview::Markdown {
                content: String::new(),
            },
        );

        let score = fuzzy_score("rust bok", &item);

        assert!(score >= FUZZY_THRESHOLD);
    }

    #[test]
    fn fuzzy_score_matches_alias() {
        let item = IndexItem::new(
            "item-1",
            "Rust",
            Utc::now(),
            Preview::Markdown {
                content: String::new(),
            },
        )
        .with_aliases(vec!["rustlang".to_string()]);

        let score = fuzzy_score("rustlng", &item);

        assert!(score >= FUZZY_THRESHOLD);
    }

    #[test]
    fn fuzzy_score_rejects_unrelated_item() {
        let item = IndexItem::new(
            "item-1",
            "SQLite",
            Utc::now(),
            Preview::Markdown {
                content: String::new(),
            },
        );

        let score = fuzzy_score("rust", &item);

        assert!(score < FUZZY_THRESHOLD);
    }
}

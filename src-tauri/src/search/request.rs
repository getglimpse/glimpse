//! Search request construction utilities.
//!
//! This module centralizes creation and normalization of
//! [`SearchRequest`] values.
//!
//! Responsibilities:
//!
//! - frontend request normalization
//! - default search configuration
//! - dictionary filtering
//! - global search configuration
//! - request construction helpers
//!
//! By constructing requests here, all entrypoints can share
//! identical search behavior:
//!
//! - Tauri IPC commands
//! - CLI tools
//! - plugins
//! - future HTTP APIs
//!
//! This module does not perform searches directly.
//! Query execution is delegated to implementations of
//! [`SearchEngine`].

use super::SearchRequest;

/// Default maximum number of search results.
///
/// Used when the caller does not explicitly provide
/// a result limit.
pub const DEFAULT_SEARCH_LIMIT: usize = 50;

/// Builds a normalized [`SearchRequest`].
///
/// Applied defaults:
///
/// - default result limit (`DEFAULT_SEARCH_LIMIT`)
/// - optional dictionary filter
/// - optional global search mode
/// - optional unstar-only mode
/// - optional hidden-only mode
/// - optional reverse result ordering
///
/// # Arguments
///
/// - `query`
///
///   Raw user search query.
///
/// - `dictionary_id`
///
///   Optional dictionary or target-group identifier.
///
///   When specified, the search is restricted to that source.
///
/// - `limit`
///
///   Maximum number of results.
///
///   If omitted, [`DEFAULT_SEARCH_LIMIT`] is used.
///
/// - `global`
///
///   Enables global search across all available dictionaries
///   or target groups.
///
/// - `hidden_only`
///
///   Returns hidden items instead of normal visible results.
///
/// - `unstar_only`
///
///   Returns unstarred items only.
///
/// - `reverse_order`
///
///   Returns matched results in ascending score order when enabled.
///
/// # Returns
///
/// A fully initialized [`SearchRequest`] ready to be executed
/// by a search engine.
///
/// # Notes
///
/// Empty queries are allowed.
///
/// Depending on the search engine implementation, an empty
/// query is typically interpreted as:
///
/// - recent items
/// - starred items
/// - browsing mode
/// - default landing results
pub fn build_search_request(
    query: String,
    dictionary_id: Option<String>,
    limit: Option<usize>,
    global: bool,
    unstar_only: bool,
    hidden_only: bool,
    reverse_order: bool,
) -> SearchRequest {
    let mut req = SearchRequest::new(query, limit.unwrap_or(DEFAULT_SEARCH_LIMIT))
        .global(global)
        .unstar_only(unstar_only)
        .hidden_only(hidden_only)
        .reverse_order(reverse_order);

    if let Some(id) = dictionary_id {
        req = req.with_dictionary(id);
    }

    req
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_normal_search_request() {
        let req = build_search_request(
            "rust".to_string(),
            None,
            Some(25),
            false,
            false,
            false,
            false,
        );

        assert_eq!(req.query, "rust");
        assert_eq!(req.limit, 25);
        assert_eq!(req.dictionary_id, None);
        assert!(!req.global);
        assert!(!req.unstar_only);
        assert!(!req.hidden_only);
        assert!(!req.reverse_order);
    }

    #[test]
    fn builds_global_search_request() {
        let req = build_search_request(
            "rust".to_string(),
            None,
            Some(25),
            true,
            false,
            false,
            false,
        );

        assert_eq!(req.query, "rust");
        assert_eq!(req.limit, 25);
        assert!(req.global);
        assert!(!req.hidden_only);
    }

    #[test]
    fn keeps_dictionary_filter() {
        let req = build_search_request(
            "rust".to_string(),
            Some("work".to_string()),
            None,
            true,
            false,
            false,
            false,
        );

        assert_eq!(req.query, "rust");
        assert_eq!(req.limit, DEFAULT_SEARCH_LIMIT);
        assert_eq!(req.dictionary_id, Some("work".to_string()));
        assert!(req.global);
    }

    #[test]
    fn builds_hidden_search_request() {
        let req = build_search_request(
            "rust".to_string(),
            None,
            Some(25),
            false,
            false,
            true,
            false,
        );

        assert!(req.hidden_only);
    }

    #[test]
    fn builds_unstar_search_request() {
        let req = build_search_request(
            "rust".to_string(),
            None,
            Some(25),
            false,
            true,
            false,
            false,
        );

        assert!(req.unstar_only);
    }

    #[test]
    fn builds_reverse_order_search_request() {
        let req = build_search_request(
            "rust".to_string(),
            None,
            Some(25),
            false,
            false,
            false,
            true,
        );

        assert!(req.reverse_order);
    }
}

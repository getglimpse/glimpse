//! SQLite FTS5 query rendering.
//!
//! User input is parsed into a structured query first. This module only renders
//! that structure into SQLite FTS5 `MATCH` syntax, which is necessarily a
//! string because it is the API exposed by SQLite.

use crate::search::query::{SearchTerm, StructuredQuery};

/// Builds a SQLite FTS5 `MATCH` query.
///
/// Normal text terms and `#tag` terms are combined with `AND`. The final string
/// is intended for SQLite FTS5 `MATCH` only.
pub fn build_match_query(input: &str) -> String {
    render_match_query(&StructuredQuery::parse(input))
}

pub fn render_match_query(query: &StructuredQuery) -> String {
    let mut text_tokens = Vec::new();
    let mut tag_tokens = Vec::new();

    for term in query.terms() {
        match term {
            SearchTerm::Text(token) => {
                text_tokens.push(Fts5Term::prefix(token.value()).render());
            }
            SearchTerm::Tag(token) => {
                tag_tokens.push(Fts5Term::field_prefix("tags", token.value()).render());
            }
        }
    }

    let mut clauses = Vec::new();

    if !text_tokens.is_empty() {
        clauses.push(format!("({})", text_tokens.join(" AND ")));
    }

    clauses.extend(tag_tokens);
    clauses.join(" AND ")
}

/// Returns whether the input contains at least one valid tag filter.
pub fn contains_tag_filter(input: &str) -> bool {
    StructuredQuery::parse(input).has_tag_filter()
}

struct Fts5Term<'a> {
    field: Option<&'a str>,
    value: &'a str,
    prefix: bool,
}

impl<'a> Fts5Term<'a> {
    fn prefix(value: &'a str) -> Self {
        Self {
            field: None,
            value,
            prefix: true,
        }
    }

    fn field_prefix(field: &'a str, value: &'a str) -> Self {
        Self {
            field: Some(field),
            value,
            prefix: true,
        }
    }

    fn render(&self) -> String {
        let field = self
            .field
            .map(|field| format!("{field}:"))
            .unwrap_or_default();
        let suffix = if self.prefix { "*" } else { "" };

        format!("{field}{}{suffix}", self.value)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_query_returns_empty_string() {
        assert_eq!(build_match_query(""), "");
    }

    #[test]
    fn whitespace_only_returns_empty_string() {
        assert_eq!(build_match_query("   \n\t  "), "");
    }

    #[test]
    fn builds_single_text_token() {
        assert_eq!(build_match_query("rust"), "(rust*)");
    }

    #[test]
    fn builds_multiple_text_tokens() {
        assert_eq!(
            build_match_query("rust tauri sqlite"),
            "(rust* AND tauri* AND sqlite*)"
        );
    }

    #[test]
    fn builds_single_tag_token() {
        assert_eq!(build_match_query("#rust"), "tags:rust*");
    }

    #[test]
    fn builds_multiple_tag_tokens() {
        assert_eq!(
            build_match_query("#rust #tauri"),
            "tags:rust* AND tags:tauri*"
        );
    }

    #[test]
    fn builds_mixed_query() {
        assert_eq!(
            build_match_query("rust tauri #sqlite"),
            "(rust* AND tauri*) AND tags:sqlite*"
        );
    }

    #[test]
    fn builds_mixed_query_multiple_tags() {
        assert_eq!(
            build_match_query("rust #tauri #sqlite"),
            "(rust*) AND tags:tauri* AND tags:sqlite*"
        );
    }

    #[test]
    fn ignores_empty_tag() {
        assert_eq!(build_match_query("#"), "");
    }

    #[test]
    fn ignores_empty_tag_in_mixed_query() {
        assert_eq!(build_match_query("rust #"), "(rust*)");
    }

    #[test]
    fn preserves_token_order() {
        assert_eq!(build_match_query("tauri rust"), "(tauri* AND rust*)");
    }

    #[test]
    fn detects_tag_filter() {
        assert!(contains_tag_filter("#rust"));
        assert!(contains_tag_filter("memo #rust"));
        assert!(contains_tag_filter("#rust tauri"));
    }

    #[test]
    fn does_not_detect_empty_tag_filter() {
        assert!(!contains_tag_filter("#"));
        assert!(!contains_tag_filter("memo #"));
        assert!(!contains_tag_filter("memo"));
        assert!(!contains_tag_filter(""));
    }

    #[test]
    fn builds_match_query_with_tag_filter() {
        assert_eq!(build_match_query("memo #rust"), "(memo*) AND tags:rust*");
    }
}

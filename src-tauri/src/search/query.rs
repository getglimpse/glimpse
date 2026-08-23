//! Structured search query parsing shared by search backends.
//!
//! Backends should parse user input into [`StructuredQuery`] first, then render
//! or compile that structure into their native query representation.

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StructuredQuery {
    terms: Vec<SearchTerm>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SearchTerm {
    Text(QueryToken),
    Tag(QueryToken),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct QueryToken {
    value: String,
    prefix: bool,
}

impl StructuredQuery {
    pub fn parse(input: &str) -> Self {
        let terms = input
            .split_whitespace()
            .filter_map(|raw| {
                if let Some(tag) = raw.strip_prefix('#') {
                    return (!tag.is_empty()).then(|| SearchTerm::Tag(QueryToken::prefix(tag)));
                }

                Some(SearchTerm::Text(QueryToken::for_text(raw)))
            })
            .collect();

        Self { terms }
    }

    pub fn is_empty(&self) -> bool {
        self.terms.is_empty()
    }

    pub fn has_tag_filter(&self) -> bool {
        self.terms
            .iter()
            .any(|term| matches!(term, SearchTerm::Tag(_)))
    }

    pub fn terms(&self) -> &[SearchTerm] {
        &self.terms
    }
}

impl QueryToken {
    fn prefix(value: &str) -> Self {
        Self {
            value: value.to_string(),
            prefix: true,
        }
    }

    fn for_text(value: &str) -> Self {
        Self {
            value: value.to_string(),
            prefix: should_prefix_match(value),
        }
    }

    pub fn value(&self) -> &str {
        &self.value
    }

    pub fn is_prefix(&self) -> bool {
        self.prefix
    }
}

fn should_prefix_match(value: &str) -> bool {
    !value.is_empty()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_text_and_tag_terms() {
        let query = StructuredQuery::parse("rust tauri #sqlite");

        assert_eq!(
            query.terms(),
            &[
                SearchTerm::Text(QueryToken::prefix("rust")),
                SearchTerm::Text(QueryToken::prefix("tauri")),
                SearchTerm::Tag(QueryToken::prefix("sqlite")),
            ]
        );
    }

    #[test]
    fn ignores_empty_tags() {
        let query = StructuredQuery::parse("rust #");

        assert_eq!(
            query.terms(),
            &[SearchTerm::Text(QueryToken::prefix("rust"))]
        );
    }

    #[test]
    fn prefixes_non_ascii_text() {
        let query = StructuredQuery::parse("日本語");

        assert_eq!(
            query.terms(),
            &[SearchTerm::Text(QueryToken {
                value: "日本語".to_string(),
                prefix: true,
            })]
        );
    }

    #[test]
    fn detects_tag_filter_from_structure() {
        assert!(StructuredQuery::parse("memo #rust").has_tag_filter());
        assert!(!StructuredQuery::parse("memo #").has_tag_filter());
    }
}

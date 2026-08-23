use tantivy::schema::{TantivyDocument, Value};

use crate::search::query::{QueryToken, SearchTerm, StructuredQuery};
use crate::search::{
    SearchSnippet, SearchSnippetChunk, SearchSnippetFragment, SearchSnippetSource,
};

use super::schema::{TantivyFields, DOCUMENT_KIND_CHUNK, DOCUMENT_KIND_ITEM};

const CONTEXT_CHARS: usize = 48;

#[derive(Clone, Copy)]
struct SnippetToken<'a> {
    value: &'a str,
    prefix: bool,
}

pub(super) fn build_snippet(
    fields: TantivyFields,
    document: &TantivyDocument,
    query: &StructuredQuery,
) -> Option<SearchSnippet> {
    let document_kind = field_text(document, fields.doc_kind)?;

    match document_kind {
        DOCUMENT_KIND_CHUNK => build_body_snippet(fields, document, query),
        DOCUMENT_KIND_ITEM => build_item_snippet(fields, document, query),
        _ => None,
    }
}

fn build_body_snippet(
    fields: TantivyFields,
    document: &TantivyDocument,
    query: &StructuredQuery,
) -> Option<SearchSnippet> {
    let text = field_text(document, fields.chunk_text)?;
    let tokens = text_tokens(query);
    let fragments = snippet_fragments(text, &tokens)?;

    Some(SearchSnippet {
        source: SearchSnippetSource::Body,
        fragments,
        chunk: Some(SearchSnippetChunk {
            ordinal: field_u64(document, fields.chunk_ordinal).unwrap_or(0) as usize,
            start_byte: field_u64(document, fields.chunk_start_byte).unwrap_or(0) as usize,
            end_byte: field_u64(document, fields.chunk_end_byte).unwrap_or(0) as usize,
        }),
    })
}

fn build_item_snippet(
    fields: TantivyFields,
    document: &TantivyDocument,
    query: &StructuredQuery,
) -> Option<SearchSnippet> {
    let text_tokens = text_tokens(query);

    if let Some(text) = field_text(document, fields.aliases.japanese) {
        if let Some(fragments) = snippet_fragments(text, &text_tokens) {
            return Some(SearchSnippet {
                source: SearchSnippetSource::Alias,
                fragments,
                chunk: None,
            });
        }
    }

    let tag_tokens = tag_tokens(query);
    let mut tokens = Vec::with_capacity(tag_tokens.len() + text_tokens.len());
    tokens.extend(tag_tokens);
    tokens.extend(text_tokens);

    if let Some(tags) = field_text(document, fields.tags) {
        if let Some(fragments) = snippet_fragments(tags, &tokens) {
            return Some(SearchSnippet {
                source: SearchSnippetSource::Tag,
                fragments,
                chunk: None,
            });
        }
    }

    field_text(document, fields.title.japanese).and_then(|title| {
        snippet_fragments(title, &tokens).map(|fragments| SearchSnippet {
            source: SearchSnippetSource::Title,
            fragments,
            chunk: None,
        })
    })
}

fn text_tokens(query: &StructuredQuery) -> Vec<SnippetToken<'_>> {
    query
        .terms()
        .iter()
        .filter_map(|term| match term {
            SearchTerm::Text(token) => Some(snippet_token(token)),
            SearchTerm::Tag(_) => None,
        })
        .collect()
}

fn tag_tokens(query: &StructuredQuery) -> Vec<SnippetToken<'_>> {
    query
        .terms()
        .iter()
        .filter_map(|term| match term {
            SearchTerm::Text(_) => None,
            SearchTerm::Tag(token) => Some(snippet_token(token)),
        })
        .collect()
}

fn snippet_token(token: &QueryToken) -> SnippetToken<'_> {
    SnippetToken {
        value: token.value(),
        prefix: token.is_prefix(),
    }
}

fn snippet_fragments(
    text: &str,
    tokens: &[SnippetToken<'_>],
) -> Option<Vec<SearchSnippetFragment>> {
    let (match_start, match_end) = find_match(text, tokens)?;
    let context_start = context_start(text, match_start, CONTEXT_CHARS);
    let context_end = context_end(text, match_end, CONTEXT_CHARS);

    let mut fragments = Vec::new();
    push_fragment(
        &mut fragments,
        with_leading_marker(&text[context_start..match_start], context_start > 0),
        false,
    );
    push_fragment(
        &mut fragments,
        text[match_start..match_end].to_string(),
        true,
    );
    push_fragment(
        &mut fragments,
        with_trailing_marker(&text[match_end..context_end], context_end < text.len()),
        false,
    );

    Some(fragments)
}

fn push_fragment(fragments: &mut Vec<SearchSnippetFragment>, text: String, matched: bool) {
    if text.is_empty() {
        return;
    }

    fragments.push(SearchSnippetFragment { text, matched });
}

fn with_leading_marker(text: &str, truncated: bool) -> String {
    if truncated {
        format!("...{text}")
    } else {
        text.to_string()
    }
}

fn with_trailing_marker(text: &str, truncated: bool) -> String {
    if truncated {
        format!("{text}...")
    } else {
        text.to_string()
    }
}

fn find_match(text: &str, tokens: &[SnippetToken<'_>]) -> Option<(usize, usize)> {
    tokens
        .iter()
        .filter_map(|token| find_token_match(text, *token))
        .min_by_key(|(start, _)| *start)
}

fn find_token_match(text: &str, token: SnippetToken<'_>) -> Option<(usize, usize)> {
    let needle = token.value.trim();

    if needle.is_empty() {
        return None;
    }

    let folded_needle = needle.to_lowercase();

    text.char_indices().find_map(|(start, _)| {
        let suffix = &text[start..];
        let match_len = matching_prefix_len(suffix, &folded_needle)?;

        if token.prefix || suffix[..match_len].chars().count() == needle.chars().count() {
            Some((start, start + match_len))
        } else {
            None
        }
    })
}

fn matching_prefix_len(text: &str, folded_needle: &str) -> Option<usize> {
    let mut folded = String::new();
    let mut end = 0;

    for (index, ch) in text.char_indices() {
        folded.extend(ch.to_lowercase());
        end = index + ch.len_utf8();

        if folded.len() >= folded_needle.len() {
            break;
        }
    }

    folded.starts_with(folded_needle).then_some(end)
}

fn context_start(text: &str, match_start: usize, context_chars: usize) -> usize {
    text[..match_start]
        .char_indices()
        .rev()
        .nth(context_chars.saturating_sub(1))
        .map(|(index, _)| index)
        .unwrap_or(0)
}

fn context_end(text: &str, match_end: usize, context_chars: usize) -> usize {
    text[match_end..]
        .char_indices()
        .nth(context_chars)
        .map(|(index, _)| match_end + index)
        .unwrap_or(text.len())
}

fn field_text(document: &TantivyDocument, field: tantivy::schema::Field) -> Option<&str> {
    document.get_first(field).and_then(|value| value.as_str())
}

fn field_u64(document: &TantivyDocument, field: tantivy::schema::Field) -> Option<u64> {
    document.get_first(field).and_then(|value| value.as_u64())
}

#[cfg(test)]
mod tests {
    use super::*;

    use tantivy::schema::TantivyDocument;

    use crate::search::query::StructuredQuery;
    use crate::search::tantivy::schema::{build_schema, DOCUMENT_KIND_CHUNK, DOCUMENT_KIND_ITEM};

    #[test]
    fn builds_body_snippet_from_chunk_text() {
        let (_, fields) = build_schema();
        let mut document = TantivyDocument::default();
        document.add_text(fields.doc_kind, DOCUMENT_KIND_CHUNK);
        document.add_text(fields.chunk_text, "before lindera body after");
        document.add_u64(fields.chunk_ordinal, 2);
        document.add_u64(fields.chunk_start_byte, 10);
        document.add_u64(fields.chunk_end_byte, 35);

        let snippet = build_snippet(fields, &document, &StructuredQuery::parse("lindera")).unwrap();

        assert_eq!(snippet.source, SearchSnippetSource::Body);
        assert_eq!(
            snippet.chunk,
            Some(SearchSnippetChunk {
                ordinal: 2,
                start_byte: 10,
                end_byte: 35,
            })
        );
        assert_eq!(
            snippet.fragments,
            vec![
                SearchSnippetFragment {
                    text: "before ".to_string(),
                    matched: false,
                },
                SearchSnippetFragment {
                    text: "lindera".to_string(),
                    matched: true,
                },
                SearchSnippetFragment {
                    text: " body after".to_string(),
                    matched: false,
                },
            ]
        );
    }

    #[test]
    fn builds_alias_snippet_for_item_document() {
        let (_, fields) = build_schema();
        let mut document = TantivyDocument::default();
        document.add_text(fields.doc_kind, DOCUMENT_KIND_ITEM);
        document.add_text(fields.aliases.japanese, "rustlang notes");
        document.add_text(fields.tags, "sqlite");

        let snippet = build_snippet(fields, &document, &StructuredQuery::parse("rust")).unwrap();

        assert_eq!(snippet.source, SearchSnippetSource::Alias);
        assert!(snippet.fragments.iter().any(|fragment| fragment.matched));
    }

    #[test]
    fn builds_tag_snippet_for_item_document() {
        let (_, fields) = build_schema();
        let mut document = TantivyDocument::default();
        document.add_text(fields.doc_kind, DOCUMENT_KIND_ITEM);
        document.add_text(fields.tags, "sqlite");

        let snippet = build_snippet(fields, &document, &StructuredQuery::parse("#sql")).unwrap();

        assert_eq!(snippet.source, SearchSnippetSource::Tag);
        assert_eq!(
            snippet.fragments,
            vec![
                SearchSnippetFragment {
                    text: "sql".to_string(),
                    matched: true,
                },
                SearchSnippetFragment {
                    text: "ite".to_string(),
                    matched: false,
                },
            ]
        );
    }

    #[test]
    fn builds_title_snippet_for_item_document() {
        let (_, fields) = build_schema();
        let mut document = TantivyDocument::default();
        document.add_text(fields.doc_kind, DOCUMENT_KIND_ITEM);
        document.add_text(fields.title.japanese, "Rust Notes");

        let snippet = build_snippet(fields, &document, &StructuredQuery::parse("Rust")).unwrap();

        assert_eq!(snippet.source, SearchSnippetSource::Title);
        assert_eq!(
            snippet.fragments,
            vec![
                SearchSnippetFragment {
                    text: "Rust".to_string(),
                    matched: true,
                },
                SearchSnippetFragment {
                    text: " Notes".to_string(),
                    matched: false,
                },
            ]
        );
    }

    #[test]
    fn matches_japanese_text() {
        let (_, fields) = build_schema();
        let mut document = TantivyDocument::default();
        let japanese = "\u{65e5}\u{672c}\u{8a9e}";
        document.add_text(fields.doc_kind, DOCUMENT_KIND_CHUNK);
        document.add_text(
            fields.chunk_text,
            format!("{japanese}\u{306e}\u{672c}\u{6587}"),
        );

        let snippet = build_snippet(fields, &document, &StructuredQuery::parse(japanese)).unwrap();

        assert_eq!(snippet.source, SearchSnippetSource::Body);
        assert_eq!(
            snippet.fragments.first(),
            Some(&SearchSnippetFragment {
                text: japanese.to_string(),
                matched: true,
            })
        );
    }
}

use tantivy::query::{
    BooleanQuery, BoostQuery, EmptyQuery, Occur, PhrasePrefixQuery, PhraseQuery, Query, TermQuery,
};
use tantivy::schema::{Field, FieldType, IndexRecordOption};
use tantivy::tokenizer::TokenStream;
use tantivy::{Index, Term};

use crate::search::query::{QueryToken, SearchTerm, StructuredQuery};
use crate::search::SearchError;

use super::ranking::{
    ALIASES_FIELD_BOOST, BODY_FIELD_BOOST, CHUNK_ITEM_CONTEXT_FIELD_BOOST, IDENTITY_QUERY_BOOST,
    TAG_FIELD_BOOST, TITLE_FIELD_BOOST,
};
use super::schema::{
    MultilingualTextFields, TantivyFields, DOCUMENT_KIND_CHUNK, DOCUMENT_KIND_ITEM,
};

#[derive(Clone, Copy)]
struct SearchField {
    field: Field,
    boost: f32,
}

impl SearchField {
    fn multilingual(fields: MultilingualTextFields, boost: f32) -> [Self; 2] {
        fields.fields().map(|field| Self { field, boost })
    }
}

pub(super) fn build_tantivy_query(
    index: &Index,
    fields: TantivyFields,
    query: &StructuredQuery,
) -> Result<Box<dyn Query>, SearchError> {
    let text_tokens = query
        .terms()
        .iter()
        .filter_map(|term| match term {
            SearchTerm::Text(token) => Some(token),
            SearchTerm::Tag(_) => None,
        })
        .collect::<Vec<_>>();
    let tag_tokens = query
        .terms()
        .iter()
        .filter_map(|term| match term {
            SearchTerm::Text(_) => None,
            SearchTerm::Tag(token) => Some(token),
        })
        .collect::<Vec<_>>();

    let mut branches = Vec::new();

    if let Some(query) = build_item_document_query(index, fields, &text_tokens, &tag_tokens)? {
        branches.push((Occur::Should, query));
    }

    if let Some(query) = build_chunk_document_query(index, fields, &text_tokens, &tag_tokens)? {
        branches.push((Occur::Should, query));
    }

    Ok(disjunction(branches).unwrap_or_else(|| Box::new(EmptyQuery)))
}

fn build_item_document_query(
    index: &Index,
    fields: TantivyFields,
    text_tokens: &[&QueryToken],
    tag_tokens: &[&QueryToken],
) -> Result<Option<Box<dyn Query>>, SearchError> {
    let mut clauses = Vec::new();

    for token in text_tokens {
        if let Some(query) = build_search_field_query(index, item_text_fields(fields), token)? {
            clauses.push((Occur::Must, query));
        }
    }

    for token in tag_tokens {
        if let Some(query) =
            build_field_query(index, fields.tags_filter, token, TAG_FIELD_BOOST, true)?
        {
            clauses.push((Occur::Must, query));
        }
    }

    if clauses.is_empty() {
        return Ok(None);
    }

    Ok(Some(constrain_to_document_kind(
        conjunction(clauses),
        fields,
        DOCUMENT_KIND_ITEM,
    )))
}

fn build_chunk_document_query(
    index: &Index,
    fields: TantivyFields,
    text_tokens: &[&QueryToken],
    tag_tokens: &[&QueryToken],
) -> Result<Option<Box<dyn Query>>, SearchError> {
    if text_tokens.is_empty() {
        return Ok(None);
    }

    let mut clauses = Vec::new();
    let mut body_match_queries = Vec::new();

    for token in text_tokens {
        let body_query = build_search_field_query(index, chunk_body_fields(fields), token)?;
        let context_query =
            build_search_field_query(index, chunk_item_context_fields(fields), token)?;
        let mut term_branches = Vec::new();

        if let Some(query) = body_query {
            term_branches.push((Occur::Should, query));
        }

        if let Some(query) = build_search_field_query(index, chunk_body_fields(fields), token)? {
            body_match_queries.push((Occur::Should, query));
        }

        if let Some(query) = context_query {
            term_branches.push((Occur::Should, query));
        }

        if let Some(query) = disjunction(term_branches) {
            clauses.push((Occur::Must, query));
        }
    }

    let Some(body_match_query) = disjunction(body_match_queries) else {
        return Ok(None);
    };

    clauses.push((Occur::Must, body_match_query));

    for token in tag_tokens {
        if let Some(query) =
            build_field_query(index, fields.tags_filter, token, TAG_FIELD_BOOST, true)?
        {
            clauses.push((Occur::Must, query));
        }
    }

    if clauses.is_empty() {
        return Ok(None);
    }

    Ok(Some(constrain_to_document_kind(
        conjunction(clauses),
        fields,
        DOCUMENT_KIND_CHUNK,
    )))
}

fn build_search_field_query(
    index: &Index,
    fields: Vec<SearchField>,
    token: &QueryToken,
) -> Result<Option<Box<dyn Query>>, SearchError> {
    let mut queries = Vec::new();

    for search_field in fields {
        if let Some(query) =
            build_field_query(index, search_field.field, token, search_field.boost, false)?
        {
            queries.push((Occur::Should, query));
        }
    }

    Ok(disjunction(queries))
}

fn item_text_fields(fields: TantivyFields) -> Vec<SearchField> {
    let mut search_fields = Vec::with_capacity(5);

    search_fields.extend(SearchField::multilingual(fields.title, TITLE_FIELD_BOOST));
    search_fields.push(SearchField {
        field: fields.tags,
        boost: TAG_FIELD_BOOST,
    });
    search_fields.extend(SearchField::multilingual(
        fields.aliases,
        ALIASES_FIELD_BOOST,
    ));

    search_fields
}

fn chunk_body_fields(fields: TantivyFields) -> Vec<SearchField> {
    let mut search_fields = Vec::with_capacity(2);

    search_fields.extend(SearchField::multilingual(fields.body, BODY_FIELD_BOOST));

    search_fields
}

fn chunk_item_context_fields(fields: TantivyFields) -> Vec<SearchField> {
    let mut search_fields = Vec::with_capacity(2);

    search_fields.extend(SearchField::multilingual(
        fields.chunk_item_context,
        CHUNK_ITEM_CONTEXT_FIELD_BOOST,
    ));

    search_fields
}

fn constrain_to_document_kind(
    query: Box<dyn Query>,
    fields: TantivyFields,
    document_kind: &str,
) -> Box<dyn Query> {
    Box::new(BooleanQuery::new(vec![
        (
            Occur::Must,
            Box::new(TermQuery::new(
                Term::from_field_text(fields.doc_kind, document_kind),
                IndexRecordOption::Basic,
            )),
        ),
        (Occur::Must, query),
    ]))
}

fn build_field_query(
    index: &Index,
    field: Field,
    token: &QueryToken,
    boost: f32,
    force_prefix: bool,
) -> Result<Option<Box<dyn Query>>, SearchError> {
    let (terms, index_record_option) = analyze_terms(index, field, token.value())?;

    if terms.is_empty() {
        return Ok(None);
    }

    let query: Box<dyn Query> = if force_prefix || token.is_prefix() {
        Box::new(PhrasePrefixQuery::new(terms))
    } else if terms.len() == 1 {
        Box::new(TermQuery::new(
            terms.into_iter().next().unwrap(),
            index_record_option,
        ))
    } else {
        Box::new(PhraseQuery::new(terms))
    };

    Ok(Some(apply_boost(query, boost)))
}

fn analyze_terms(
    index: &Index,
    field: Field,
    value: &str,
) -> Result<(Vec<Term>, IndexRecordOption), SearchError> {
    let schema = index.schema();
    let field_entry = schema.get_field_entry(field);
    let field_type = field_entry.field_type();

    let FieldType::Str(text_options) = field_type else {
        return Ok((Vec::new(), IndexRecordOption::Basic));
    };

    let indexing_options = text_options.get_indexing_options().ok_or_else(|| {
        SearchError::IndexError(format!("field is not indexed: {}", field_entry.name()))
    })?;

    let mut analyzer = index
        .tokenizers()
        .get(indexing_options.tokenizer())
        .ok_or_else(|| {
            SearchError::IndexError(format!(
                "unknown tokenizer for field {}: {}",
                field_entry.name(),
                indexing_options.tokenizer()
            ))
        })?;

    let mut terms = Vec::new();
    let mut token_stream = analyzer.token_stream(value);

    token_stream.process(&mut |token| {
        terms.push(Term::from_field_text(field, &token.text));
    });

    Ok((terms, indexing_options.index_option()))
}

fn apply_boost(query: Box<dyn Query>, boost: f32) -> Box<dyn Query> {
    if boost == IDENTITY_QUERY_BOOST {
        query
    } else {
        Box::new(BoostQuery::new(query, boost))
    }
}

fn conjunction(queries: Vec<(Occur, Box<dyn Query>)>) -> Box<dyn Query> {
    match queries.len() {
        0 => Box::new(EmptyQuery),
        1 => queries.into_iter().next().unwrap().1,
        _ => Box::new(BooleanQuery::new(queries)),
    }
}

fn disjunction(queries: Vec<(Occur, Box<dyn Query>)>) -> Option<Box<dyn Query>> {
    match queries.len() {
        0 => None,
        1 => Some(queries.into_iter().next().unwrap().1),
        _ => Some(Box::new(BooleanQuery::new(queries))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    use chrono::Utc;
    use tantivy::collector::Count;

    use crate::models::{IndexItem, Preview};
    use crate::search::tantivy::index::{open_or_create_index, TantivyState};
    use crate::search::tantivy::writer::{commit_index_mutation, upsert_items};

    fn temp_index_state() -> TantivyState {
        let dir =
            std::env::temp_dir().join(format!("glimpse-tantivy-query-{}", uuid::Uuid::new_v4()));

        open_or_create_index(&dir).expect("index should open")
    }

    fn sample_item() -> IndexItem {
        IndexItem::new(
            "item-1",
            "Rust Notes",
            Utc::now(),
            Preview::Markdown {
                content: "lindera body text".to_string(),
            },
        )
        .with_tags(vec!["sqlite".to_string()])
        .with_aliases(vec!["rustlang".to_string()])
    }

    fn upsert_sample_item(state: &TantivyState) {
        let item = sample_item();

        commit_index_mutation(state, |writer, fields| {
            upsert_items(writer, fields, std::slice::from_ref(&item))
        })
        .unwrap();
    }

    #[test]
    fn builds_query_object_for_text_and_tag_terms() {
        let index_state = temp_index_state();
        let query = StructuredQuery::parse("rust #sqlite");

        let tantivy_query = build_tantivy_query(&index_state.index, index_state.fields, &query)
            .expect("query should build");

        let debug = format!("{tantivy_query:?}");

        assert!(debug.contains("BooleanQuery"));
        assert!(debug.contains("Boost"));
        assert!(debug.contains("sqlite"));
    }

    #[test]
    fn builds_empty_query_for_empty_structure() {
        let index_state = temp_index_state();
        let query = StructuredQuery::parse("");

        let tantivy_query = build_tantivy_query(&index_state.index, index_state.fields, &query)
            .expect("query should build");

        assert!(format!("{tantivy_query:?}").contains("EmptyQuery"));
    }

    #[test]
    fn tag_only_query_matches_item_document_only() {
        let index_state = temp_index_state();
        upsert_sample_item(&index_state);
        let query = StructuredQuery::parse("#sqlite");

        let tantivy_query = build_tantivy_query(&index_state.index, index_state.fields, &query)
            .expect("query should build");
        let count = index_state
            .reader
            .searcher()
            .search(&tantivy_query, &Count)
            .unwrap();

        assert_eq!(count, 1);
    }

    #[test]
    fn tag_and_body_query_matches_chunk_document() {
        let index_state = temp_index_state();
        upsert_sample_item(&index_state);
        let query = StructuredQuery::parse("lindera #sqlite");

        let tantivy_query = build_tantivy_query(&index_state.index, index_state.fields, &query)
            .expect("query should build");
        let count = index_state
            .reader
            .searcher()
            .search(&tantivy_query, &Count)
            .unwrap();

        assert_eq!(count, 1);
    }

    #[test]
    fn title_and_body_query_matches_chunk_document() {
        let index_state = temp_index_state();
        upsert_sample_item(&index_state);
        let query = StructuredQuery::parse("Rust lindera");

        let tantivy_query = build_tantivy_query(&index_state.index, index_state.fields, &query)
            .expect("query should build");
        let count = index_state
            .reader
            .searcher()
            .search(&tantivy_query, &Count)
            .unwrap();

        assert_eq!(count, 1);
    }

    #[test]
    fn alias_and_body_query_matches_chunk_document() {
        let index_state = temp_index_state();
        upsert_sample_item(&index_state);
        let query = StructuredQuery::parse("rustlang lindera");

        let tantivy_query = build_tantivy_query(&index_state.index, index_state.fields, &query)
            .expect("query should build");
        let count = index_state
            .reader
            .searcher()
            .search(&tantivy_query, &Count)
            .unwrap();

        assert_eq!(count, 1);
    }

    #[test]
    fn item_context_only_query_does_not_match_chunk_document() {
        let index_state = temp_index_state();
        upsert_sample_item(&index_state);
        let query = StructuredQuery::parse("Rust rustlang");

        let tantivy_query = build_tantivy_query(&index_state.index, index_state.fields, &query)
            .expect("query should build");
        let count = index_state
            .reader
            .searcher()
            .search(&tantivy_query, &Count)
            .unwrap();

        assert_eq!(count, 1);
    }

    #[test]
    fn title_query_matches_item_document_only() {
        let index_state = temp_index_state();
        upsert_sample_item(&index_state);
        let query = StructuredQuery::parse("Rust");

        let tantivy_query = build_tantivy_query(&index_state.index, index_state.fields, &query)
            .expect("query should build");
        let count = index_state
            .reader
            .searcher()
            .search(&tantivy_query, &Count)
            .unwrap();

        assert_eq!(count, 1);
    }
}

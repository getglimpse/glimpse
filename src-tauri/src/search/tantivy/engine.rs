use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use async_trait::async_trait;
use rusqlite::Connection;
use tantivy::collector::TopDocs;
use tantivy::schema::{TantivyDocument, Value};
use tracing::{debug, info};

use crate::models::{IndexItem, Preview};
use crate::search::query::StructuredQuery;
use crate::search::{
    SearchEngine, SearchError, SearchRequest, SearchResult, SourceFingerprint, SourceReplacement,
};
use crate::store::item_repository::{
    delete_item, delete_items_by_source_id, delete_items_by_source_path, get_item_summary,
    get_preview as get_sqlite_preview, list_item_ids_by_source_id, list_item_ids_by_source_path,
    list_source_paths as list_sqlite_source_paths, recent_items, replace_source_items,
    replace_sources as replace_sqlite_sources, unchanged_source_item_count, upsert_item,
    upsert_source_fingerprint,
};

use super::index::{open_or_create_index, TantivyState};
use super::query::build_tantivy_query;
use super::ranking::{HitScore, ItemHitAccumulator, SnippetCandidate, DEFAULT_METADATA_BOOST};
use super::snippet::build_snippet;
use super::writer::{commit_index_mutation, delete_ids as delete_index_ids, upsert_items};

const TOP_DOCS_INITIAL_MULTIPLIER: usize = 4;
const TOP_DOCS_UNIQUE_CANDIDATE_MULTIPLIER: usize = 4;
const TOP_DOCS_MAX_MULTIPLIER: usize = 64;
const TOP_DOCS_MAX_ABSOLUTE_LIMIT: usize = 2_000;

/// Tantivy-backed search engine with Lindera tokenization.
pub struct TantivyEngine {
    db: Arc<Mutex<Connection>>,
    state: Mutex<TantivyEngineState>,
}

struct TantivyEngineState {
    current_index_dir: Option<PathBuf>,
    indexes: HashMap<PathBuf, TantivyState>,
}

impl TantivyEngineState {
    fn new() -> Self {
        Self {
            current_index_dir: None,
            indexes: HashMap::new(),
        }
    }
}

impl TantivyEngine {
    pub fn new(
        connection: Arc<Mutex<Connection>>,
        index_dir: PathBuf,
    ) -> Result<Self, SearchError> {
        let engine = Self {
            db: connection,
            state: Mutex::new(TantivyEngineState::new()),
        };

        engine.switch_index(index_dir)?;

        Ok(engine)
    }

    pub fn switch_index(&self, index_dir: PathBuf) -> Result<(), SearchError> {
        {
            let mut current = self
                .state
                .lock()
                .map_err(|error| SearchError::IndexError(error.to_string()))?;

            if let Some(state) = current.indexes.get(&index_dir) {
                state
                    .reader
                    .reload()
                    .map_err(|error| SearchError::IndexError(error.to_string()))?;

                current.current_index_dir = Some(index_dir.clone());

                info!(
                    index_dir = %index_dir.display(),
                    cached = true,
                    "tantivy index switched"
                );

                return Ok(());
            }
        }

        let state = open_or_create_index(&index_dir)?;

        let mut current = self
            .state
            .lock()
            .map_err(|error| SearchError::IndexError(error.to_string()))?;

        current.indexes.insert(index_dir.clone(), state);
        current.current_index_dir = Some(index_dir.clone());

        info!(
            index_dir = %index_dir.display(),
            cached = false,
            "tantivy index switched"
        );

        Ok(())
    }

    pub fn warm_index(&self, index_dir: PathBuf) -> Result<(), SearchError> {
        {
            let current = self
                .state
                .lock()
                .map_err(|error| SearchError::IndexError(error.to_string()))?;

            if let Some(state) = current.indexes.get(&index_dir) {
                state
                    .reader
                    .reload()
                    .map_err(|error| SearchError::IndexError(error.to_string()))?;

                info!(
                    index_dir = %index_dir.display(),
                    cached = true,
                    "tantivy index warmed"
                );

                return Ok(());
            }
        }

        let state = open_or_create_index(&index_dir)?;

        let mut current = self
            .state
            .lock()
            .map_err(|error| SearchError::IndexError(error.to_string()))?;

        current.indexes.insert(index_dir.clone(), state);

        info!(
            index_dir = %index_dir.display(),
            cached = false,
            "tantivy index warmed"
        );

        Ok(())
    }

    pub fn detach_index(&self) -> Result<(), SearchError> {
        let mut current = self
            .state
            .lock()
            .map_err(|error| SearchError::IndexError(error.to_string()))?;

        if let Some(index_dir) = current.current_index_dir.take() {
            current.indexes.remove(&index_dir);
        }

        info!("tantivy index detached");

        Ok(())
    }

    pub fn reload_index(&self) -> Result<(), SearchError> {
        self.with_state(|state| {
            state
                .reader
                .reload()
                .map_err(|error| SearchError::IndexError(error.to_string()))
        })
    }

    pub fn cached_index_count(&self) -> Result<usize, SearchError> {
        let current = self
            .state
            .lock()
            .map_err(|error| SearchError::IndexError(error.to_string()))?;

        Ok(current.indexes.len())
    }

    pub async fn get_preview(&self, id: &str) -> Result<Option<Preview>, SearchError> {
        let db = self.db.lock().unwrap();

        get_sqlite_preview(&db, id)
    }

    fn with_state<T>(
        &self,
        operation: impl FnOnce(&TantivyState) -> Result<T, SearchError>,
    ) -> Result<T, SearchError> {
        let current = self
            .state
            .lock()
            .map_err(|error| SearchError::IndexError(error.to_string()))?;

        let Some(index_dir) = current.current_index_dir.as_ref() else {
            return Err(SearchError::IndexError(
                "tantivy index is not attached".to_string(),
            ));
        };

        let Some(state) = current.indexes.get(index_dir) else {
            return Err(SearchError::IndexError(
                "current tantivy index is not cached".to_string(),
            ));
        };

        operation(state)
    }

    fn delete_tantivy_ids(&self, ids: &[String]) -> Result<(), SearchError> {
        if ids.is_empty() {
            return Ok(());
        }

        self.with_state(|state| {
            commit_index_mutation(state, |writer, fields| {
                delete_index_ids(writer, fields, ids)
            })
        })
    }
}

#[async_trait]
impl SearchEngine for TantivyEngine {
    async fn init(&self) -> Result<(), SearchError> {
        debug!("tantivy search engine initialized");

        Ok(())
    }

    async fn search(&self, req: SearchRequest) -> Result<Vec<SearchResult>, SearchError> {
        debug!(
            query = %req.query,
            limit = req.limit,
            hidden_only = req.hidden_only,
            "tantivy search started"
        );

        if req.query.trim().is_empty() {
            let db = self.db.lock().unwrap();
            return recent_items(&db, req.limit, req.hidden_only);
        }

        if req.limit == 0 {
            return Ok(Vec::new());
        }

        let hits = self.with_state(|state| {
            let searcher = state.reader.searcher();
            let structured_query = StructuredQuery::parse(&req.query);
            let query = build_tantivy_query(&state.index, state.fields, &structured_query)?;

            let max_top_docs_limit = max_top_docs_limit(req.limit);
            let candidate_limit = unique_candidate_limit(req.limit);
            let mut top_docs_limit = initial_top_docs_limit(req.limit);

            loop {
                let top_docs = searcher
                    .search(&query, &TopDocs::with_limit(top_docs_limit))
                    .map_err(|error| SearchError::IndexError(error.to_string()))?;
                let reached_available_docs = top_docs.len() < top_docs_limit;
                let mut hits = ItemHitAccumulator::new(candidate_limit);

                for (score, address) in top_docs {
                    let doc = searcher
                        .doc::<TantivyDocument>(address)
                        .map_err(|error| SearchError::IndexError(error.to_string()))?;

                    let Some(id) = doc
                        .get_first(state.fields.id)
                        .and_then(|value| value.as_str())
                        .map(|value| value.to_string())
                    else {
                        continue;
                    };

                    let hidden = doc
                        .get_first(state.fields.hidden)
                        .and_then(|value| value.as_u64())
                        .unwrap_or(0)
                        == 1;

                    if hidden != req.hidden_only {
                        continue;
                    }

                    let star = doc
                        .get_first(state.fields.star)
                        .and_then(|value| value.as_u64())
                        .unwrap_or(0)
                        == 1;

                    let updated_at = doc
                        .get_first(state.fields.updated_at)
                        .and_then(|value| value.as_i64())
                        .unwrap_or(0);

                    let boost = doc
                        .get_first(state.fields.boost)
                        .and_then(|value| value.as_f64())
                        .unwrap_or(DEFAULT_METADATA_BOOST as f64)
                        as f32;

                    let hit_score = HitScore::new(score, star, updated_at, boost);

                    let snippet_candidate = build_snippet(state.fields, &doc, &structured_query)
                        .map(|snippet| SnippetCandidate::new(snippet, hit_score.score()));

                    hits.push(id, hit_score, snippet_candidate);
                }

                if hits.is_full() || reached_available_docs || top_docs_limit >= max_top_docs_limit
                {
                    debug!(
                        unique_hits = hits.len(),
                        requested_limit = req.limit,
                        candidate_limit,
                        top_docs_limit,
                        "tantivy top docs collection finished"
                    );

                    break Ok(hits.into_hits());
                }

                let next_top_docs_limit = next_top_docs_limit(top_docs_limit, max_top_docs_limit);

                debug!(
                    unique_hits = hits.len(),
                    requested_limit = req.limit,
                    candidate_limit,
                    from_top_docs_limit = top_docs_limit,
                    to_top_docs_limit = next_top_docs_limit,
                    "expanding tantivy top docs fetch width"
                );

                top_docs_limit = next_top_docs_limit;
            }
        })?;

        let db = self.db.lock().unwrap();
        let mut results = Vec::new();

        for hit in hits {
            if let Some(mut result) = get_item_summary(&db, &hit.item_id, hit.score)? {
                result.snippets = hit.snippets;
                results.push(result);
            }
        }

        results.sort_by(|a, b| {
            b.score
                .partial_cmp(&a.score)
                .unwrap_or(std::cmp::Ordering::Equal)
        });

        results.truncate(req.limit);

        debug!(count = results.len(), "tantivy search completed");

        Ok(results)
    }

    async fn upsert(&self, item: IndexItem) -> Result<(), SearchError> {
        self.upsert_batch(vec![item]).await
    }

    async fn upsert_batch(&self, items: Vec<IndexItem>) -> Result<(), SearchError> {
        if items.is_empty() {
            return Ok(());
        }

        {
            let mut conn = self.db.lock().unwrap();
            let tx = conn
                .transaction()
                .map_err(|error| SearchError::DbError(error.to_string()))?;

            for item in &items {
                upsert_item(&tx, item)?;
            }

            tx.commit()
                .map_err(|error| SearchError::DbError(error.to_string()))?;
        }

        self.with_state(|state| {
            commit_index_mutation(state, |writer, fields| upsert_items(writer, fields, &items))
        })
    }

    async fn replace_source(
        &self,
        source_id: &str,
        items: Vec<IndexItem>,
        fingerprint: Option<SourceFingerprint>,
    ) -> Result<(), SearchError> {
        let ids = {
            let conn = self.db.lock().unwrap();
            list_item_ids_by_source_id(&conn, source_id)?
        };

        {
            let mut conn = self.db.lock().unwrap();
            replace_source_items(&mut conn, source_id, &items, fingerprint.as_ref())?;
        }

        self.with_state(|state| {
            commit_index_mutation(state, |writer, fields| {
                delete_index_ids(writer, fields, &ids)?;
                upsert_items(writer, fields, &items)
            })
        })
    }

    async fn replace_sources(
        &self,
        replacements: Vec<SourceReplacement>,
    ) -> Result<(), SearchError> {
        if replacements.is_empty() {
            return Ok(());
        }

        let ids = {
            let conn = self.db.lock().unwrap();
            let mut ids = Vec::new();

            for replacement in &replacements {
                ids.extend(list_item_ids_by_source_id(&conn, &replacement.source_id)?);
            }

            ids
        };

        {
            let mut conn = self.db.lock().unwrap();
            replace_sqlite_sources(&mut conn, &replacements)?;
        }

        self.with_state(|state| {
            commit_index_mutation(state, |writer, fields| {
                delete_index_ids(writer, fields, &ids)?;

                for replacement in &replacements {
                    upsert_items(writer, fields, &replacement.items)?;
                }

                Ok(())
            })
        })
    }

    async fn delete(&self, id: &str) -> Result<(), SearchError> {
        {
            let mut conn = self.db.lock().unwrap();
            let tx = conn
                .transaction()
                .map_err(|error| SearchError::DbError(error.to_string()))?;

            delete_item(&tx, id)?;

            tx.commit()
                .map_err(|error| SearchError::DbError(error.to_string()))?;
        }

        self.delete_tantivy_ids(&[id.to_string()])
    }

    async fn delete_by_source_id(&self, source_id: &str) -> Result<(), SearchError> {
        let ids = {
            let conn = self.db.lock().unwrap();
            list_item_ids_by_source_id(&conn, source_id)?
        };

        {
            let mut conn = self.db.lock().unwrap();
            let tx = conn
                .transaction()
                .map_err(|error| SearchError::DbError(error.to_string()))?;

            delete_items_by_source_id(&tx, source_id)?;

            tx.commit()
                .map_err(|error| SearchError::DbError(error.to_string()))?;
        }

        self.delete_tantivy_ids(&ids)
    }

    async fn delete_by_source_path(&self, source_path: &str) -> Result<(), SearchError> {
        let ids = {
            let conn = self.db.lock().unwrap();
            list_item_ids_by_source_path(&conn, source_path)?
        };

        {
            let mut conn = self.db.lock().unwrap();
            let tx = conn
                .transaction()
                .map_err(|error| SearchError::DbError(error.to_string()))?;

            delete_items_by_source_path(&tx, source_path)?;

            tx.commit()
                .map_err(|error| SearchError::DbError(error.to_string()))?;
        }

        self.delete_tantivy_ids(&ids)
    }

    async fn list_source_paths(&self) -> Result<Vec<String>, SearchError> {
        let db = self.db.lock().unwrap();

        list_sqlite_source_paths(&db)
    }

    async fn unchanged_source_item_count(
        &self,
        fingerprint: SourceFingerprint,
    ) -> Result<Option<usize>, SearchError> {
        let db = self.db.lock().unwrap();

        unchanged_source_item_count(&db, &fingerprint)
    }

    async fn upsert_source_fingerprint(
        &self,
        fingerprint: SourceFingerprint,
        item_count: usize,
    ) -> Result<(), SearchError> {
        let db = self.db.lock().unwrap();

        upsert_source_fingerprint(&db, &fingerprint, item_count)
    }
}

fn initial_top_docs_limit(result_limit: usize) -> usize {
    result_limit
        .saturating_mul(TOP_DOCS_INITIAL_MULTIPLIER)
        .min(TOP_DOCS_MAX_ABSOLUTE_LIMIT)
        .max(result_limit)
}

fn max_top_docs_limit(result_limit: usize) -> usize {
    result_limit
        .saturating_mul(TOP_DOCS_MAX_MULTIPLIER)
        .min(TOP_DOCS_MAX_ABSOLUTE_LIMIT)
        .max(result_limit)
        .max(initial_top_docs_limit(result_limit))
}

fn unique_candidate_limit(result_limit: usize) -> usize {
    result_limit
        .saturating_mul(TOP_DOCS_UNIQUE_CANDIDATE_MULTIPLIER)
        .min(TOP_DOCS_MAX_ABSOLUTE_LIMIT)
        .max(result_limit)
}

fn next_top_docs_limit(current_limit: usize, max_limit: usize) -> usize {
    current_limit.saturating_mul(2).min(max_limit)
}

#[cfg(test)]
mod tests {
    use super::*;

    use chrono::Utc;
    use tantivy::collector::Count;
    use tantivy::query::{BooleanQuery, Occur, TermQuery};
    use tantivy::schema::{IndexRecordOption, TantivyDocument};
    use tantivy::Term;

    use crate::models::{IndexItem, Preview};
    use crate::search::tantivy::schema::{DOCUMENT_KIND_CHUNK, DOCUMENT_KIND_ITEM};
    use crate::search::SearchSnippetSource;
    use crate::test_utils::fixtures::create_test_db;

    fn temp_index_dir(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "glimpse-tantivy-engine-{name}-{}",
            uuid::Uuid::new_v4()
        ))
    }

    fn test_engine(name: &str) -> TantivyEngine {
        test_engine_with_db(Arc::new(Mutex::new(create_test_db())), temp_index_dir(name))
    }

    fn test_engine_with_db(db: Arc<Mutex<Connection>>, index_dir: PathBuf) -> TantivyEngine {
        TantivyEngine::new(db, index_dir).expect("engine should open")
    }

    fn markdown_item(id: &str, title: &str, content: &str) -> IndexItem {
        IndexItem::new(
            id,
            title,
            Utc::now(),
            Preview::Markdown {
                content: content.to_string(),
            },
        )
    }

    fn first_snippet_text(result: &SearchResult) -> String {
        result.snippets.as_ref().unwrap()[0]
            .fragments
            .iter()
            .map(|fragment| fragment.text.as_str())
            .collect::<String>()
    }

    fn add_synthetic_chunk(
        engine: &TantivyEngine,
        id: &str,
        text: &str,
        ordinal: u64,
        boost: f32,
        star: bool,
    ) {
        engine
            .with_state(|state| {
                commit_index_mutation(state, |writer, fields| {
                    let mut document = TantivyDocument::default();

                    document.add_text(fields.id, id);
                    document.add_text(fields.doc_kind, DOCUMENT_KIND_CHUNK);

                    for field in fields.body.fields() {
                        document.add_text(field, text);
                    }

                    document.add_text(fields.chunk_text, text);
                    document.add_u64(fields.chunk_ordinal, ordinal);
                    document.add_u64(fields.chunk_start_byte, 0);
                    document.add_u64(fields.chunk_end_byte, text.len() as u64);
                    document.add_u64(fields.star, if star { 1 } else { 0 });
                    document.add_u64(fields.hidden, 0);
                    document.add_i64(fields.updated_at, 0);
                    document.add_f64(fields.boost, boost as f64);

                    writer
                        .add_document(document)
                        .map_err(|error| SearchError::IndexError(error.to_string()))?;

                    Ok(())
                })
            })
            .unwrap();
    }

    fn count_docs(engine: &TantivyEngine, id: &str) -> usize {
        engine
            .with_state(|state| {
                let query = TermQuery::new(
                    Term::from_field_text(state.fields.id, id),
                    IndexRecordOption::Basic,
                );

                state
                    .reader
                    .searcher()
                    .search(&query, &Count)
                    .map_err(|error| SearchError::IndexError(error.to_string()))
            })
            .unwrap()
    }

    fn count_docs_by_kind(engine: &TantivyEngine, id: &str, document_kind: &str) -> usize {
        engine
            .with_state(|state| {
                let query = BooleanQuery::new(vec![
                    (
                        Occur::Must,
                        Box::new(TermQuery::new(
                            Term::from_field_text(state.fields.id, id),
                            IndexRecordOption::Basic,
                        )) as Box<dyn tantivy::query::Query>,
                    ),
                    (
                        Occur::Must,
                        Box::new(TermQuery::new(
                            Term::from_field_text(state.fields.doc_kind, document_kind),
                            IndexRecordOption::Basic,
                        )),
                    ),
                ]);

                state
                    .reader
                    .searcher()
                    .search(&query, &Count)
                    .map_err(|error| SearchError::IndexError(error.to_string()))
            })
            .unwrap()
    }

    #[test]
    fn switch_index_reuses_cached_state_for_previous_index_dir() {
        let first_index_dir = temp_index_dir("cache-first");
        let second_index_dir = temp_index_dir("cache-second");
        let engine = test_engine_with_db(
            Arc::new(Mutex::new(create_test_db())),
            first_index_dir.clone(),
        );

        {
            let state = engine.state.lock().unwrap();
            assert_eq!(state.indexes.len(), 1);
            assert_eq!(state.current_index_dir.as_ref(), Some(&first_index_dir));
        }

        engine.switch_index(second_index_dir.clone()).unwrap();

        {
            let state = engine.state.lock().unwrap();
            assert_eq!(state.indexes.len(), 2);
            assert_eq!(state.current_index_dir.as_ref(), Some(&second_index_dir));
        }

        engine.switch_index(first_index_dir.clone()).unwrap();

        {
            let state = engine.state.lock().unwrap();
            assert_eq!(state.indexes.len(), 2);
            assert_eq!(state.current_index_dir.as_ref(), Some(&first_index_dir));
        }

        std::fs::remove_dir_all(first_index_dir).ok();
        std::fs::remove_dir_all(second_index_dir).ok();
    }

    #[test]
    fn warm_index_caches_index_without_switching_current_index() {
        let current_index_dir = temp_index_dir("warm-current");
        let warmed_index_dir = temp_index_dir("warm-other");
        let engine = test_engine_with_db(
            Arc::new(Mutex::new(create_test_db())),
            current_index_dir.clone(),
        );

        engine.warm_index(warmed_index_dir.clone()).unwrap();

        {
            let state = engine.state.lock().unwrap();
            assert_eq!(state.indexes.len(), 2);
            assert_eq!(state.current_index_dir.as_ref(), Some(&current_index_dir));
            assert!(state.indexes.contains_key(&warmed_index_dir));
        }

        engine.switch_index(warmed_index_dir.clone()).unwrap();

        {
            let state = engine.state.lock().unwrap();
            assert_eq!(state.indexes.len(), 2);
            assert_eq!(state.current_index_dir.as_ref(), Some(&warmed_index_dir));
        }

        std::fs::remove_dir_all(current_index_dir).ok();
        std::fs::remove_dir_all(warmed_index_dir).ok();
    }

    #[test]
    fn top_docs_limit_starts_with_initial_multiplier() {
        assert_eq!(initial_top_docs_limit(10), 40);
    }

    #[test]
    fn unique_candidate_limit_matches_initial_fetch_width() {
        assert_eq!(unique_candidate_limit(10), 40);
        assert_eq!(unique_candidate_limit(3_000), 3_000);
    }

    #[test]
    fn top_docs_limit_expands_until_maximum() {
        assert_eq!(next_top_docs_limit(40, 640), 80);
        assert_eq!(next_top_docs_limit(512, 640), 640);
    }

    #[test]
    fn max_top_docs_limit_is_capped_but_not_below_requested_limit() {
        assert_eq!(max_top_docs_limit(10), 640);
        assert_eq!(max_top_docs_limit(100), TOP_DOCS_MAX_ABSOLUTE_LIMIT);
        assert_eq!(max_top_docs_limit(3_000), 3_000);
    }

    #[tokio::test]
    async fn upsert_removes_previous_item_and_chunk_documents() {
        let engine = test_engine("upsert-lifecycle");

        engine
            .upsert(markdown_item("item-1", "olditemkeyword", "oldchunkkeyword"))
            .await
            .unwrap();
        add_synthetic_chunk(&engine, "item-1", "staleextrachunkkeyword", 1, 1.0, false);

        assert_eq!(count_docs(&engine, "item-1"), 3);

        engine
            .upsert(markdown_item("item-1", "New Title", "newchunkkeyword"))
            .await
            .unwrap();

        assert_eq!(count_docs(&engine, "item-1"), 2);
        assert_eq!(count_docs_by_kind(&engine, "item-1", DOCUMENT_KIND_ITEM), 1);
        assert_eq!(
            count_docs_by_kind(&engine, "item-1", DOCUMENT_KIND_CHUNK),
            1
        );

        assert!(engine
            .search(SearchRequest::new("olditemkeyword", 10))
            .await
            .unwrap()
            .is_empty());
        assert!(engine
            .search(SearchRequest::new("oldchunkkeyword", 10))
            .await
            .unwrap()
            .is_empty());
        assert!(engine
            .search(SearchRequest::new("staleextrachunkkeyword", 10))
            .await
            .unwrap()
            .is_empty());

        let results = engine
            .search(SearchRequest::new("newchunkkeyword", 10))
            .await
            .unwrap();

        assert_eq!(results.len(), 1);
        assert_eq!(results[0].item.id, "item-1");
    }

    #[tokio::test]
    async fn delete_removes_item_and_chunk_documents() {
        let engine = test_engine("delete-lifecycle");

        engine
            .upsert(markdown_item(
                "item-1",
                "Delete Title",
                "deletechunkkeyword",
            ))
            .await
            .unwrap();
        add_synthetic_chunk(&engine, "item-1", "deleteextrachunk", 1, 1.0, false);

        assert_eq!(count_docs(&engine, "item-1"), 3);

        engine.delete("item-1").await.unwrap();

        assert_eq!(count_docs(&engine, "item-1"), 0);
        assert!(engine
            .search(SearchRequest::new("deletechunkkeyword", 10))
            .await
            .unwrap()
            .is_empty());
        assert!(engine
            .search(SearchRequest::new("deleteextrachunk", 10))
            .await
            .unwrap()
            .is_empty());
    }

    #[tokio::test]
    async fn replace_source_removes_stale_item_and_chunk_documents() {
        let engine = test_engine("replace-source-lifecycle");
        let source_id = "docs/links.gjson";
        let source_path = "/workspace/docs/links.gjson";

        engine
            .upsert_batch(vec![
                markdown_item(&format!("{source_id}::0"), "Rust Link", "oldrustkeyword")
                    .with_source_path(source_path),
                markdown_item(
                    &format!("{source_id}::1"),
                    "Tauri Link",
                    "staletaurikeyword",
                )
                .with_source_path(source_path),
            ])
            .await
            .unwrap();
        add_synthetic_chunk(
            &engine,
            &format!("{source_id}::1"),
            "staleextrachunk",
            1,
            1.0,
            false,
        );

        engine
            .replace_source(
                source_id,
                vec![
                    markdown_item(&format!("{source_id}::0"), "Rust Link", "newrustkeyword")
                        .with_source_path(source_path),
                ],
                None,
            )
            .await
            .unwrap();

        assert_eq!(count_docs(&engine, &format!("{source_id}::0")), 2);
        assert_eq!(count_docs(&engine, &format!("{source_id}::1")), 0);
        assert!(engine
            .search(SearchRequest::new("oldrustkeyword", 10))
            .await
            .unwrap()
            .is_empty());
        assert!(engine
            .search(SearchRequest::new("staletaurikeyword", 10))
            .await
            .unwrap()
            .is_empty());
        assert!(engine
            .search(SearchRequest::new("staleextrachunk", 10))
            .await
            .unwrap()
            .is_empty());

        let results = engine
            .search(SearchRequest::new("newrustkeyword", 10))
            .await
            .unwrap();

        assert_eq!(results.len(), 1);
        assert_eq!(results[0].item.id, format!("{source_id}::0"));
    }

    #[tokio::test]
    async fn multiple_chunk_hits_for_same_item_are_deduped() {
        let engine = test_engine("chunk-dedupe");

        engine
            .upsert(markdown_item("item-1", "Chunk Container", "ordinary body"))
            .await
            .unwrap();
        add_synthetic_chunk(&engine, "item-1", "dedupechunk first", 1, 1.0, false);
        add_synthetic_chunk(&engine, "item-1", "dedupechunk second", 2, 1.0, false);

        let results = engine
            .search(SearchRequest::new("dedupechunk", 10))
            .await
            .unwrap();

        assert_eq!(results.len(), 1);
        assert_eq!(results[0].item.id, "item-1");
    }

    #[tokio::test]
    async fn duplicate_hits_keep_best_score_and_best_snippet_candidate() {
        let engine = test_engine("duplicate-best-hit");

        engine
            .upsert(markdown_item("item-1", "Score Container", "ordinary body"))
            .await
            .unwrap();
        add_synthetic_chunk(&engine, "item-1", "scorepick low candidate", 1, 1.0, false);
        add_synthetic_chunk(&engine, "item-1", "scorepick high candidate", 2, 1.0, true);

        let results = engine
            .search(SearchRequest::new("scorepick", 10))
            .await
            .unwrap();

        assert_eq!(results.len(), 1);
        assert!(results[0].score > 10_000.0);

        let snippet = &results[0].snippets.as_ref().unwrap()[0];
        let snippet_text = snippet
            .fragments
            .iter()
            .map(|fragment| fragment.text.as_str())
            .collect::<String>();

        assert_eq!(snippet.source, SearchSnippetSource::Body);
        assert_eq!(snippet.chunk.as_ref().unwrap().ordinal, 2);
        assert!(snippet_text.contains("high candidate"));
    }

    #[tokio::test]
    async fn ranking_considers_boosted_candidates_behind_duplicate_chunk_pressure() {
        let engine = test_engine("duplicate-pressure-ranking");
        let pressure_text = "rankingpressure ".repeat(40);

        engine
            .upsert(markdown_item("long-item", "Long Body", &pressure_text))
            .await
            .unwrap();

        for ordinal in 1..=12 {
            add_synthetic_chunk(&engine, "long-item", &pressure_text, ordinal, 1.0, false);
        }

        engine
            .upsert(markdown_item("starred-item", "Starred Body", "rankingpressure").set_star(true))
            .await
            .unwrap();

        let results = engine
            .search(SearchRequest::new("rankingpressure", 1))
            .await
            .unwrap();

        assert_eq!(results.len(), 1);
        assert_eq!(results[0].item.id, "starred-item");
        assert!(results[0].score > 10_000.0);
    }

    #[tokio::test]
    async fn long_body_search_returns_later_chunk_snippet_offsets() {
        let engine = test_engine("long-body-snippet");
        let content = format!("{} tail_chunk_unique_keyword", "filler ".repeat(1500));

        engine
            .upsert(markdown_item("item-1", "Long Body", &content))
            .await
            .unwrap();

        let results = engine
            .search(SearchRequest::new("tail_chunk_unique_keyword", 10))
            .await
            .unwrap();

        assert_eq!(results.len(), 1);

        let snippet = &results[0].snippets.as_ref().unwrap()[0];
        let chunk = snippet.chunk.as_ref().unwrap();

        assert_eq!(snippet.source, SearchSnippetSource::Body);
        assert!(chunk.ordinal > 0);
        assert!(content[chunk.start_byte..chunk.end_byte].contains("tail_chunk_unique_keyword"));
    }

    #[tokio::test]
    async fn title_and_body_search_returns_body_snippet() {
        let engine = test_engine("title-body-snippet");

        engine
            .upsert(markdown_item("item-1", "Rust Notes", "lindera body text"))
            .await
            .unwrap();

        let results = engine
            .search(SearchRequest::new("Rust lindera", 10))
            .await
            .unwrap();

        assert_eq!(results.len(), 1);
        assert_eq!(results[0].item.id, "item-1");

        let snippet = &results[0].snippets.as_ref().unwrap()[0];
        let snippet_text = snippet
            .fragments
            .iter()
            .map(|fragment| fragment.text.as_str())
            .collect::<String>();

        assert_eq!(snippet.source, SearchSnippetSource::Body);
        assert!(snippet_text.contains("lindera"));
    }

    #[tokio::test]
    async fn title_only_search_returns_title_snippet() {
        let engine = test_engine("title-only-snippet");

        engine
            .upsert(markdown_item(
                "item-1",
                "Rust Search Notes",
                "ordinary body text",
            ))
            .await
            .unwrap();

        let results = engine.search(SearchRequest::new("Rust", 10)).await.unwrap();

        assert_eq!(results.len(), 1);
        assert_eq!(results[0].item.id, "item-1");

        let snippet = &results[0].snippets.as_ref().unwrap()[0];
        let snippet_text = first_snippet_text(&results[0]);

        assert_eq!(snippet.source, SearchSnippetSource::Title);
        assert!(snippet.chunk.is_none());
        assert!(snippet_text.contains("Rust Search Notes"));
        assert!(snippet
            .fragments
            .iter()
            .any(|fragment| { fragment.matched && fragment.text.eq_ignore_ascii_case("rust") }));
    }

    #[tokio::test]
    async fn japanese_query_returns_snippet_from_mixed_language_body() {
        let engine = test_engine("mixed-language-japanese-snippet");
        let content =
            "Rust indexing notes. 日本語検索の品質を確認する。Lindera tokenizer keeps mixed text usable.";

        engine
            .upsert(markdown_item("item-1", "Mixed Language Notes", content))
            .await
            .unwrap();

        let results = engine
            .search(SearchRequest::new("日本語検索", 10))
            .await
            .unwrap();

        assert_eq!(results.len(), 1);
        assert_eq!(results[0].item.id, "item-1");

        let snippet = &results[0].snippets.as_ref().unwrap()[0];
        let snippet_text = first_snippet_text(&results[0]);
        let chunk = snippet.chunk.as_ref().unwrap();

        assert_eq!(snippet.source, SearchSnippetSource::Body);
        assert!(snippet_text.contains("日本語検索"));
        assert!(snippet
            .fragments
            .iter()
            .any(|fragment| { fragment.matched && fragment.text == "日本語検索" }));
        assert!(content[chunk.start_byte..chunk.end_byte].contains("日本語検索"));
    }

    #[tokio::test]
    async fn partial_japanese_body_queries_return_snippets_while_typing() {
        let engine = test_engine("partial-japanese-body-snippet");
        let content = r#"～できる

### Example

> What you will be able to do when you finish

あなたが修了したときにできるようになっていること
↓
修了後にできること"#;

        engine
            .upsert(markdown_item("item-1", "Learning Outcome", content))
            .await
            .unwrap();

        for (query, expected_context) in [
            ("あなた", "あなた"),
            ("あ", "あなた"),
            ("できる", "できる"),
            ("でき", "できる"),
            ("で", "できる"),
        ] {
            let results = engine.search(SearchRequest::new(query, 10)).await.unwrap();

            assert_eq!(results.len(), 1, "query should hit: {query}");
            assert_eq!(results[0].item.id, "item-1");

            let snippet = &results[0].snippets.as_ref().unwrap()[0];
            let snippet_text = first_snippet_text(&results[0]);

            assert_eq!(snippet.source, SearchSnippetSource::Body);
            assert!(
                snippet.fragments.iter().any(|fragment| fragment.matched),
                "snippet should mark a matched fragment for query: {query}"
            );
            assert!(
                snippet_text.contains(expected_context),
                "snippet should keep expected context for query: {query}; snippet={snippet_text}"
            );
        }
    }

    #[tokio::test]
    async fn english_query_returns_snippet_from_mixed_language_body() {
        let engine = test_engine("mixed-language-english-snippet");
        let content =
            "日本語検索のメモ。Rust analyzer pipeline keeps English snippets readable in mixed text.";

        engine
            .upsert(markdown_item("item-1", "検索メモ", content))
            .await
            .unwrap();

        let results = engine
            .search(SearchRequest::new("pipeline", 10))
            .await
            .unwrap();

        assert_eq!(results.len(), 1);
        assert_eq!(results[0].item.id, "item-1");

        let snippet = &results[0].snippets.as_ref().unwrap()[0];
        let snippet_text = first_snippet_text(&results[0]);
        let chunk = snippet.chunk.as_ref().unwrap();

        assert_eq!(snippet.source, SearchSnippetSource::Body);
        assert!(snippet_text.contains("analyzer pipeline keeps English"));
        assert!(snippet.fragments.iter().any(|fragment| {
            fragment.matched && fragment.text.eq_ignore_ascii_case("pipeline")
        }));
        assert!(content[chunk.start_byte..chunk.end_byte].contains("pipeline"));
    }

    #[tokio::test]
    async fn japanese_title_and_english_body_query_keeps_body_snippet() {
        let engine = test_engine("mixed-language-cross-doc-snippet");
        let content = "The tokenizer bridge keeps snippet quality stable for bilingual notes.";

        engine
            .upsert(markdown_item("item-1", "日本語検索ノート", content))
            .await
            .unwrap();

        let results = engine
            .search(SearchRequest::new("日本語検索 tokenizer", 10))
            .await
            .unwrap();

        assert_eq!(results.len(), 1);
        assert_eq!(results[0].item.id, "item-1");

        let snippet = &results[0].snippets.as_ref().unwrap()[0];
        let snippet_text = first_snippet_text(&results[0]);

        assert_eq!(snippet.source, SearchSnippetSource::Body);
        assert!(snippet_text.contains("tokenizer bridge"));
        assert!(snippet.fragments.iter().any(|fragment| {
            fragment.matched && fragment.text.eq_ignore_ascii_case("tokenizer")
        }));
    }

    #[tokio::test]
    async fn schema_version_mismatch_rebuilds_tantivy_index() {
        let db = Arc::new(Mutex::new(create_test_db()));
        let index_dir = temp_index_dir("schema-version-rebuild");
        let engine = test_engine_with_db(db.clone(), index_dir.clone());

        engine
            .upsert(markdown_item(
                "item-1",
                "Schema Version",
                "schema_mismatch_token",
            ))
            .await
            .unwrap();

        assert_eq!(count_docs(&engine, "item-1"), 2);

        drop(engine);

        std::fs::write(index_dir.join("glimpse-schema-version"), "0\n").unwrap();

        let rebuilt = test_engine_with_db(db, index_dir.clone());

        assert_eq!(count_docs(&rebuilt, "item-1"), 0);
        assert!(rebuilt
            .search(SearchRequest::new("schema_mismatch_token", 10))
            .await
            .unwrap()
            .is_empty());

        assert_ne!(
            std::fs::read_to_string(index_dir.join("glimpse-schema-version")).unwrap(),
            "0\n"
        );
    }
}

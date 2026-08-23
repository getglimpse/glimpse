use tantivy::schema::TantivyDocument;
use tantivy::{IndexWriter, Term};

use crate::models::IndexItem;
use crate::search::SearchError;

use super::document::tantivy_documents;
use super::index::TantivyState;
use super::schema::TantivyFields;

const WRITER_HEAP_SIZE: usize = 80_000_000;

pub(super) fn commit_index_mutation(
    state: &TantivyState,
    operation: impl FnOnce(&mut IndexWriter<TantivyDocument>, TantivyFields) -> Result<(), SearchError>,
) -> Result<(), SearchError> {
    let mut writer: IndexWriter<TantivyDocument> = state
        .index
        .writer(WRITER_HEAP_SIZE)
        .map_err(|error| SearchError::IndexError(error.to_string()))?;

    operation(&mut writer, state.fields)?;

    writer
        .commit()
        .map_err(|error| SearchError::IndexError(error.to_string()))?;

    state
        .reader
        .reload()
        .map_err(|error| SearchError::IndexError(error.to_string()))?;

    Ok(())
}

pub(super) fn upsert_items(
    writer: &mut IndexWriter<TantivyDocument>,
    fields: TantivyFields,
    items: &[IndexItem],
) -> Result<(), SearchError> {
    for item in items {
        writer.delete_term(item_id_term(fields, &item.id));

        for document in tantivy_documents(fields, item) {
            writer
                .add_document(document)
                .map_err(|error| SearchError::IndexError(error.to_string()))?;
        }
    }

    Ok(())
}

pub(super) fn delete_ids(
    writer: &mut IndexWriter<TantivyDocument>,
    fields: TantivyFields,
    ids: &[String],
) -> Result<(), SearchError> {
    for id in ids {
        writer.delete_term(item_id_term(fields, id));
    }

    Ok(())
}

fn item_id_term(fields: TantivyFields, id: &str) -> Term {
    Term::from_field_text(fields.id, id)
}

#[cfg(test)]
mod tests {
    use super::*;

    use chrono::Utc;
    use tantivy::collector::Count;
    use tantivy::query::TermQuery;
    use tantivy::schema::IndexRecordOption;

    use crate::models::Preview;
    use crate::search::tantivy::index::open_or_create_index;

    fn temp_index_state() -> TantivyState {
        let dir =
            std::env::temp_dir().join(format!("glimpse-tantivy-writer-{}", uuid::Uuid::new_v4()));

        open_or_create_index(&dir).expect("index should open")
    }

    fn sample_item(id: &str) -> IndexItem {
        IndexItem::new(
            id,
            "Rust Notes",
            Utc::now(),
            Preview::Markdown {
                content: "hello rust".to_string(),
            },
        )
    }

    #[test]
    fn committed_upsert_is_visible_to_reader() {
        let state = temp_index_state();
        let item = sample_item("item-1");

        commit_index_mutation(&state, |writer, fields| {
            upsert_items(writer, fields, std::slice::from_ref(&item))
        })
        .unwrap();

        let searcher = state.reader.searcher();
        let query = TermQuery::new(
            item_id_term(state.fields, "item-1"),
            IndexRecordOption::Basic,
        );
        let count = searcher.search(&query, &Count).unwrap();

        assert_eq!(count, 2);
    }

    #[test]
    fn committed_delete_is_visible_to_reader() {
        let state = temp_index_state();
        let item = sample_item("item-1");

        commit_index_mutation(&state, |writer, fields| {
            upsert_items(writer, fields, std::slice::from_ref(&item))
        })
        .unwrap();

        commit_index_mutation(&state, |writer, fields| {
            delete_ids(writer, fields, &[item.id.clone()])
        })
        .unwrap();

        let searcher = state.reader.searcher();
        let query = TermQuery::new(
            item_id_term(state.fields, "item-1"),
            IndexRecordOption::Basic,
        );
        let count = searcher.search(&query, &Count).unwrap();

        assert_eq!(count, 0);
    }
}

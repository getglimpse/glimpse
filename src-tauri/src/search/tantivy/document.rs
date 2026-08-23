use tantivy::schema::TantivyDocument;

use crate::models::IndexItem;

use super::chunk::{item_index_chunks, IndexChunk};
use super::schema::{
    MultilingualTextFields, TantivyFields, DOCUMENT_KIND_CHUNK, DOCUMENT_KIND_ITEM,
};

pub(super) fn tantivy_documents(fields: TantivyFields, item: &IndexItem) -> Vec<TantivyDocument> {
    let chunks = item_index_chunks(item);
    let mut documents = Vec::with_capacity(chunks.len() + 1);

    documents.push(item_document(fields, item));
    documents.extend(
        chunks
            .into_iter()
            .map(|chunk| chunk_document(fields, chunk)),
    );

    documents
}

fn item_document(fields: TantivyFields, item: &IndexItem) -> TantivyDocument {
    let aliases = item.metadata.aliases.join(" ");

    let mut document = TantivyDocument::default();

    document.add_text(fields.id, item.id.as_str());
    document.add_text(fields.doc_kind, DOCUMENT_KIND_ITEM);
    add_multilingual_text(&mut document, fields.title, item.title.as_str());
    document.add_text(fields.tags, item.metadata.tags.join(" "));
    add_tag_filters(&mut document, fields, item);
    add_multilingual_text(&mut document, fields.aliases, &aliases);
    add_item_metadata(&mut document, fields, item);

    document
}

fn chunk_document(fields: TantivyFields, chunk: IndexChunk<'_>) -> TantivyDocument {
    let item = chunk.item();
    let item_context = chunk_item_context(item);

    let mut document = TantivyDocument::default();

    document.add_text(fields.id, item.id.as_str());
    document.add_text(fields.doc_kind, DOCUMENT_KIND_CHUNK);
    add_tag_filters(&mut document, fields, item);
    add_multilingual_text(&mut document, fields.body, chunk.body());
    add_multilingual_text(&mut document, fields.chunk_item_context, &item_context);
    document.add_text(fields.chunk_text, chunk.body());
    document.add_u64(fields.chunk_ordinal, chunk.ordinal() as u64);
    document.add_u64(fields.chunk_start_byte, chunk.start_byte() as u64);
    document.add_u64(fields.chunk_end_byte, chunk.end_byte() as u64);
    add_item_metadata(&mut document, fields, item);

    document
}

fn chunk_item_context(item: &IndexItem) -> String {
    let mut values = Vec::new();

    values.push(item.title.as_str());
    values.extend(item.metadata.aliases.iter().map(String::as_str));
    values.extend(item.metadata.tags.iter().map(String::as_str));

    values.join(" ")
}

fn add_tag_filters(document: &mut TantivyDocument, fields: TantivyFields, item: &IndexItem) {
    for tag in &item.metadata.tags {
        document.add_text(fields.tags_filter, tag);
    }
}

fn add_item_metadata(document: &mut TantivyDocument, fields: TantivyFields, item: &IndexItem) {
    document.add_u64(fields.star, if item.metadata.star { 1_u64 } else { 0_u64 });
    document.add_u64(
        fields.hidden,
        if item.metadata.hidden { 1_u64 } else { 0_u64 },
    );
    document.add_i64(fields.updated_at, item.updated_at.timestamp());
    document.add_f64(fields.boost, item.metadata.normalized_boost() as f64);
}

fn add_multilingual_text(
    document: &mut TantivyDocument,
    fields: MultilingualTextFields,
    value: &str,
) {
    for field in fields.fields() {
        document.add_text(field, value);
    }
}

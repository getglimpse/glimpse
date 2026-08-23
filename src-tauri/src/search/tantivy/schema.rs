use tantivy::schema::{
    Field, IndexRecordOption, Schema, SchemaBuilder, TextFieldIndexing, TextOptions, FAST, INDEXED,
    STORED, STRING,
};

use super::tokenizer::TOKENIZER_NAME;

/// Current Tantivy schema version.
///
/// Increment this value whenever [`build_schema`] or the Tantivy document layout
/// changes in a way that requires rebuilding existing index directories.
pub(super) const TANTIVY_SCHEMA_VERSION: u32 = 5;

pub(super) const DOCUMENT_KIND_ITEM: &str = "item";
pub(super) const DOCUMENT_KIND_CHUNK: &str = "chunk";

#[derive(Clone, Copy)]
pub(super) struct TantivyFields {
    pub id: Field,
    pub doc_kind: Field,
    pub title: MultilingualTextFields,
    pub tags: Field,
    pub tags_filter: Field,
    pub aliases: MultilingualTextFields,
    pub body: MultilingualTextFields,
    pub chunk_item_context: MultilingualTextFields,
    pub chunk_text: Field,
    pub chunk_ordinal: Field,
    pub chunk_start_byte: Field,
    pub chunk_end_byte: Field,
    pub star: Field,
    pub hidden: Field,
    pub updated_at: Field,
    pub boost: Field,
}

#[derive(Clone, Copy)]
pub(super) struct MultilingualTextFields {
    pub japanese: Field,
    pub english: Field,
}

impl MultilingualTextFields {
    fn add(
        schema: &mut SchemaBuilder,
        name: &str,
        japanese_options: TextOptions,
        english_options: TextOptions,
    ) -> Self {
        let english_name = format!("{name}_en");

        Self {
            japanese: schema.add_text_field(name, japanese_options),
            english: schema.add_text_field(&english_name, english_options),
        }
    }

    pub(super) fn fields(self) -> [Field; 2] {
        [self.japanese, self.english]
    }
}

pub(super) fn build_schema() -> (Schema, TantivyFields) {
    let mut schema = Schema::builder();

    let text = TextOptions::default().set_indexing_options(
        TextFieldIndexing::default()
            .set_tokenizer(TOKENIZER_NAME)
            .set_index_option(IndexRecordOption::WithFreqsAndPositions),
    );
    let default_text = TextOptions::default().set_indexing_options(
        TextFieldIndexing::default()
            .set_tokenizer("default")
            .set_index_option(IndexRecordOption::WithFreqsAndPositions),
    );

    let id = schema.add_text_field("id", STRING | STORED);
    let doc_kind = schema.add_text_field("doc_kind", STRING | STORED);
    let title = MultilingualTextFields::add(
        &mut schema,
        "title",
        text.clone().set_stored(),
        default_text.clone(),
    );
    let tags = schema.add_text_field("tags", default_text.clone().set_stored());
    let tags_filter = schema.add_text_field("tags_filter", STRING | STORED);
    let aliases = MultilingualTextFields::add(
        &mut schema,
        "aliases",
        text.clone().set_stored(),
        default_text.clone(),
    );
    let body = MultilingualTextFields::add(&mut schema, "body", text.clone(), default_text.clone());
    let chunk_item_context =
        MultilingualTextFields::add(&mut schema, "chunk_item_context", text, default_text);
    let chunk_text = schema.add_text_field("chunk_text", STORED);
    let chunk_ordinal = schema.add_u64_field("chunk_ordinal", INDEXED | FAST | STORED);
    let chunk_start_byte = schema.add_u64_field("chunk_start_byte", STORED);
    let chunk_end_byte = schema.add_u64_field("chunk_end_byte", STORED);
    let star = schema.add_u64_field("star", INDEXED | FAST | STORED);
    let hidden = schema.add_u64_field("hidden", INDEXED | FAST | STORED);
    let updated_at = schema.add_i64_field("updated_at", INDEXED | FAST | STORED);
    let boost = schema.add_f64_field("boost", INDEXED | FAST | STORED);

    (
        schema.build(),
        TantivyFields {
            id,
            doc_kind,
            title,
            tags,
            tags_filter,
            aliases,
            body,
            chunk_item_context,
            chunk_text,
            chunk_ordinal,
            chunk_start_byte,
            chunk_end_byte,
            star,
            hidden,
            updated_at,
            boost,
        },
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn schema_includes_chunk_fields() {
        let (schema, _) = build_schema();

        for field_name in [
            "doc_kind",
            "chunk_text",
            "chunk_item_context",
            "chunk_item_context_en",
            "chunk_ordinal",
            "chunk_start_byte",
            "chunk_end_byte",
            "tags_filter",
        ] {
            assert!(
                schema.get_field(field_name).is_ok(),
                "missing field: {field_name}"
            );
        }
    }
}

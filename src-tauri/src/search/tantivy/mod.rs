//! Tantivy + Lindera search engine implementation.
//!
//! This backend keeps SQLite as the durable item/preview store and uses
//! Tantivy for the full-text inverted index. Search-result snippets are built
//! from stored Tantivy hit fields, while SQLite remains the canonical item
//! store.
//!
//! Consistency rules are documented in `docs/dev/search.md`.

mod chunk;
mod document;
mod engine;
mod index;
mod query;
mod ranking;
mod schema;
mod snippet;
mod tokenizer;
mod writer;

pub use engine::TantivyEngine;

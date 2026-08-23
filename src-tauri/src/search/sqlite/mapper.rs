//! Compatibility re-export for SQLite row mappers.
//!
//! The mapper implementation lives in `store::item_mapper` because it maps
//! rows from the durable item store rather than SQLite FTS5-specific state.

pub use crate::store::item_mapper::{map_open_action, map_search_result};

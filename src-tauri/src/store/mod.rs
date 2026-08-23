//! Storage layer for Glimpse.
//!
//! This module owns all persistent application data and filesystem-backed
//! resources.
//!
//! Responsibilities:
//!
//! - SQLite database initialization.
//! - Database schema management.
//! - Filesystem indexing support.
//! - Parser implementations.
//! - Settings persistence.
//! - Custom theme storage.
//! - Workspace bootstrap.
//! - Command execution logs.
//!
//! # Architecture
//!
//! ```text
//! filesystem
//!     │
//!     ├── workspace
//!     ├── settings
//!     ├── themes
//!     ├── logs
//!     │
//!     ▼
//! store
//!     │
//!     ├── parser
//!     ├── indexer
//!     ├── db
//!     └── schema
//!     │
//!     ▼
//! search engine
//! ```
//!
//! The `store` layer is intentionally separated from the search layer.
//!
//! Responsibilities are divided as:
//!
//! - `store`
//!   → persistence, filesystem access, indexing
//!
//! - `search`
//!   → queries, ranking, fuzzy matching
//!
//! # Submodules
//!
//! | Module | Responsibility |
//! |-------|------------------|
//! | `command_log` | Command execution history |
//! | `db` | SQLite connection bootstrap |
//! | `file` | Safe Markdown file operations |
//! | `indexer` | Filesystem scanning and realtime indexing |
//! | `parser` | Convert files into `IndexItem`s |
//! | `schema` | SQLite schema and version management |
//! | `settings` | `settings.json` persistence |
//! | `themes` | Custom theme loading |
//! | `workspace` | Initial workspace generation |
//!
//! This module forms the persistence backbone of the Glimpse backend.

/// Command execution audit log storage.
pub mod command_log;

/// SQLite database initialization.
pub mod db;

/// Safe file read/write operations.
pub mod file;

/// Filesystem indexing and watch services.
pub mod indexer;

/// SQLite row mapping for indexed items.
pub mod item_mapper;

/// Indexed item persistence.
pub mod item_repository;

/// SQL statements for indexed item persistence.
pub mod item_sql;

/// File parsers and metadata extraction.
pub mod parser;

/// Plugin manifest storage.
pub mod plugins;

/// SQLite schema definition and migrations.
pub mod schema;

/// Application settings persistence.
pub mod settings;
pub mod settings_watch;

/// Custom theme storage.
pub mod themes;

/// Default workspace bootstrap.
pub mod workspace;

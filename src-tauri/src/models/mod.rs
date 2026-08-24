//! Shared backend data models.
//!
//! This module defines the core domain models shared across the Glimpse
//! backend.
//!
//! Responsibilities:
//!
//! - indexing
//! - search
//! - storage
//! - frontend IPC
//! - settings persistence
//!
//! Most structures are serializable and transferred directly between:
//!
//! ```text
//! Backend (Rust)
//!      ↕ serde
//! Frontend (TypeScript)
//! ```
//!
//! Model overview:
//!
//! | Module | Responsibility |
//! |--------|----------------|
//! | `item` | Core searchable items |
//! | `settings` | Application settings |
//! | `indexing` | Indexing state |
//! | `command_log` | Command execution audit logs |
//! | `stats` | Aggregated statistics |
//! | `theme` | UI themes |
//! | `json` | JSON parser input |
//! | `dictionary` | Search source definitions |
//!
//! The most important model in Glimpse is [`IndexItem`].
//!
//! ```text
//! IndexItem
//! ├─ IndexMetadata
//! ├─ Preview
//! └─ default action?
//! ```
//!
//! Most backend components eventually produce or consume `IndexItem`.

pub mod command_log;
pub mod dictionary;
pub mod indexing;
pub mod item;
pub mod json;
pub mod plugins;
pub mod settings;
pub mod stats;
pub mod theme;

/// Core searchable item models.
///
/// Includes:
///
/// - [`IndexItem`]
/// - [`IndexMetadata`]
/// - [`Preview`]
/// - [`DefaultAction`]
///
/// Represents:
///
/// - Markdown documents
/// - Raw text files
/// - External links
/// - Command launchers
/// - Internal pages
pub use item::{DefaultAction, IndexItem, IndexMetadata, Preview};

/// Search source definitions.
///
/// Represents:
///
/// - built-in sources
/// - local filesystem collections
/// - future premium dictionaries
pub use dictionary::{Dictionary, DictionaryKind};

/// JSON parser input models.
///
/// Used when converting JSON files into searchable items.
pub use json::{JsonIndexFile, JsonIndexItem};

/// Theme definitions.
///
/// Represents:
///
/// - custom themes
/// - color palettes
pub use theme::CssTheme;

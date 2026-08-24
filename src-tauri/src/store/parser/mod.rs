//! Parser layer for Glimpse indexing.
//!
//! This module converts filesystem resources into searchable
//! [`IndexItem`] values.
//!
//! The parser layer is responsible only for extracting information from
//! files and constructing normalized search items.
//!
//! Responsibilities:
//!
//! - Read file contents.
//! - Extract metadata.
//! - Parse Markdown frontmatter.
//! - Generate previews.
//! - Generate stable source-based item IDs.
//! - Normalize tags and aliases.
//!
//! Search-specific responsibilities such as ranking, fuzzy matching,
//! and query parsing are intentionally delegated to the `search` module.
//!
//! # Architecture
//!
//! ```text
//! filesystem
//!     │
//!     ▼
//! parser
//!     │
//!     ▼
//! IndexItem
//!     │
//!     ▼
//! search engine
//! ```
//!
//! # Supported parsers
//!
//! | Parser | Description |
//! |-------|-------------|
//! | `markdown` | Markdown files with frontmatter |
//! | `json` | Multi-item JSON resource indexes |
//! | `image` | Image files rendered as Markdown images |
//! | `raw` | Generic text fallback |
//! | `frontmatter` | YAML-like metadata parser |
//! | `common` | Shared parser utilities |
//!
//! The parser layer is intentionally lightweight and filesystem-oriented.
//! Expensive search logic should not be implemented here.

/// Shared parser helper functions.
///
/// Provides:
///
/// - fallback title generation
/// - tag normalization
/// - quote removal helpers
pub mod common;

/// YAML-like Markdown frontmatter parser.
///
/// Supported metadata:
///
/// - title
/// - tags
/// - aliases
/// - star
/// - url
/// - iframe
/// - command
/// - defaultAction
///
/// This parser intentionally supports only a lightweight subset of YAML.
pub mod frontmatter;

/// Lightweight file reference parser.
///
/// Used for large/binary files that should be searchable by name but should
/// not have their contents read during indexing.
pub mod file;

/// Image file parser.
///
/// Converts image files into searchable items by generating
/// Markdown image previews.
///
/// Supported formats include:
///
/// - png
/// - jpg
/// - jpeg
/// - gif
/// - webp
/// - bmp
/// - svg
pub mod image;

/// JSON resource parser.
///
/// One JSON file may produce multiple [`IndexItem`] values.
///
/// Typical use cases:
///
/// - documentation links
/// - external resources
/// - bookmarks
/// - command launch entries
pub mod json;

/// Markdown file parser.
///
/// Parses:
///
/// - frontmatter metadata
/// - Markdown body
/// - item actions
///
/// Produces one [`IndexItem`] per file.
pub mod markdown;

/// Generic raw text parser.
///
/// Fallback parser for files without a dedicated parser.
///
/// Generates:
///
/// ```text
/// Preview::Raw
/// ```
pub mod raw;

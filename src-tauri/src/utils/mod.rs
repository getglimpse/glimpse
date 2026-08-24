//! Backend utility modules.
//!
//! This module groups small backend helpers that are shared across commands,
//! indexing, storage, and application startup.
//!
//! Utilities here should stay focused and reusable.
//! Feature-specific business logic should live in higher-level modules such as:
//!
//! - `commands/`
//! - `store/`
//! - `search/`
//!
//! Command-related utilities form a small security pipeline:
//!
//! ```text
//! command
//!   ↓ sanitize / validate command paths
//! command_lookup
//!   ↓ resolve executable path
//! command_policy
//!   ↓ apply whitelist / blacklist policy
//! trusted_directories
//!   ↓ ensure executable is inside an allowed directory
//! ```
//!
//! Path-related utilities are used by both initial indexing and filesystem
//! watching to keep filtering behavior consistent.

pub mod app_path;
pub mod command_lookup;
pub mod command_open;
pub mod command_policy;
pub mod path;
pub mod trusted_directories;

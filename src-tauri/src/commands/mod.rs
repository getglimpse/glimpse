//! Frontend IPC command modules.
//!
//! This module groups all Tauri `#[tauri::command]` entrypoints exposed by
//! Glimpse.
//!
//! Commands are organized by feature area:
//!
//! | Module | Responsibility |
//! |--------|----------------|
//! | `about` | Application metadata |
//! | `action` | Command execution |
//! | `command_log` | Command execution history |
//! | `file` | File read/create/update |
//! | `indexing` | Indexing status and maintenance |
//! | `open` | Open files and reveal locations |
//! | `search` | Search IPC |
//! | `settings` | Application settings |
//! | `stats` | Application statistics |
//! | `themes` | Custom theme management |
//!
//! Typical IPC flow:
//!
//! ```text
//! Frontend
//!     ↓ invoke()
//! commands::*
//!     ↓
//! store / search / runtime
//!     ↓
//! Result<T, String>
//!     ↓
//! Frontend
//! ```
//!
//! These modules are intentionally thin wrappers around backend services.
//! Business logic should generally live in:
//!
//! - `search/` → search engines
//! - `store/` → persistence and indexing
//! - `utils/` → shared utilities

pub mod about;
pub mod action;
pub mod command_log;
pub mod file;
pub mod indexing;
pub mod open;
pub mod plugins;
pub mod preview;
pub mod search;
pub mod settings;
pub mod stats;
pub mod themes;

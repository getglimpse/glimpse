//! Shared application state stored in the Tauri state container.
//!
//! This module defines lightweight wrapper types used with
//! `tauri::App::manage()`.
//!
//! Currently the following shared paths are exposed:
//!
//! - [`SharedAppDataDir`] → Application data directory.
//! - [`SharedSettingsPath`] → Path to `settings.json`.
//!
//! The inner values are wrapped in `Arc<Mutex<_>>` because they may be
//! accessed from:
//!
//! - Tauri IPC commands
//! - Background indexing tasks
//! - Filesystem watcher tasks
//!
//! Shared state should remain small and only contain values that need
//! global access across the backend.

use std::path::PathBuf;
use std::sync::{Arc, Mutex};

/// Shared application data directory.
///
/// This points to the directory used to store:
///
/// - `settings.json`
/// - themes
/// - logs
/// - other application-managed files
///
/// Stored as Tauri managed state so that IPC commands and background
/// tasks can resolve application-relative paths consistently.
#[derive(Clone)]
pub struct SharedAppDataDir(pub Arc<Mutex<PathBuf>>);

/// Shared path to the application settings file.
///
/// Usually points to:
///
/// ```text
/// <app_data_dir>/settings.json
/// ```
///
/// This path is shared because settings may be read or updated by:
///
/// - settings IPC commands
/// - indexing runtime
/// - background watchers
#[derive(Clone)]
pub struct SharedSettingsPath(pub Arc<Mutex<PathBuf>>);

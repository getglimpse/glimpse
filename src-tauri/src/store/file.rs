//! File storage utilities for Glimpse.
//!
//! This module exposes safe file operations used by the frontend editor.
//! Reading, writing, path validation, and file naming live in submodules.
//!
//! Current responsibilities:
//!
//! - Read text files.
//! - Create Markdown files.
//! - Update Markdown file bodies.
//! - Rename Markdown files.
//! - Restrict file access to configured Target Groups.
//!
//! # Security model
//!
//! All read and write operations are restricted to directories belonging
//! to configured Target Groups.
//!
//! Files outside the configured workspace are rejected.
//!
//! # Supported files
//!
//! Currently:
//!
//! - Markdown (`.md`) creation
//! - Markdown (`.md`) title updates
//! - Markdown (`.md`) body updates
//! - Generic UTF-8 text reading
//! - Generic binary reading as base64
//!
//! Binary file editing is intentionally unsupported.

use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine};
use cap_std::fs::{Dir, OpenOptions as CapabilityOpenOptions};
use chrono::Local;
use serde::Serialize;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use crate::models::settings::{AppSettings, TargetGroup};
use crate::store::settings::load_settings;
use crate::utils::path_access::{
    canonicalize_existing_dir, canonicalize_existing_file, nearest_existing_ancestor,
    normalize_input_path, path_is_in_roots, path_starts_with,
};

const MAX_BINARY_READ_BYTES: u64 = 32 * 1024 * 1024;
pub(crate) const MAX_TEXT_READ_BYTES: u64 = 32 * 1024 * 1024;
pub(crate) const MAX_PLUGIN_TEXT_OUTPUT_BYTES: usize = 32 * 1024 * 1024;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileMetadata {
    pub size_bytes: u64,
}

mod names;
mod paths;
mod read;
mod write;

use names::*;
use paths::*;

pub use read::{
    get_file_metadata, get_file_metadata_in_target_group, read_binary_file,
    read_binary_file_in_target_group, read_preview_asset_data_url, read_text_file,
    read_text_file_from_path, read_text_file_in_target_group,
};
pub use write::{
    create_markdown_file_in_current_target, create_text_file_at_path,
    create_text_file_in_current_target, default_download_directory, overwrite_text_file_from_path,
    save_text_file, update_markdown_file_body, update_markdown_file_title, update_text_file_body,
    update_text_file_title, write_text_file_in_granted_directory,
};

#[cfg(test)]
use write::{save_text_file_with_hook, SaveStage};

#[cfg(test)]
#[path = "file/tests.rs"]
mod tests;

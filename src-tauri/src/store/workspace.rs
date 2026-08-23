//! Default workspace bootstrap.
//!
//! This module creates the initial Glimpse workspace shown to users on
//! first launch.
//!
//! Responsibilities:
//!
//! - Create the workspace root directory.
//! - Create the `Examples` directory.
//! - Populate built-in Markdown documents.
//!
//! The generated files serve as:
//!
//! - Welcome page
//! - Quick start guide
//! - Markdown examples
//! - Metadata examples
//! - Command examples
//! - Search examples
//!
//! # Idempotency
//!
//! Existing files are never overwritten.
//!
//! This allows users to edit or remove the generated documents without
//! losing their changes during future application launches.
//!
//! # Workspace structure
//!
//! ```text
//! <workspace>
//! |-- Welcome.md
//! |-- Getting Started.md
//! |-- Markdown.md
//! |-- Metadata.md
//! |-- Commands.md
//! |-- Search.md
//! `-- Examples/
//! ```
//!
//! Built-in document contents are embedded into the binary using
//! `include_str!`.

use std::fs;
use std::path::Path;

/// Ensures that the default Glimpse workspace exists.
///
/// This function is typically called during application startup.
///
/// The following resources are created when missing:
///
/// ```text
/// Welcome.md
/// Getting Started.md
/// Markdown.md
/// Metadata.md
/// Commands.md
/// Search.md
/// Examples/
/// ```
///
/// Existing files are preserved and never overwritten.
///
/// # Embedded assets
///
/// The contents of the generated files are compiled into the application
/// binary using `include_str!`, allowing the workspace to be initialized
/// without external dependencies.
///
/// # Returns
///
/// Returns an error when:
///
/// - the workspace directory cannot be created
/// - an example document cannot be written
pub fn ensure_default_workspace(root: &Path) -> Result<(), String> {
    fs::create_dir_all(root).map_err(|e| e.to_string())?;

    fs::create_dir_all(root.join("Examples")).map_err(|e| e.to_string())?;

    create_if_missing(
        &root.join("Welcome.md"),
        include_str!("../../assets/default_workspace/Welcome.md"),
    )?;

    create_if_missing(
        &root.join("Getting Started.md"),
        include_str!("../../assets/default_workspace/Getting Started.md"),
    )?;

    create_if_missing(
        &root.join("Markdown.md"),
        include_str!("../../assets/default_workspace/Markdown.md"),
    )?;

    create_if_missing(
        &root.join("Metadata.md"),
        include_str!("../../assets/default_workspace/Metadata.md"),
    )?;

    create_if_missing(
        &root.join("Commands.md"),
        include_str!("../../assets/default_workspace/Commands.md"),
    )?;

    create_if_missing(
        &root.join("Search.md"),
        include_str!("../../assets/default_workspace/Search.md"),
    )?;

    Ok(())
}

/// Creates a file only when it does not already exist.
///
/// This helper is intentionally non-destructive:
///
/// - Existing files are left untouched.
/// - Missing files are created from the provided content.
///
/// This behavior ensures that user-customized workspace files are never
/// overwritten by automatic initialization.
fn create_if_missing(path: &Path, content: &str) -> Result<(), String> {
    if path.exists() {
        return Ok(());
    }

    fs::write(path, content).map_err(|e| e.to_string())
}

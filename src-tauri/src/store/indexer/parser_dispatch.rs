//! Parser dispatch for filesystem indexing.
//!
//! This module selects the appropriate parser based on the file extension.
//!
//! The dispatch layer is intentionally thin:
//!
//! - determine file type
//! - delegate parsing to a specialized parser
//! - normalize errors into [`SearchError`]
//!
//! Actual parsing logic lives in:
//!
//! - `parser::markdown`
//! - `parser::json`
//! - `parser::image`
//! - `parser::raw`
//!
//! Unsupported files fall back to the raw parser when possible.
//!
//! Future parsers may include:
//!
//! - PDF
//! - Mermaid
//! - CSV
//! - HTML

use std::path::Path;
use tracing::{debug, warn};

use super::Indexer;
use crate::models::IndexItem;
use crate::search::SearchError;
use crate::store::parser::{
    file::parse_file_reference,
    image::{is_image_extension, parse_image},
    json::parse_json,
    markdown::parse_markdown_result,
    raw::parse_raw_file,
};
use crate::utils::path::{is_metadata_only_file_extension, source_id_for_path};

/// Parser dispatch implementation.
///
/// Converts filesystem files into one or more [`IndexItem`] values.
///
/// The parser is selected using the file extension.
///
/// Current mapping:
///
/// | Extension | Parser | Result Count |
/// |----------|--------|--------------|
/// | `.md` | Markdown | 1 |
/// | `.json` | JSON | 0..N |
/// | image extensions | Image | 1 |
/// | others | Raw | 1 |
impl<E> Indexer<E>
where
    E: crate::search::SearchEngine + 'static,
{
    /// Parses a filesystem path into indexable items.
    ///
    /// Supported formats:
    ///
    /// - Markdown (`.md`)
    /// - Glimpse JSON (`.gjson`)
    /// - Images (`png`, `jpg`, `jpeg`, `gif`, `webp`, ...)
    /// - Other text/binary files via raw parser
    ///
    /// Behavior:
    ///
    /// - Markdown → single item
    /// - Glimpse JSON → zero or more items
    /// - Image → single item
    /// - Unknown → raw preview item
    ///
    /// Glimpse JSON parsing has a fallback:
    ///
    /// ```text
    /// parse_json()
    ///      ↓ fail
    /// parse_raw_file()
    /// ```
    ///
    /// This ensures malformed Glimpse JSON files can still appear in search results
    /// instead of being completely ignored.
    ///
    /// # Errors
    ///
    /// Returns [`SearchError::ParseError`] when:
    ///
    /// - the selected parser fails
    /// - raw fallback parsing also fails
    pub(super) fn parse_path(
        group_name: &str,
        target_index: usize,
        root: &Path,
        path: &Path,
    ) -> Result<Vec<IndexItem>, SearchError> {
        let source_id = source_id_for_path(group_name, target_index, root, path);

        debug!(
            path = %path.display(),
            source_id = %source_id,
            "dispatching parser"
        );

        match path.extension().and_then(|s| s.to_str()) {
            Some("md") => {
                debug!(path = %path.display(), "using markdown parser");

                parse_markdown_result(path, &source_id).map(|item| vec![item])
            }

            Some("gjson") => {
                debug!(path = %path.display(), "using json parser");

                match parse_json(path, &source_id) {
                    Ok(items) => {
                        debug!(
                            path = %path.display(),
                            count = items.len(),
                            "json parser succeeded"
                        );

                        Ok(items)
                    }

                    Err(error) => {
                        warn!(
                            path = %path.display(),
                            error = %error,
                            "json parser failed; falling back to raw parser"
                        );

                        parse_raw_file(path, &source_id)
                            .map(|item| vec![item])
                            .ok_or_else(|| {
                                SearchError::ParseError(format!(
                                    "Failed to parse raw JSON file: {:?}",
                                    path
                                ))
                            })
                    }
                }
            }

            Some(ext) if is_image_extension(ext) => {
                debug!(
                    path = %path.display(),
                    extension = ext,
                    "using image parser"
                );

                parse_image(path, &source_id)
                    .map(|item| vec![item])
                    .ok_or_else(|| {
                        SearchError::ParseError(format!("Failed to parse image: {:?}", path))
                    })
            }

            Some(ext) if is_metadata_only_file_extension(ext) => {
                debug!(
                    path = %path.display(),
                    extension = ext,
                    "using lightweight file reference parser"
                );

                parse_file_reference(path, &source_id)
                    .map(|item| vec![item])
                    .ok_or_else(|| {
                        SearchError::ParseError(format!(
                            "Failed to parse file reference: {:?}",
                            path
                        ))
                    })
            }

            Some(ext) => {
                debug!(
                    path = %path.display(),
                    extension = ext,
                    "using raw parser"
                );

                parse_raw_file(path, &source_id)
                    .map(|item| vec![item])
                    .ok_or_else(|| {
                        SearchError::ParseError(format!("Failed to parse raw file: {:?}", path))
                    })
            }

            None => {
                debug!(
                    path = %path.display(),
                    "using raw parser (no extension)"
                );

                parse_raw_file(path, &source_id)
                    .map(|item| vec![item])
                    .ok_or_else(|| {
                        SearchError::ParseError(format!("Failed to parse raw file: {:?}", path))
                    })
            }
        }
    }
}

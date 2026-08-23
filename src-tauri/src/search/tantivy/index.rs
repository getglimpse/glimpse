use std::fs;
use std::io::ErrorKind;
use std::path::Path;

use tantivy::{Index, IndexReader};
use tracing::warn;

use crate::search::SearchError;

use super::schema::{build_schema, TantivyFields, TANTIVY_SCHEMA_VERSION};
use super::tokenizer::register_lindera_tokenizer;

const VERSION_FILE_NAME: &str = "glimpse-schema-version";

pub(super) struct TantivyState {
    pub index: Index,
    pub reader: IndexReader,
    pub fields: TantivyFields,
}

pub(super) fn open_or_create_index(index_dir: &Path) -> Result<TantivyState, SearchError> {
    fs::create_dir_all(index_dir)?;

    let (schema, fields) = build_schema();
    let index = if index_dir.join("meta.json").exists() {
        match Index::open_in_dir(index_dir) {
            Ok(index) if index.schema() == schema && has_current_schema_version(index_dir)? => {
                index
            }
            Ok(_) => {
                warn!(
                    index_dir = %index_dir.display(),
                    current_version = ?stored_schema_version(index_dir)?,
                    expected_version = TANTIVY_SCHEMA_VERSION,
                    "tantivy schema/version changed; recreating index"
                );

                recreate_index(index_dir, schema.clone())?
            }
            Err(error) => {
                warn!(
                    index_dir = %index_dir.display(),
                    error = %error,
                    "failed to open tantivy index; recreating"
                );

                recreate_index(index_dir, schema.clone())?
            }
        }
    } else {
        create_index(index_dir, schema.clone())?
    };

    write_schema_version(index_dir)?;
    register_lindera_tokenizer(&index)?;

    let reader = index
        .reader()
        .map_err(|error| SearchError::IndexError(error.to_string()))?;

    Ok(TantivyState {
        index,
        reader,
        fields,
    })
}

fn recreate_index(index_dir: &Path, schema: tantivy::schema::Schema) -> Result<Index, SearchError> {
    match fs::remove_dir_all(index_dir) {
        Ok(()) => {}
        Err(error) if error.kind() == ErrorKind::NotFound => {}
        Err(error) => return Err(SearchError::IoError(error)),
    }

    fs::create_dir_all(index_dir)?;
    create_index(index_dir, schema)
}

fn create_index(index_dir: &Path, schema: tantivy::schema::Schema) -> Result<Index, SearchError> {
    let index = Index::create_in_dir(index_dir, schema)
        .map_err(|error| SearchError::IndexError(error.to_string()))?;

    write_schema_version(index_dir)?;

    Ok(index)
}

fn has_current_schema_version(index_dir: &Path) -> Result<bool, SearchError> {
    Ok(stored_schema_version(index_dir)? == Some(TANTIVY_SCHEMA_VERSION))
}

fn stored_schema_version(index_dir: &Path) -> Result<Option<u32>, SearchError> {
    let path = schema_version_path(index_dir);

    match fs::read_to_string(&path) {
        Ok(value) => match value.trim().parse::<u32>() {
            Ok(version) => Ok(Some(version)),
            Err(_) => Ok(None),
        },
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(None),
        Err(error) => Err(SearchError::IoError(error)),
    }
}

fn write_schema_version(index_dir: &Path) -> Result<(), SearchError> {
    fs::write(
        schema_version_path(index_dir),
        format!("{TANTIVY_SCHEMA_VERSION}\n"),
    )?;

    Ok(())
}

fn schema_version_path(index_dir: &Path) -> std::path::PathBuf {
    index_dir.join(VERSION_FILE_NAME)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_index_dir(name: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(format!(
            "glimpse-tantivy-index-{name}-{}",
            uuid::Uuid::new_v4()
        ))
    }

    #[test]
    fn creates_schema_version_marker() {
        let index_dir = temp_index_dir("version-marker");

        open_or_create_index(&index_dir).expect("index should open");

        assert_eq!(
            stored_schema_version(&index_dir).unwrap(),
            Some(TANTIVY_SCHEMA_VERSION)
        );

        fs::remove_dir_all(index_dir).ok();
    }

    #[test]
    fn recreates_index_when_schema_version_is_missing() {
        let index_dir = temp_index_dir("missing-version");

        open_or_create_index(&index_dir).expect("index should open");
        fs::remove_file(schema_version_path(&index_dir)).unwrap();
        fs::write(index_dir.join("stale-marker"), "stale").unwrap();

        open_or_create_index(&index_dir).expect("index should reopen");

        assert!(!index_dir.join("stale-marker").exists());
        assert_eq!(
            stored_schema_version(&index_dir).unwrap(),
            Some(TANTIVY_SCHEMA_VERSION)
        );

        fs::remove_dir_all(index_dir).ok();
    }

    #[test]
    fn recreates_index_when_schema_version_differs() {
        let index_dir = temp_index_dir("version-mismatch");

        open_or_create_index(&index_dir).expect("index should open");
        fs::write(schema_version_path(&index_dir), "0\n").unwrap();
        fs::write(index_dir.join("stale-marker"), "stale").unwrap();

        open_or_create_index(&index_dir).expect("index should reopen");

        assert!(!index_dir.join("stale-marker").exists());
        assert_eq!(
            stored_schema_version(&index_dir).unwrap(),
            Some(TANTIVY_SCHEMA_VERSION)
        );

        fs::remove_dir_all(index_dir).ok();
    }
}

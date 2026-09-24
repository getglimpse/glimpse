use super::*;

use std::fs::File;
use std::io::Write;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::models::settings::{
    AppSettings, PluginInstallProvenance, PluginInstallSource, PluginSettings, PluginTrustRecord,
};

fn unique_test_dir(name: &str) -> PathBuf {
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();

    std::env::temp_dir().join(format!("glimpse_plugin_store_test_{unique}_{name}"))
}

fn write_plugin_source(root: &Path, plugin_id: &str) {
    let plugin_root = root.join(plugin_id);
    fs::create_dir_all(&plugin_root).unwrap();
    fs::write(
        plugin_root.join("manifest.json"),
        format!(
            r#"{{
  "id": "{plugin_id}",
  "name": "Sample Plugin",
  "version": "0.1.0",
  "apiVersion": "0.1.0",
  "entrypoints": {{ "main": "./main.js" }}
}}"#
        ),
    )
    .unwrap();
    fs::write(
        plugin_root.join("main.js"),
        "export default function activate() {}",
    )
    .unwrap();
}

fn write_plugin_manifest(root: &Path, plugin_id: &str, manifest: &str) -> PathBuf {
    let plugin_root = root.join(plugin_id);
    fs::create_dir_all(&plugin_root).unwrap();
    fs::write(plugin_root.join("manifest.json"), manifest).unwrap();
    plugin_root
}

fn write_full_plugin(root: &Path, plugin_id: &str) -> PathBuf {
    let plugin_root = write_plugin_manifest(
        root,
        plugin_id,
        &format!(
            r#"{{
  "id": "{plugin_id}",
  "name": "Full Plugin",
  "version": "0.1.0",
  "apiVersion": "0.1.0",
  "description": "A complete plugin fixture.",
  "enabledByDefault": true,
  "entrypoints": {{ "main": "./main.js", "page": "./page.js" }},
  "capabilities": {{
    "files": {{
      "read": "active-tab"
    }}
  }},
  "contributes": {{
    "internalPages": [
      {{
        "id": "plugin:{plugin_id}",
        "title": "Full Plugin Page",
        "tags": ["internal", "plugin"],
        "aliases": ["fixture"],
        "boost": 1.5
      }}
    ],
    "actions": [
      {{
        "id": "calculate",
        "title": "Calculate",
        "description": "Run a calculation.",
        "aliases": ["calc"]
      }}
    ],
    "viewers": [
      {{
        "id": "pdf",
        "title": "PDF Viewer",
        "description": "Preview PDF files.",
        "extensions": ["pdf"]
      }}
    ]
  }}
}}"#
        ),
    );

    fs::write(
        plugin_root.join("main.js"),
        "export default function activate() { return 'ok'; }",
    )
    .unwrap();
    fs::write(plugin_root.join("page.js"), "export const page = true;").unwrap();
    fs::write(plugin_root.join("styles.css"), ".fixture { color: red; }").unwrap();
    fs::write(plugin_root.join("README.md"), "# Full Plugin\n\nRead me.").unwrap();

    plugin_root
}

fn assert_error_contains<T: std::fmt::Debug>(result: Result<T, String>, expected: &str) {
    let error = result.expect_err("expected error");

    assert!(
        error.contains(expected),
        "expected error to contain {expected:?}, got {error:?}"
    );
}

fn app_plugins_dir(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("plugins")
}

fn fixture_plugins_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .join("tests")
        .join("fixtures")
        .join("plugins")
}

fn copy_fixture_plugin(app_data_dir: &Path, plugin_id: &str) {
    let source = fixture_plugins_dir().join(plugin_id);
    let destination = app_plugins_dir(app_data_dir).join(plugin_id);

    copy_dir_all(&source, &destination).unwrap();
}

fn valid_archive_manifest(plugin_id: &str) -> String {
    format!(
        r#"{{
  "id": "{plugin_id}",
  "name": "Archive Plugin",
  "version": "0.2.0",
  "apiVersion": "0.2.0",
  "page": "./page.json",
  "entrypoints": {{ "main": "./main.js" }},
  "contributes": {{
    "internalPage": {{
      "id": "plugin:{plugin_id}",
      "titleFallback": "Archive Plugin"
    }}
  }}
}}"#
    )
}

fn valid_archive_entries(plugin_id: &str) -> Vec<(String, Vec<u8>)> {
    vec![
        (
            "manifest.json".to_string(),
            valid_archive_manifest(plugin_id).into_bytes(),
        ),
        (
            "page.json".to_string(),
            format!(r#"{{ "id": "plugin:{plugin_id}", "tabs": [] }}"#).into_bytes(),
        ),
        (
            "main.js".to_string(),
            b"export default function activate() {}".to_vec(),
        ),
    ]
}

fn write_zip_archive(path: &Path, entries: Vec<(String, Vec<u8>)>) {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).unwrap();
    }

    let file = File::create(path).unwrap();
    let mut zip = zip::ZipWriter::new(file);
    let options =
        zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);

    for (name, bytes) in entries {
        zip.start_file(name, options).unwrap();
        zip.write_all(&bytes).unwrap();
    }

    zip.finish().unwrap();
}

fn write_plugin_archive(root: &Path, plugin_id: &str, entries: Vec<(String, Vec<u8>)>) -> PathBuf {
    let archive_path = root.join(format!("{plugin_id}-0.2.0.glimpse-plugin.zip"));

    write_zip_archive(&archive_path, entries);

    archive_path
}

#[path = "tests_archive.rs"]
mod archive;
#[path = "tests_lifecycle.rs"]
mod lifecycle;
#[path = "tests_manifest.rs"]
mod manifest;

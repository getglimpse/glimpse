use super::*;

#[test]
fn manifest_loads_v02_standard_page_manifest() {
    let app_data_dir = unique_test_dir("app");
    let plugins_dir = app_plugins_dir(&app_data_dir);
    let plugin_id = "v02-plugin";
    let plugin_root = write_plugin_manifest(
        &plugins_dir,
        plugin_id,
        &format!(
            r#"{{
  "id": "{plugin_id}",
  "name": "v0.2 Plugin",
  "version": "0.2.0",
  "apiVersion": "0.2.0",
  "defaultLocale": "en",
  "i18n": "./i18n.json",
  "page": "./page.json",
  "entrypoints": {{ "main": "./main.js" }},
  "capabilities": {{
    "files": {{
      "read": "none",
      "write": "declared-output-directory"
    }}
  }},
  "settings": {{
    "outputDirectory": {{
      "type": "directory",
      "labelKey": "settings.outputDirectory.label",
      "labelFallback": "Output directory"
    }}
  }},
  "contributes": {{
    "internalPage": {{
      "id": "plugin:{plugin_id}",
      "titleKey": "plugin.name",
      "titleFallback": "v0.2 Plugin"
    }},
    "actions": [
      {{
        "id": "calculate",
        "titleKey": "actions.calculate.title",
        "titleFallback": "Calculate",
        "descriptionKey": "actions.calculate.description",
        "descriptionFallback": "Run a calculation.",
        "input": {{ "type": "text" }},
        "output": {{ "type": "text" }}
      }}
    ],
    "viewers": [
      {{
        "id": "csv",
        "titleKey": "viewers.csv.title",
        "titleFallback": "CSV Viewer",
        "extensions": ["csv"]
      }}
    ]
  }}
}}"#
        ),
    );
    fs::write(
        plugin_root.join("page.json"),
        r#"{
  "id": "plugin:v02-plugin",
  "tabs": [
    {
      "id": "playground",
      "type": "playground",
      "titleKey": "tabs.playground.title",
      "titleFallback": "Playground",
      "action": "calculate",
      "inputPlaceholderFallback": "Expression",
      "examples": ["1 + 1"]
    }
  ]
}"#,
    )
    .unwrap();
    fs::write(plugin_root.join("i18n.json"), r#"{ "en": {} }"#).unwrap();
    fs::write(
        plugin_root.join("main.js"),
        "export default function activate() {}",
    )
    .unwrap();

    let manifest = load_plugin_manifest(&plugin_root.join("manifest.json")).unwrap();
    let contributes = manifest.contributes.as_ref().unwrap();
    let page = manifest.internal_pages.as_ref().unwrap().first().unwrap();

    assert_eq!(manifest.api_version.as_deref(), Some("0.2.0"));
    assert_eq!(manifest.page.as_deref(), Some("./page.json"));
    assert!(manifest.page_definition.is_some());
    assert!(manifest.settings.is_some());
    assert_eq!(page.title, "v0.2 Plugin");
    assert_eq!(page.page_action.as_ref().unwrap().action_id, "calculate");
    assert!(page.page_definition.is_some());
    assert_eq!(contributes.actions.as_ref().unwrap()[0].title, "Calculate");
    assert_eq!(
        contributes.actions.as_ref().unwrap()[0]
            .description
            .as_deref(),
        Some("Run a calculation.")
    );
    assert_eq!(contributes.viewers.as_ref().unwrap()[0].title, "CSV Viewer");

    fs::remove_dir_all(app_data_dir).ok();
}

#[test]
fn v02_page_definition_participates_in_plugin_fingerprint() {
    let app_data_dir = unique_test_dir("app");
    let settings_path = app_data_dir.join("settings.json");
    let plugins_dir = app_plugins_dir(&app_data_dir);
    let plugin_id = "v02-trust-plugin";
    let plugin_root = write_plugin_manifest(
        &plugins_dir,
        plugin_id,
        &format!(
            r#"{{
  "id": "{plugin_id}",
  "name": "v0.2 Trust Plugin",
  "version": "0.2.0",
  "apiVersion": "0.2.0",
  "page": "./page.json",
  "entrypoints": {{ "main": "./main.js" }},
  "contributes": {{
    "internalPage": {{
      "id": "plugin:{plugin_id}",
      "titleFallback": "v0.2 Trust Plugin"
    }}
  }}
}}"#
        ),
    );
    fs::write(
        plugin_root.join("page.json"),
        r#"{ "id": "plugin:v02-trust-plugin", "tabs": [] }"#,
    )
    .unwrap();
    fs::write(
        plugin_root.join("main.js"),
        "export default function activate() {}",
    )
    .unwrap();

    let trusted = set_plugin_trust(&app_data_dir, &settings_path, plugin_id, true).unwrap();
    fs::write(
            plugin_root.join("page.json"),
            r#"{ "id": "plugin:v02-trust-plugin", "tabs": [{ "id": "playground", "type": "playground", "action": "calculate" }] }"#,
        )
        .unwrap();

    let changed = get_plugin_trust_status(&app_data_dir, &settings_path, plugin_id).unwrap();

    assert!(!changed.trusted);
    assert_eq!(
        changed.reason.as_deref(),
        Some("plugin files changed since it was trusted")
    );
    assert_ne!(changed.manifest_fingerprint, trusted.manifest_fingerprint);

    fs::remove_dir_all(app_data_dir).ok();
}

#[test]
fn manifest_normalizes_contributions_and_capabilities() {
    let app_data_dir = unique_test_dir("app");
    let plugins_dir = app_plugins_dir(&app_data_dir);
    let plugin_id = "full-manifest-plugin";
    let plugin_root = write_full_plugin(&plugins_dir, plugin_id);

    let manifest = load_plugin_manifest(&plugin_root.join("manifest.json")).unwrap();

    assert_eq!(manifest.id, plugin_id);
    assert_eq!(manifest.api_version.as_deref(), Some("0.1.0"));
    assert!(manifest.capabilities.is_some());
    assert!(manifest
        .capabilities
        .as_ref()
        .and_then(|capabilities| capabilities.files.as_ref())
        .and_then(|files| files.read.as_ref())
        .is_some());
    assert!(manifest.internal_pages.is_some());
    assert_eq!(
        manifest
            .contributes
            .as_ref()
            .unwrap()
            .internal_pages
            .as_ref()
            .unwrap()[0]
            .id,
        format!("plugin:{plugin_id}")
    );
    assert_eq!(
        manifest
            .contributes
            .as_ref()
            .unwrap()
            .actions
            .as_ref()
            .unwrap()[0]
            .id,
        "calculate"
    );
    assert_eq!(
        manifest
            .contributes
            .as_ref()
            .unwrap()
            .viewers
            .as_ref()
            .unwrap()[0]
            .id,
        "pdf"
    );

    fs::remove_dir_all(app_data_dir).ok();
}

#[test]
fn manifest_loads_linked_i18n_file_when_declared() {
    let app_data_dir = unique_test_dir("app");
    let plugins_dir = app_plugins_dir(&app_data_dir);
    let plugin_id = "linked-i18n-plugin";
    let plugin_root = write_plugin_manifest(
        &plugins_dir,
        plugin_id,
        &format!(
            r#"{{
  "id": "{plugin_id}",
  "name": "Linked i18n Plugin",
  "version": "0.1.0",
  "apiVersion": "0.1.0",
  "defaultLocale": "en",
  "i18n": "./i18n.json",
  "entrypoints": {{ "main": "./main.js" }}
}}"#
        ),
    );
    fs::write(
        plugin_root.join("i18n.json"),
        r#"{
  "en": {
    "plugin.name": "Linked i18n Plugin",
    "actions.hello.title": "Say hello"
  },
  "ja": {
    "plugin.name": "リンク i18n プラグイン"
  }
}"#,
    )
    .unwrap();
    fs::write(
        plugin_root.join("main.js"),
        "export default function activate() {}",
    )
    .unwrap();

    let manifest = load_plugin_manifest(&plugin_root.join("manifest.json")).unwrap();
    let i18n = manifest.i18n.as_ref().unwrap();

    assert_eq!(manifest.default_locale.as_deref(), Some("en"));
    assert_eq!(manifest.i18n_path.as_deref(), Some("./i18n.json"));
    assert_eq!(i18n["defaultLocale"], serde_json::json!("en"));
    assert_eq!(
        i18n["translations"]["ja"]["plugin.name"],
        serde_json::json!("リンク i18n プラグイン")
    );

    fs::remove_dir_all(app_data_dir).ok();
}

#[test]
fn linked_i18n_file_participates_in_plugin_fingerprint() {
    let app_data_dir = unique_test_dir("app");
    let settings_path = app_data_dir.join("settings.json");
    let plugins_dir = app_plugins_dir(&app_data_dir);
    let plugin_id = "i18n-trust-plugin";
    let plugin_root = write_plugin_manifest(
        &plugins_dir,
        plugin_id,
        &format!(
            r#"{{
  "id": "{plugin_id}",
  "name": "i18n Trust Plugin",
  "version": "0.1.0",
  "apiVersion": "0.1.0",
  "defaultLocale": "en",
  "i18n": "./i18n.json",
  "entrypoints": {{ "main": "./main.js" }}
}}"#
        ),
    );
    fs::write(
        plugin_root.join("i18n.json"),
        r#"{ "en": { "name": "Before" } }"#,
    )
    .unwrap();
    fs::write(
        plugin_root.join("main.js"),
        "export default function activate() {}",
    )
    .unwrap();

    let trusted = set_plugin_trust(&app_data_dir, &settings_path, plugin_id, true).unwrap();
    fs::write(
        plugin_root.join("i18n.json"),
        r#"{ "en": { "name": "After" } }"#,
    )
    .unwrap();

    let changed = get_plugin_trust_status(&app_data_dir, &settings_path, plugin_id).unwrap();

    assert!(!changed.trusted);
    assert_eq!(
        changed.reason.as_deref(),
        Some("plugin files changed since it was trusted")
    );
    assert_ne!(changed.manifest_fingerprint, trusted.manifest_fingerprint);

    fs::remove_dir_all(app_data_dir).ok();
}

#[test]
fn linked_i18n_allows_missing_default_locale_dictionary() {
    let app_data_dir = unique_test_dir("app");
    let plugins_dir = app_plugins_dir(&app_data_dir);
    let plugin_id = "partial-i18n-plugin";
    let plugin_root = write_plugin_manifest(
        &plugins_dir,
        plugin_id,
        &format!(
            r#"{{
  "id": "{plugin_id}",
  "name": "Partial i18n Plugin",
  "version": "0.1.0",
  "apiVersion": "0.1.0",
  "defaultLocale": "en",
  "i18n": "./i18n.json",
  "entrypoints": {{ "main": "./main.js" }}
}}"#
        ),
    );
    fs::write(
        plugin_root.join("i18n.json"),
        r#"{ "ja": { "plugin.name": "部分 i18n プラグイン" } }"#,
    )
    .unwrap();
    fs::write(
        plugin_root.join("main.js"),
        "export default function activate() {}",
    )
    .unwrap();

    let manifest = load_plugin_manifest(&plugin_root.join("manifest.json")).unwrap();

    assert_eq!(manifest.default_locale.as_deref(), Some("en"));
    assert_eq!(
        manifest.i18n.as_ref().unwrap()["translations"]["ja"]["plugin.name"],
        serde_json::json!("部分 i18n プラグイン")
    );

    fs::remove_dir_all(app_data_dir).ok();
}

#[test]
fn manifest_rejects_unsafe_entrypoints_and_contribution_ids() {
    let app_data_dir = unique_test_dir("app");
    let plugins_dir = app_plugins_dir(&app_data_dir);

    let unsafe_entry = write_plugin_manifest(
        &plugins_dir,
        "unsafe-entry-plugin",
        r#"{
  "id": "unsafe-entry-plugin",
  "name": "Unsafe Entry Plugin",
  "version": "0.1.0",
  "apiVersion": "0.1.0",
  "entrypoints": { "main": "../main.js" }
}"#,
    );
    let bad_page = write_plugin_manifest(
        &plugins_dir,
        "bad-page-plugin",
        r#"{
  "id": "bad-page-plugin",
  "name": "Bad Page Plugin",
  "version": "0.1.0",
  "apiVersion": "0.1.0",
  "contributes": {
    "internalPages": [
      { "id": "plugin:other-plugin", "title": "Wrong Page" }
    ]
  }
}"#,
    );
    let bad_action = write_plugin_manifest(
        &plugins_dir,
        "bad-action-plugin",
        r#"{
  "id": "bad-action-plugin",
  "name": "Bad Action Plugin",
  "version": "0.1.0",
  "apiVersion": "0.1.0",
  "contributes": {
    "actions": [
      { "id": "../escape", "title": "Escape" }
    ]
  }
}"#,
    );
    let bad_viewer = write_plugin_manifest(
        &plugins_dir,
        "bad-viewer-plugin",
        r#"{
  "id": "bad-viewer-plugin",
  "name": "Bad Viewer Plugin",
  "version": "0.1.0",
  "apiVersion": "0.1.0",
  "contributes": {
    "viewers": [
      { "id": "../escape", "title": "Escape", "extensions": ["pdf"] }
    ]
  }
}"#,
    );

    assert_error_contains(
        load_plugin_manifest(&unsafe_entry.join("manifest.json")),
        "entrypoints.main must not contain parent directory segments",
    );
    assert_error_contains(
        load_plugin_manifest(&bad_page.join("manifest.json")),
        "internal page id must start with plugin:bad-page-plugin",
    );
    assert_error_contains(
        load_plugin_manifest(&bad_action.join("manifest.json")),
        "invalid action id",
    );
    assert_error_contains(
        load_plugin_manifest(&bad_viewer.join("manifest.json")),
        "invalid viewer id",
    );

    fs::remove_dir_all(app_data_dir).ok();
}

#[test]
fn manifest_rejects_backend_declarations() {
    let app_data_dir = unique_test_dir("app");
    let plugins_dir = app_plugins_dir(&app_data_dir);
    let plugin_root = write_plugin_manifest(
        &plugins_dir,
        "backend-plugin",
        r#"{
  "id": "backend-plugin",
  "name": "Backend Plugin",
  "version": "0.1.0",
  "apiVersion": "0.1.0",
  "backend": {
    "runtime": "native-library-hosted",
    "entry": "./backend/plugin.dll"
  }
}"#,
    );

    assert_error_contains(
        load_plugin_manifest(&plugin_root.join("manifest.json")),
        "plugin backend is not supported",
    );

    fs::remove_dir_all(app_data_dir).ok();
}

#[test]
fn page_converter_accepts_manual_execution_and_overwrite_mode() {
    let page = serde_json::json!({
        "id": "plugin:converter-plugin",
        "tabs": [{
            "id": "convert",
            "type": "converter",
            "action": "convert",
            "execution": "manual",
            "allowPaste": true,
            "outputModes": ["create", "overwrite"]
        }]
    });

    validate_page_definition(&page, "converter-plugin").unwrap();
    let auto = serde_json::json!({
        "id": "plugin:converter-plugin",
        "tabs": [{
            "id": "convert",
            "type": "converter",
            "action": "convert",
            "execution": "auto",
            "allowPaste": false
        }]
    });
    validate_page_definition(&auto, "converter-plugin").unwrap();
}

#[test]
fn page_converter_rejects_unsupported_execution_and_output_modes() {
    let invalid_execution = serde_json::json!({
        "id": "plugin:converter-plugin",
        "tabs": [{
            "id": "convert",
            "type": "converter",
            "action": "convert",
            "execution": "immediate"
        }]
    });
    let missing_create = serde_json::json!({
        "id": "plugin:converter-plugin",
        "tabs": [{
            "id": "convert",
            "type": "converter",
            "action": "convert",
            "outputModes": ["overwrite"]
        }]
    });
    let invalid_paste = serde_json::json!({
        "id": "plugin:converter-plugin",
        "tabs": [{
            "id": "convert",
            "type": "converter",
            "action": "convert",
            "allowPaste": "yes"
        }]
    });

    assert_error_contains(
        validate_page_definition(&invalid_execution, "converter-plugin"),
        "unsupported execution",
    );
    assert_error_contains(
        validate_page_definition(&missing_create, "converter-plugin"),
        "outputModes must include create",
    );
    assert_error_contains(
        validate_page_definition(&invalid_paste, "converter-plugin"),
        "allowPaste must be a boolean",
    );
}

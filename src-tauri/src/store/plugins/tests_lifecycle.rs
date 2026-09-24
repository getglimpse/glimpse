use super::*;

#[test]
fn installs_plugin_from_local_directory() {
    let app_data_dir = unique_test_dir("app");
    let source_parent = unique_test_dir("source");
    let settings_path = app_data_dir.join("settings.json");
    let plugin_id = "sample-install-plugin";

    write_plugin_source(&source_parent, plugin_id);

    let result = install_plugin_from_path(
        &app_data_dir,
        &settings_path,
        &source_parent.join(plugin_id).display().to_string(),
        false,
    )
    .unwrap();

    assert_eq!(result.plugin_id, plugin_id);
    assert!(!result.replaced);
    assert!(app_data_dir
        .join("plugins")
        .join(plugin_id)
        .join("main.js")
        .is_file());

    let manifests = load_plugin_manifests(&app_data_dir).unwrap();
    assert_eq!(manifests.len(), 1);
    assert_eq!(manifests[0].id, plugin_id);

    fs::remove_dir_all(app_data_dir).ok();
    fs::remove_dir_all(source_parent).ok();
}

#[test]
fn discovery_ignores_hidden_plugin_work_directories() {
    let app_data_dir = unique_test_dir("app");
    let plugins_dir = app_plugins_dir(&app_data_dir);

    write_plugin_source(&plugins_dir, "visible-plugin");
    write_plugin_source(&plugins_dir, ".install_hidden-plugin");

    let report = load_plugin_discovery_report(&app_data_dir).unwrap();
    let ids = report
        .manifests
        .iter()
        .map(|manifest| manifest.id.as_str())
        .collect::<Vec<_>>();

    assert_eq!(ids, vec!["visible-plugin"]);

    fs::remove_dir_all(app_data_dir).ok();
}

#[test]
fn discovery_reports_valid_manifests_and_invalid_plugin_errors() {
    let app_data_dir = unique_test_dir("app");
    let plugins_dir = app_plugins_dir(&app_data_dir);

    write_plugin_source(&plugins_dir, "valid-discovery-plugin");
    write_plugin_manifest(
        &plugins_dir,
        "invalid-discovery-plugin",
        r#"{
  "id": "invalid-discovery-plugin",
  "name": "Invalid Plugin",
  "version": "0.1",
  "apiVersion": "0.1.0"
}"#,
    );

    let report = load_plugin_discovery_report(&app_data_dir).unwrap();

    assert_eq!(report.manifests.len(), 1);
    assert_eq!(report.manifests[0].id, "valid-discovery-plugin");
    assert_eq!(report.errors.len(), 1);
    assert!(report.errors[0].path.ends_with("manifest.json"));
    assert!(report.errors[0]
        .error
        .contains("version must be a semantic version triplet"));

    fs::remove_dir_all(app_data_dir).ok();
}

#[test]
fn reads_entrypoints_and_assets_inside_plugin_root_only() {
    let app_data_dir = unique_test_dir("app");
    let plugins_dir = app_plugins_dir(&app_data_dir);
    let plugin_id = "asset-entry-plugin";

    write_full_plugin(&plugins_dir, plugin_id);

    let main = read_plugin_entrypoint_source(&app_data_dir, plugin_id, "main").unwrap();
    let page = read_plugin_entrypoint_source(&app_data_dir, plugin_id, "page").unwrap();
    let styles = read_plugin_asset_source(&app_data_dir, plugin_id, "styles").unwrap();
    let readme = read_plugin_readme_source(&app_data_dir, plugin_id).unwrap();

    assert_eq!(main.plugin_id, plugin_id);
    assert_eq!(main.entrypoint, "main");
    assert!(main.source.contains("activate"));
    assert_eq!(page.entrypoint, "page");
    assert!(page.source.contains("page = true"));
    assert_eq!(styles.asset, "styles");
    assert!(styles.source.contains(".fixture"));
    assert_eq!(readme.plugin_id, plugin_id);
    assert!(readme.path.ends_with("README.md"));
    assert!(readme.source.contains("Full Plugin"));

    assert_error_contains(
        read_plugin_entrypoint_source(&app_data_dir, plugin_id, "unknown"),
        "unsupported plugin entrypoint",
    );
    assert_error_contains(
        read_plugin_asset_source(&app_data_dir, plugin_id, "script"),
        "unsupported plugin asset",
    );
    assert_error_contains(
        read_plugin_entrypoint_source(&app_data_dir, "../escape", "main"),
        "invalid plugin id",
    );
    assert_error_contains(
        read_plugin_readme_source(&app_data_dir, "../escape"),
        "invalid plugin id",
    );

    let missing_readme_plugin = "missing-readme-plugin";
    write_plugin_source(&plugins_dir, missing_readme_plugin);

    assert_error_contains(
        read_plugin_readme_source(&app_data_dir, missing_readme_plugin),
        "plugin README not found",
    );

    let large_readme_plugin = "large-readme-plugin";
    let large_readme_root = write_full_plugin(&plugins_dir, large_readme_plugin);
    fs::write(
        large_readme_root.join("README.md"),
        vec![b'a'; (PLUGIN_README_MAX_BYTES + 1) as usize],
    )
    .unwrap();

    assert_error_contains(
        read_plugin_readme_source(&app_data_dir, large_readme_plugin),
        "plugin README is too large",
    );

    fs::remove_dir_all(app_data_dir).ok();
}

#[test]
fn fixture_plugins_satisfy_discovery_entrypoint_and_trust_contracts() {
    let app_data_dir = unique_test_dir("app");
    let settings_path = app_data_dir.join("settings.json");

    copy_fixture_plugin(&app_data_dir, "valid-basic-plugin");
    copy_fixture_plugin(&app_data_dir, "numeric-calculator-plugin");

    let report = load_plugin_discovery_report(&app_data_dir).unwrap();
    let ids = report
        .manifests
        .iter()
        .map(|manifest| manifest.id.as_str())
        .collect::<std::collections::HashSet<_>>();

    assert!(report.errors.is_empty(), "{:?}", report.errors);
    assert_eq!(ids.len(), 2);
    assert!(ids.contains("valid-basic-plugin"));
    assert!(ids.contains("numeric-calculator-plugin"));

    let basic = report
        .manifests
        .iter()
        .find(|manifest| manifest.id == "valid-basic-plugin")
        .unwrap();
    let numeric = report
        .manifests
        .iter()
        .find(|manifest| manifest.id == "numeric-calculator-plugin")
        .unwrap();

    assert_eq!(
        basic
            .contributes
            .as_ref()
            .unwrap()
            .actions
            .as_ref()
            .unwrap()[0]
            .id,
        "hello"
    );
    assert_eq!(
        numeric
            .contributes
            .as_ref()
            .unwrap()
            .internal_pages
            .as_ref()
            .unwrap()[0]
            .id,
        "plugin:numeric-calculator-plugin"
    );

    let main = read_plugin_entrypoint_source(&app_data_dir, "valid-basic-plugin", "main").unwrap();
    let styles = read_plugin_asset_source(&app_data_dir, "valid-basic-plugin", "styles").unwrap();

    assert!(main.source.contains("ctx.registerAction"));
    assert!(styles.source.contains("data-glimpse-plugin-page"));

    let initial =
        get_plugin_trust_status(&app_data_dir, &settings_path, "valid-basic-plugin").unwrap();
    assert!(!initial.trusted);

    let trusted =
        set_plugin_trust(&app_data_dir, &settings_path, "valid-basic-plugin", true).unwrap();
    assert!(trusted.trusted);
    ensure_plugin_trusted(&app_data_dir, &settings_path, "valid-basic-plugin").unwrap();

    fs::remove_dir_all(app_data_dir).ok();
}

#[test]
fn fixture_plugin_can_be_installed_from_contract_bundle() {
    let app_data_dir = unique_test_dir("app");
    let settings_path = app_data_dir.join("settings.json");
    let source = fixture_plugins_dir().join("numeric-calculator-plugin");

    let result = install_plugin_from_path(
        &app_data_dir,
        &settings_path,
        &source.display().to_string(),
        false,
    )
    .unwrap();
    let manifest = result.manifest;

    assert_eq!(result.plugin_id, "numeric-calculator-plugin");
    assert!(!result.replaced);
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
    assert!(app_data_dir
        .join("plugins")
        .join("numeric-calculator-plugin")
        .join("main.js")
        .is_file());

    fs::remove_dir_all(app_data_dir).ok();
}

#[test]
fn invalid_fixture_plugin_is_reported_as_discovery_error() {
    let app_data_dir = unique_test_dir("app");

    copy_fixture_plugin(&app_data_dir, "invalid-manifest-plugin");

    let report = load_plugin_discovery_report(&app_data_dir).unwrap();

    assert!(report.manifests.is_empty());
    assert_eq!(report.errors.len(), 1);
    assert!(report.errors[0]
        .error
        .contains("entrypoints.main must not contain parent directory segments"));

    fs::remove_dir_all(app_data_dir).ok();
}

#[test]
fn trust_status_tracks_fingerprint_and_version() {
    let app_data_dir = unique_test_dir("app");
    let settings_path = app_data_dir.join("settings.json");
    let plugins_dir = app_plugins_dir(&app_data_dir);
    let plugin_id = "trust-plugin";
    let plugin_root = write_full_plugin(&plugins_dir, plugin_id);

    let initial = get_plugin_trust_status(&app_data_dir, &settings_path, plugin_id).unwrap();
    assert!(!initial.trusted);
    assert_eq!(
        initial.reason.as_deref(),
        Some("plugin has not been trusted yet")
    );
    assert_error_contains(
        ensure_plugin_trusted(&app_data_dir, &settings_path, plugin_id),
        "plugin is not trusted",
    );

    let trusted = set_plugin_trust(&app_data_dir, &settings_path, plugin_id, true).unwrap();
    assert!(trusted.trusted);
    assert!(trusted.trusted_at.is_some());
    ensure_plugin_trusted(&app_data_dir, &settings_path, plugin_id).unwrap();

    fs::write(
        plugin_root.join("main.js"),
        "export default function activate() { return 'changed'; }",
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
fn trust_status_detects_version_changes() {
    let app_data_dir = unique_test_dir("app");
    let settings_path = app_data_dir.join("settings.json");
    let plugins_dir = app_plugins_dir(&app_data_dir);
    let plugin_id = "version-trust-plugin";
    let plugin_root = write_plugin_manifest(
        &plugins_dir,
        plugin_id,
        &format!(
            r#"{{
  "id": "{plugin_id}",
  "name": "Version Trust Plugin",
  "version": "0.1.0",
  "apiVersion": "0.1.0",
  "entrypoints": {{ "main": "./main.js" }}
}}"#
        ),
    );
    fs::write(
        plugin_root.join("main.js"),
        "export default function activate() {}",
    )
    .unwrap();

    set_plugin_trust(&app_data_dir, &settings_path, plugin_id, true).unwrap();
    fs::write(
        plugin_root.join("manifest.json"),
        format!(
            r#"{{
  "id": "{plugin_id}",
  "name": "Version Trust Plugin",
  "version": "0.2.0",
  "apiVersion": "0.1.0",
  "entrypoints": {{ "main": "./main.js" }}
}}"#
        ),
    )
    .unwrap();

    let changed = get_plugin_trust_status(&app_data_dir, &settings_path, plugin_id).unwrap();

    assert!(!changed.trusted);
    assert_eq!(
        changed.reason.as_deref(),
        Some("plugin version changed since it was trusted")
    );
    assert_eq!(changed.trusted_version.as_deref(), Some("0.1.0"));
    assert_eq!(changed.version, "0.2.0");

    fs::remove_dir_all(app_data_dir).ok();
}

#[test]
fn install_replace_overwrites_files_and_revokes_trust() {
    let app_data_dir = unique_test_dir("app");
    let source_parent = unique_test_dir("source");
    let settings_path = app_data_dir.join("settings.json");
    let plugin_id = "replace-plugin";

    write_plugin_source(&source_parent, plugin_id);
    install_plugin_from_path(
        &app_data_dir,
        &settings_path,
        &source_parent.join(plugin_id).display().to_string(),
        false,
    )
    .unwrap();
    set_plugin_trust(&app_data_dir, &settings_path, plugin_id, true).unwrap();

    assert_error_contains(
        install_plugin_from_path(
            &app_data_dir,
            &settings_path,
            &source_parent.join(plugin_id).display().to_string(),
            false,
        ),
        "pass replace=true",
    );

    fs::write(
        source_parent.join(plugin_id).join("main.js"),
        "export default function activate() { return 'replaced'; }",
    )
    .unwrap();

    let result = install_plugin_from_path(
        &app_data_dir,
        &settings_path,
        &source_parent.join(plugin_id).display().to_string(),
        true,
    )
    .unwrap();
    let installed_main =
        fs::read_to_string(app_data_dir.join("plugins").join(plugin_id).join("main.js")).unwrap();
    let trust = get_plugin_trust_status(&app_data_dir, &settings_path, plugin_id).unwrap();

    assert!(result.replaced);
    assert!(installed_main.contains("replaced"));
    assert!(!trust.trusted);
    assert_eq!(
        trust.reason.as_deref(),
        Some("plugin has not been trusted yet")
    );

    fs::remove_dir_all(app_data_dir).ok();
    fs::remove_dir_all(source_parent).ok();
}

#[test]
fn remote_plugin_provenance_is_returned_in_trust_status() {
    let app_data_dir = unique_test_dir("app");
    let settings_path = app_data_dir.join("settings.json");
    let plugins_dir = app_plugins_dir(&app_data_dir);
    let plugin_id = "remote-provenance-plugin";
    let registry_url = "https://raw.githubusercontent.com/getglimpse/plugins/main/registry.json";
    let download_url = "https://github.com/getglimpse/plugins/releases/download/remote-provenance-plugin-v0.1.0/remote-provenance-plugin-0.1.0.glimpse-plugin.zip";
    let digest = "f8e403e2374041ab56e8c44469fb639c45643237c7c543fd9efedab9b69c41b7";

    write_plugin_source(&plugins_dir, plugin_id);
    set_remote_plugin_provenance(
        &settings_path,
        plugin_id,
        registry_url,
        download_url,
        digest,
        digest,
    )
    .unwrap();

    let status = get_plugin_trust_status(&app_data_dir, &settings_path, plugin_id).unwrap();
    let provenance = status.provenance.unwrap();

    assert_eq!(provenance.install_source, PluginInstallSource::Remote);
    assert_eq!(provenance.registry_url.as_deref(), Some(registry_url));
    assert_eq!(provenance.download_url.as_deref(), Some(download_url));
    assert_eq!(provenance.registry_sha256.as_deref(), Some(digest));
    assert_eq!(provenance.installed_package_sha256.as_deref(), Some(digest));
    assert!(provenance.installed_at.is_some());

    fs::remove_dir_all(app_data_dir).ok();
}

#[test]
fn local_install_clears_remote_plugin_provenance_and_trust() {
    let app_data_dir = unique_test_dir("app");
    let source_parent = unique_test_dir("source");
    let settings_path = app_data_dir.join("settings.json");
    let plugin_id = "local-over-remote-plugin";
    let digest = "f8e403e2374041ab56e8c44469fb639c45643237c7c543fd9efedab9b69c41b7";

    let mut settings = AppSettings::default();
    settings.plugins.insert(
            plugin_id.to_string(),
            PluginSettings {
                trust: Some(PluginTrustRecord {
                    trusted_at: Some("2026-09-06T00:00:00Z".to_string()),
                    manifest_fingerprint: Some("remote-fingerprint".to_string()),
                    version: Some("0.1.0".to_string()),
                }),
                provenance: Some(PluginInstallProvenance {
                    install_source: PluginInstallSource::Remote,
                    registry_url: Some(
                        "https://raw.githubusercontent.com/getglimpse/plugins/main/registry.json"
                            .to_string(),
                    ),
                    download_url: Some("https://github.com/getglimpse/plugins/releases/download/local-over-remote-plugin-v0.1.0/local-over-remote-plugin-0.1.0.glimpse-plugin.zip".to_string()),
                    registry_sha256: Some(digest.to_string()),
                    installed_package_sha256: Some(digest.to_string()),
                    installed_at: Some("2026-09-06T00:00:00Z".to_string()),
                }),
                copy_successful_search_results: std::collections::HashMap::from([(
                    "calculate".to_string(),
                    true,
                )]),
                ..Default::default()
            },
        );
    save_settings(&settings_path, &settings).unwrap();

    write_plugin_source(&source_parent, plugin_id);
    install_plugin_from_path(
        &app_data_dir,
        &settings_path,
        &source_parent.join(plugin_id).display().to_string(),
        false,
    )
    .unwrap();

    let settings = load_settings(&settings_path);
    let plugin_settings = settings.plugins.get(plugin_id).unwrap();

    assert!(plugin_settings.trust.is_none());
    assert!(plugin_settings.provenance.is_none());
    assert_eq!(
        plugin_settings
            .copy_successful_search_results
            .get("calculate"),
        Some(&true)
    );

    fs::remove_dir_all(app_data_dir).ok();
    fs::remove_dir_all(source_parent).ok();
}

#[test]
fn uninstall_removes_plugin_and_trust_record() {
    let app_data_dir = unique_test_dir("app");
    let source_parent = unique_test_dir("source");
    let settings_path = app_data_dir.join("settings.json");
    let plugin_id = "sample-uninstall-plugin";

    write_plugin_source(&source_parent, plugin_id);
    install_plugin_from_path(
        &app_data_dir,
        &settings_path,
        &source_parent.join(plugin_id).display().to_string(),
        false,
    )
    .unwrap();

    let mut settings = AppSettings::default();
    settings.plugins.insert(
        plugin_id.to_string(),
        PluginSettings {
            trust: Some(PluginTrustRecord {
                trusted_at: Some("2026-07-26T00:00:00Z".to_string()),
                manifest_fingerprint: Some("test".to_string()),
                version: Some("0.1.0".to_string()),
            }),
            copy_successful_search_results: std::collections::HashMap::from([(
                "calculate".to_string(),
                true,
            )]),
            ..Default::default()
        },
    );
    save_settings(&settings_path, &settings).unwrap();

    let result = uninstall_plugin(&app_data_dir, &settings_path, plugin_id).unwrap();

    assert!(result.removed);
    assert!(!app_data_dir.join("plugins").join(plugin_id).exists());
    assert!(!load_settings(&settings_path)
        .plugins
        .contains_key(plugin_id));

    fs::remove_dir_all(app_data_dir).ok();
    fs::remove_dir_all(source_parent).ok();
}

#[test]
fn uninstall_rejects_invalid_plugin_id() {
    let app_data_dir = unique_test_dir("app");
    let settings_path = app_data_dir.join("settings.json");
    let plugins_dir = app_plugins_dir(&app_data_dir);

    write_plugin_source(&plugins_dir, "safe-plugin");

    assert_error_contains(
        uninstall_plugin(&app_data_dir, &settings_path, "../safe-plugin"),
        "invalid plugin id",
    );
    assert!(plugins_dir.join("safe-plugin").is_dir());

    fs::remove_dir_all(app_data_dir).ok();
}

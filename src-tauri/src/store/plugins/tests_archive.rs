use super::*;

#[test]
fn installs_plugin_from_archive_root() {
    let app_data_dir = unique_test_dir("app");
    let archive_root = unique_test_dir("archive");
    let settings_path = app_data_dir.join("settings.json");
    let plugin_id = "archive-install-plugin";
    let archive_path =
        write_plugin_archive(&archive_root, plugin_id, valid_archive_entries(plugin_id));

    let result = install_plugin_from_archive(
        &app_data_dir,
        &settings_path,
        &archive_path.display().to_string(),
        false,
    )
    .unwrap();

    assert_eq!(result.plugin_id, plugin_id);
    assert!(!result.replaced);
    assert!(app_data_dir
        .join("plugins")
        .join(plugin_id)
        .join("manifest.json")
        .is_file());
    assert!(app_data_dir
        .join("plugins")
        .join(plugin_id)
        .join("main.js")
        .is_file());

    fs::remove_dir_all(app_data_dir).ok();
    fs::remove_dir_all(archive_root).ok();
}

#[test]
fn installs_plugin_from_archive_with_single_parent_directory() {
    let app_data_dir = unique_test_dir("app");
    let archive_root = unique_test_dir("archive");
    let settings_path = app_data_dir.join("settings.json");
    let plugin_id = "archive-parent-plugin";
    let entries = valid_archive_entries(plugin_id)
        .into_iter()
        .map(|(path, bytes)| (format!("{plugin_id}-0.2.0/{path}"), bytes))
        .collect();
    let archive_path = write_plugin_archive(&archive_root, plugin_id, entries);

    let result = install_plugin_from_archive(
        &app_data_dir,
        &settings_path,
        &archive_path.display().to_string(),
        false,
    )
    .unwrap();

    assert_eq!(result.plugin_id, plugin_id);
    assert!(app_data_dir
        .join("plugins")
        .join(plugin_id)
        .join("page.json")
        .is_file());

    fs::remove_dir_all(app_data_dir).ok();
    fs::remove_dir_all(archive_root).ok();
}

#[test]
fn archive_install_rejects_path_traversal() {
    let app_data_dir = unique_test_dir("app");
    let archive_root = unique_test_dir("archive");
    let settings_path = app_data_dir.join("settings.json");
    let plugin_id = "archive-slip-plugin";
    let mut entries = valid_archive_entries(plugin_id);
    entries.push(("../escape.txt".to_string(), b"nope".to_vec()));
    let archive_path = write_plugin_archive(&archive_root, plugin_id, entries);

    assert_error_contains(
        install_plugin_from_archive(
            &app_data_dir,
            &settings_path,
            &archive_path.display().to_string(),
            false,
        ),
        "escapes archive root",
    );
    assert!(!app_data_dir.join("plugins").join(plugin_id).exists());

    fs::remove_dir_all(app_data_dir).ok();
    fs::remove_dir_all(archive_root).ok();
}

#[test]
fn archive_install_rejects_unsupported_files() {
    let app_data_dir = unique_test_dir("app");
    let archive_root = unique_test_dir("archive");
    let settings_path = app_data_dir.join("settings.json");
    let plugin_id = "archive-docs-plugin";
    let mut entries = valid_archive_entries(plugin_id);
    entries.push(("docs/readme.md".to_string(), b"not packaged".to_vec()));
    let archive_path = write_plugin_archive(&archive_root, plugin_id, entries);

    assert_error_contains(
        install_plugin_from_archive(
            &app_data_dir,
            &settings_path,
            &archive_path.display().to_string(),
            false,
        ),
        "unsupported file",
    );
    assert!(!app_data_dir.join("plugins").join(plugin_id).exists());

    fs::remove_dir_all(app_data_dir).ok();
    fs::remove_dir_all(archive_root).ok();
}

#[test]
fn archive_install_rejects_missing_manifest() {
    let app_data_dir = unique_test_dir("app");
    let archive_root = unique_test_dir("archive");
    let settings_path = app_data_dir.join("settings.json");
    let plugin_id = "archive-missing-manifest-plugin";
    let entries = valid_archive_entries(plugin_id)
        .into_iter()
        .filter(|(path, _)| path != "manifest.json")
        .collect();
    let archive_path = write_plugin_archive(&archive_root, plugin_id, entries);

    assert_error_contains(
        install_plugin_from_archive(
            &app_data_dir,
            &settings_path,
            &archive_path.display().to_string(),
            false,
        ),
        "manifest.json",
    );
    assert!(!app_data_dir.join("plugins").join(plugin_id).exists());

    fs::remove_dir_all(app_data_dir).ok();
    fs::remove_dir_all(archive_root).ok();
}

#[test]
fn archive_install_rejects_manifest_page_id_mismatch() {
    let app_data_dir = unique_test_dir("app");
    let archive_root = unique_test_dir("archive");
    let settings_path = app_data_dir.join("settings.json");
    let archive_plugin_id = "archive-id-mismatch-plugin";
    let manifest_plugin_id = "archive-other-plugin";
    let mut entries = valid_archive_entries(archive_plugin_id);

    entries[0] = (
        "manifest.json".to_string(),
        valid_archive_manifest(manifest_plugin_id).into_bytes(),
    );

    let archive_path = write_plugin_archive(&archive_root, archive_plugin_id, entries);

    assert_error_contains(
        install_plugin_from_archive(
            &app_data_dir,
            &settings_path,
            &archive_path.display().to_string(),
            false,
        ),
        "page.id must start with plugin:archive-other-plugin",
    );
    assert!(!app_data_dir
        .join("plugins")
        .join(archive_plugin_id)
        .exists());
    assert!(!app_data_dir
        .join("plugins")
        .join(manifest_plugin_id)
        .exists());

    fs::remove_dir_all(app_data_dir).ok();
    fs::remove_dir_all(archive_root).ok();
}

#[test]
fn archive_install_rejects_unsupported_api_version() {
    let app_data_dir = unique_test_dir("app");
    let archive_root = unique_test_dir("archive");
    let settings_path = app_data_dir.join("settings.json");
    let plugin_id = "archive-unsupported-api-plugin";
    let mut entries = valid_archive_entries(plugin_id);

    entries[0] = (
        "manifest.json".to_string(),
        valid_archive_manifest(plugin_id)
            .replace(r#""apiVersion": "0.2.0""#, r#""apiVersion": "999.0.0""#)
            .into_bytes(),
    );

    let archive_path = write_plugin_archive(&archive_root, plugin_id, entries);

    assert_error_contains(
        install_plugin_from_archive(
            &app_data_dir,
            &settings_path,
            &archive_path.display().to_string(),
            false,
        ),
        "unsupported plugin apiVersion",
    );
    assert!(!app_data_dir.join("plugins").join(plugin_id).exists());

    fs::remove_dir_all(app_data_dir).ok();
    fs::remove_dir_all(archive_root).ok();
}

#[test]
fn archive_install_failure_keeps_existing_plugin() {
    let app_data_dir = unique_test_dir("app");
    let archive_root = unique_test_dir("archive");
    let source_parent = unique_test_dir("source");
    let settings_path = app_data_dir.join("settings.json");
    let plugin_id = "archive-keep-existing-plugin";

    write_plugin_source(&source_parent, plugin_id);
    install_plugin_from_path(
        &app_data_dir,
        &settings_path,
        &source_parent.join(plugin_id).display().to_string(),
        false,
    )
    .unwrap();
    set_plugin_trust(&app_data_dir, &settings_path, plugin_id, true).unwrap();
    let original_main =
        fs::read_to_string(app_data_dir.join("plugins").join(plugin_id).join("main.js")).unwrap();

    let mut entries = valid_archive_entries(plugin_id);
    entries.push(("extra.js".to_string(), b"export default null;".to_vec()));
    let archive_path = write_plugin_archive(&archive_root, plugin_id, entries);

    assert_error_contains(
        install_plugin_from_archive(
            &app_data_dir,
            &settings_path,
            &archive_path.display().to_string(),
            true,
        ),
        "unsupported file",
    );

    let installed_main =
        fs::read_to_string(app_data_dir.join("plugins").join(plugin_id).join("main.js")).unwrap();
    let trust = get_plugin_trust_status(&app_data_dir, &settings_path, plugin_id).unwrap();

    assert_eq!(installed_main, original_main);
    assert!(trust.trusted);

    fs::remove_dir_all(app_data_dir).ok();
    fs::remove_dir_all(archive_root).ok();
    fs::remove_dir_all(source_parent).ok();
}

#[test]
fn archive_replace_revokes_existing_plugin_trust() {
    let app_data_dir = unique_test_dir("app");
    let archive_root = unique_test_dir("archive");
    let source_parent = unique_test_dir("source");
    let settings_path = app_data_dir.join("settings.json");
    let plugin_id = "archive-revoke-trust-plugin";

    write_plugin_source(&source_parent, plugin_id);
    install_plugin_from_path(
        &app_data_dir,
        &settings_path,
        &source_parent.join(plugin_id).display().to_string(),
        false,
    )
    .unwrap();
    set_plugin_trust(&app_data_dir, &settings_path, plugin_id, true).unwrap();

    let mut entries = valid_archive_entries(plugin_id);
    entries[2] = (
        "main.js".to_string(),
        b"export default function activate() { return 'remote replacement'; }".to_vec(),
    );
    let archive_path = write_plugin_archive(&archive_root, plugin_id, entries);
    let result = install_plugin_from_archive(
        &app_data_dir,
        &settings_path,
        &archive_path.display().to_string(),
        true,
    )
    .unwrap();
    let trust = get_plugin_trust_status(&app_data_dir, &settings_path, plugin_id).unwrap();

    assert!(result.replaced);
    assert!(!trust.trusted);
    assert_eq!(
        trust.reason.as_deref(),
        Some("plugin has not been trusted yet")
    );
    assert_error_contains(
        ensure_plugin_trusted(&app_data_dir, &settings_path, plugin_id),
        "plugin is not trusted",
    );

    fs::remove_dir_all(app_data_dir).ok();
    fs::remove_dir_all(archive_root).ok();
    fs::remove_dir_all(source_parent).ok();
}

#[test]
fn plugin_archive_download_url_requires_https_zip_url() {
    assert_error_contains(
        validate_plugin_archive_download_url(
            "http://github.com/getglimpse/plugins/releases/download/plugin.zip",
        ),
        "must use https",
    );
    assert_error_contains(
        validate_plugin_archive_download_url("https://example.com/plugin.zip"),
        "must end with .glimpse-plugin.zip",
    );

    let parsed = validate_plugin_archive_download_url(
            "https://github.com/getglimpse/plugins/releases/download/v0.2.0/example-plugin-0.2.0.glimpse-plugin.zip",
        )
        .unwrap();

    assert_eq!(parsed.scheme(), "https");
}

#[test]
fn plugin_archive_sha256_is_normalized_and_validated() {
    assert_error_contains(validate_sha256_digest("abc"), "64 character hex digest");
    assert_error_contains(
        validate_sha256_digest("zzzz03237c7c543fd9efedab9b69c41b7f8e403e2374041ab56e8c44469fb639c"),
        "64 character hex digest",
    );

    let digest =
        validate_sha256_digest("F8E403E2374041AB56E8C44469FB639C45643237C7C543FD9EFEDAB9B69C41B7")
            .unwrap();

    assert_eq!(
        digest,
        "f8e403e2374041ab56e8c44469fb639c45643237c7c543fd9efedab9b69c41b7"
    );
}

#[test]
fn plugin_archive_sha256_mismatch_is_install_failure() {
    assert_error_contains(
        verify_sha256_digest(
            "1111111111111111111111111111111111111111111111111111111111111111",
            "2222222222222222222222222222222222222222222222222222222222222222",
        ),
        "checksum mismatch",
    );
}

#[tokio::test]
async fn install_plugin_from_url_rejects_invalid_inputs_before_download() {
    let app_data_dir = unique_test_dir("app");
    let settings_path = app_data_dir.join("settings.json");
    let digest = "f8e403e2374041ab56e8c44469fb639c45643237c7c543fd9efedab9b69c41b7";
    let registry_url = OFFICIAL_PLUGIN_REGISTRY_URL;

    assert_error_contains(
        install_plugin_from_url(
            &app_data_dir,
            &settings_path,
            "http://example.com/plugin.glimpse-plugin.zip",
            digest,
            Some(registry_url),
            false,
        )
        .await,
        "must use https",
    );
    assert_error_contains(
        install_plugin_from_url(
            &app_data_dir,
            &settings_path,
            "https://example.com/plugin.glimpse-plugin.zip",
            "not-a-digest",
            Some(registry_url),
            false,
        )
        .await,
        "64 character hex digest",
    );
    assert_error_contains(
        install_plugin_from_url(
            &app_data_dir,
            &settings_path,
            "https://example.com/plugin.glimpse-plugin.zip",
            digest,
            Some("https://example.com/registry.json"),
            false,
        )
        .await,
        "official Glimpse plugin registry",
    );

    fs::remove_dir_all(app_data_dir).ok();
}

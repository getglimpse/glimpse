use super::*;

#[test]
fn read_text_file_reads_file_inside_current_target_group() {
    let target_dir = unique_test_dir("target");
    let settings_dir = unique_test_dir("settings");
    let settings_path = settings_dir.join("settings.json");

    fs::create_dir_all(&target_dir).unwrap();
    fs::create_dir_all(&settings_dir).unwrap();

    write_settings(&settings_path, &target_dir);

    let file_path = target_dir.join("Note.md");
    fs::write(&file_path, "content").unwrap();

    let content = read_text_file(&settings_path, file_path.to_string_lossy().to_string()).unwrap();

    assert_eq!(content, "content");

    fs::remove_dir_all(target_dir).ok();
    fs::remove_dir_all(settings_dir).ok();
}

#[test]
fn read_binary_file_reads_base64_inside_current_target_group() {
    let target_dir = unique_test_dir("target");
    let settings_dir = unique_test_dir("settings");
    let settings_path = settings_dir.join("settings.json");

    fs::create_dir_all(&target_dir).unwrap();
    fs::create_dir_all(&settings_dir).unwrap();

    write_settings(&settings_path, &target_dir);

    let file_path = target_dir.join("Report.docx");
    fs::write(&file_path, b"hello").unwrap();

    let content =
        read_binary_file(&settings_path, file_path.to_string_lossy().to_string()).unwrap();

    assert_eq!(content, "aGVsbG8=");

    fs::remove_dir_all(target_dir).ok();
    fs::remove_dir_all(settings_dir).ok();
}

#[test]
fn read_preview_asset_data_url_reads_asset_inside_source_target_group() {
    let target_dir = unique_test_dir("target");
    let settings_dir = unique_test_dir("settings");
    let settings_path = settings_dir.join("settings.json");

    fs::create_dir_all(&target_dir).unwrap();
    fs::create_dir_all(&settings_dir).unwrap();

    write_settings(&settings_path, &target_dir);

    let source_path = target_dir.join("Note.md");
    let asset_path = target_dir.join("image.png");
    fs::write(&source_path, "![image](image.png)").unwrap();
    fs::write(&asset_path, b"hello").unwrap();

    let data_url = read_preview_asset_data_url(
        &settings_path,
        source_path.to_string_lossy().to_string(),
        asset_path.to_string_lossy().to_string(),
    )
    .unwrap();

    assert_eq!(data_url, "data:image/png;base64,aGVsbG8=");

    fs::remove_dir_all(target_dir).ok();
    fs::remove_dir_all(settings_dir).ok();
}

#[test]
fn read_preview_asset_data_url_rejects_asset_in_other_target_group() {
    let active_dir = unique_test_dir("active");
    let other_dir = unique_test_dir("other");
    let settings_dir = unique_test_dir("settings");
    let settings_path = settings_dir.join("settings.json");

    fs::create_dir_all(&active_dir).unwrap();
    fs::create_dir_all(&other_dir).unwrap();
    fs::create_dir_all(&settings_dir).unwrap();

    write_settings_with_groups(
        &settings_path,
        vec![
            target_group("active", vec![active_dir.clone()]),
            target_group("other", vec![other_dir.clone()]),
        ],
        "active",
    );

    let source_path = active_dir.join("Note.md");
    let asset_path = other_dir.join("secret.png");
    fs::write(&source_path, "![secret](secret.png)").unwrap();
    fs::write(&asset_path, b"secret").unwrap();

    let result = read_preview_asset_data_url(
        &settings_path,
        source_path.to_string_lossy().to_string(),
        asset_path.to_string_lossy().to_string(),
    );

    assert!(result.is_err());
    assert!(result
        .unwrap_err()
        .contains("preview asset is outside the source target group"));

    fs::remove_dir_all(active_dir).ok();
    fs::remove_dir_all(other_dir).ok();
    fs::remove_dir_all(settings_dir).ok();
}

#[test]
fn read_preview_asset_data_url_rejects_unsupported_asset_type() {
    let target_dir = unique_test_dir("target");
    let settings_dir = unique_test_dir("settings");
    let settings_path = settings_dir.join("settings.json");

    fs::create_dir_all(&target_dir).unwrap();
    fs::create_dir_all(&settings_dir).unwrap();

    write_settings(&settings_path, &target_dir);

    let source_path = target_dir.join("Note.md");
    let asset_path = target_dir.join("vector.svg");
    fs::write(&source_path, "![vector](vector.svg)").unwrap();
    fs::write(&asset_path, "<svg></svg>").unwrap();

    let result = read_preview_asset_data_url(
        &settings_path,
        source_path.to_string_lossy().to_string(),
        asset_path.to_string_lossy().to_string(),
    );

    assert!(result.is_err());
    assert!(result
        .unwrap_err()
        .contains("unsupported preview asset type: svg"));

    fs::remove_dir_all(target_dir).ok();
    fs::remove_dir_all(settings_dir).ok();
}

#[test]
fn get_file_metadata_returns_size_inside_current_target_group() {
    let target_dir = unique_test_dir("target");
    let settings_dir = unique_test_dir("settings");
    let settings_path = settings_dir.join("settings.json");

    fs::create_dir_all(&target_dir).unwrap();
    fs::create_dir_all(&settings_dir).unwrap();

    write_settings(&settings_path, &target_dir);

    let file_path = target_dir.join("Book.pdf");
    fs::write(&file_path, b"hello").unwrap();

    let metadata =
        get_file_metadata(&settings_path, file_path.to_string_lossy().to_string()).unwrap();

    assert_eq!(metadata.size_bytes, 5);

    fs::remove_dir_all(target_dir).ok();
    fs::remove_dir_all(settings_dir).ok();
}

#[test]
fn get_file_metadata_in_target_group_rejects_other_groups() {
    let active_dir = unique_test_dir("active");
    let other_dir = unique_test_dir("other");
    let settings_dir = unique_test_dir("settings");
    let settings_path = settings_dir.join("settings.json");

    fs::create_dir_all(&active_dir).unwrap();
    fs::create_dir_all(&other_dir).unwrap();
    fs::create_dir_all(&settings_dir).unwrap();

    write_settings_with_groups(
        &settings_path,
        vec![
            target_group("active", vec![active_dir.clone()]),
            target_group("other", vec![other_dir.clone()]),
        ],
        "active",
    );

    let file_path = other_dir.join("Other.pdf");
    fs::write(&file_path, b"hello").unwrap();

    let result = get_file_metadata_in_target_group(
        &settings_path,
        file_path.to_string_lossy().to_string(),
        "active".to_string(),
    );

    assert!(result.is_err());
    assert!(result
        .unwrap_err()
        .contains("path is outside target group directories"));

    fs::remove_dir_all(active_dir).ok();
    fs::remove_dir_all(other_dir).ok();
    fs::remove_dir_all(settings_dir).ok();
}

#[test]
fn read_binary_file_rejects_files_over_preview_limit() {
    let target_dir = unique_test_dir("target");
    let settings_dir = unique_test_dir("settings");
    let settings_path = settings_dir.join("settings.json");

    fs::create_dir_all(&target_dir).unwrap();
    fs::create_dir_all(&settings_dir).unwrap();

    write_settings(&settings_path, &target_dir);

    let file_path = target_dir.join("Huge.docx");
    let file = fs::OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&file_path)
        .unwrap();
    file.set_len(MAX_BINARY_READ_BYTES + 1).unwrap();
    drop(file);

    let result = read_binary_file(&settings_path, file_path.to_string_lossy().to_string());

    assert!(result.is_err());
    assert!(result.unwrap_err().contains("binary file is too large"));

    fs::remove_dir_all(target_dir).ok();
    fs::remove_dir_all(settings_dir).ok();
}

#[test]
fn read_text_file_rejects_files_over_preview_limit() {
    let target_dir = unique_test_dir("target");
    let settings_dir = unique_test_dir("settings");
    let settings_path = settings_dir.join("settings.json");

    fs::create_dir_all(&target_dir).unwrap();
    fs::create_dir_all(&settings_dir).unwrap();

    write_settings(&settings_path, &target_dir);

    let file_path = target_dir.join("Huge.csv");
    let file = fs::OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&file_path)
        .unwrap();
    file.set_len(MAX_TEXT_READ_BYTES + 1).unwrap();

    let result = read_text_file(&settings_path, file_path.to_string_lossy().to_string());

    assert!(result.is_err());
    assert!(result.unwrap_err().contains("text file is too large"));

    fs::remove_dir_all(target_dir).ok();
    fs::remove_dir_all(settings_dir).ok();
}

#[test]
fn read_text_file_reads_file_inside_non_current_target_group() {
    let active_dir = unique_test_dir("active");
    let inactive_dir = unique_test_dir("inactive");
    let settings_dir = unique_test_dir("settings");
    let settings_path = settings_dir.join("settings.json");

    fs::create_dir_all(&active_dir).unwrap();
    fs::create_dir_all(&inactive_dir).unwrap();
    fs::create_dir_all(&settings_dir).unwrap();

    write_settings_with_groups(
        &settings_path,
        vec![
            target_group("active", vec![active_dir.clone()]),
            target_group("inactive", vec![inactive_dir.clone()]),
        ],
        "active",
    );

    let file_path = inactive_dir.join("tools.gjson");
    fs::write(&file_path, r#"{"items":[]}"#).unwrap();

    let content = read_text_file(&settings_path, file_path.to_string_lossy().to_string()).unwrap();

    assert_eq!(content, r#"{"items":[]}"#);

    fs::remove_dir_all(active_dir).ok();
    fs::remove_dir_all(inactive_dir).ok();
    fs::remove_dir_all(settings_dir).ok();
}

#[test]
fn read_text_file_in_target_group_reads_file_inside_named_group() {
    let target_dir = unique_test_dir("scoped_root");
    let settings_dir = unique_test_dir("settings");
    let settings_path = settings_dir.join("settings.json");

    fs::create_dir_all(&target_dir).unwrap();
    fs::create_dir_all(&settings_dir).unwrap();

    write_settings_with_groups(
        &settings_path,
        vec![target_group("active", vec![target_dir.clone()])],
        "active",
    );

    let file_path = target_dir.join("Note.md");
    fs::write(&file_path, "scoped content").unwrap();

    let content = read_text_file_in_target_group(
        &settings_path,
        file_path.to_string_lossy().to_string(),
        "active".to_string(),
    )
    .unwrap();

    assert_eq!(content, "scoped content");

    fs::remove_dir_all(target_dir).ok();
    fs::remove_dir_all(settings_dir).ok();
}

#[test]
fn read_text_file_in_target_group_rejects_parent_traversal_into_inactive_root() {
    let parent_dir = unique_test_dir("scoped_roots");
    let active_dir = parent_dir.join("active");
    let inactive_dir = parent_dir.join("inactive");
    let settings_dir = unique_test_dir("settings");
    let settings_path = settings_dir.join("settings.json");

    fs::create_dir_all(&active_dir).unwrap();
    fs::create_dir_all(&inactive_dir).unwrap();
    fs::create_dir_all(&settings_dir).unwrap();

    write_settings_with_groups(
        &settings_path,
        vec![
            target_group("active", vec![active_dir.clone()]),
            target_group("inactive", vec![inactive_dir.clone()]),
        ],
        "active",
    );

    let file_path = inactive_dir.join("Secret.md");
    fs::write(&file_path, "secret").unwrap();

    let traversal_path = active_dir.join("..").join("inactive").join("Secret.md");
    let result = read_text_file_in_target_group(
        &settings_path,
        traversal_path.to_string_lossy().to_string(),
        "active".to_string(),
    );

    assert!(result.is_err());
    assert!(result
        .unwrap_err()
        .contains("path is outside target group directories"));

    fs::remove_dir_all(parent_dir).ok();
    fs::remove_dir_all(settings_dir).ok();
}

#[test]
fn read_text_file_in_target_group_rejects_unknown_target_group() {
    let target_dir = unique_test_dir("target");
    let settings_dir = unique_test_dir("settings");
    let settings_path = settings_dir.join("settings.json");

    fs::create_dir_all(&target_dir).unwrap();
    fs::create_dir_all(&settings_dir).unwrap();

    write_settings(&settings_path, &target_dir);

    let file_path = target_dir.join("Note.md");
    fs::write(&file_path, "content").unwrap();

    let result = read_text_file_in_target_group(
        &settings_path,
        file_path.to_string_lossy().to_string(),
        "other".to_string(),
    );

    assert!(result.is_err());
    assert!(result
        .unwrap_err()
        .contains("target group not found: other"));

    fs::remove_dir_all(target_dir).ok();
    fs::remove_dir_all(settings_dir).ok();
}

#[cfg(windows)]
#[test]
fn read_text_file_accepts_windows_verbatim_source_path() {
    let target_dir = unique_test_dir("target");
    let settings_dir = unique_test_dir("settings");
    let settings_path = settings_dir.join("settings.json");

    fs::create_dir_all(&target_dir).unwrap();
    fs::create_dir_all(&settings_dir).unwrap();

    write_settings(&settings_path, &target_dir);

    let file_path = target_dir.join("Note.md");
    fs::write(&file_path, "content").unwrap();

    let verbatim_path = format!(r"\\?\{}", file_path.display());
    let content = read_text_file(&settings_path, verbatim_path).unwrap();

    assert_eq!(content, "content");

    fs::remove_dir_all(target_dir).ok();
    fs::remove_dir_all(settings_dir).ok();
}

#[test]
fn read_text_file_rejects_file_outside_current_target_group() {
    let target_dir = unique_test_dir("target");
    let outside_dir = unique_test_dir("outside");
    let settings_dir = unique_test_dir("settings");
    let settings_path = settings_dir.join("settings.json");

    fs::create_dir_all(&target_dir).unwrap();
    fs::create_dir_all(&outside_dir).unwrap();
    fs::create_dir_all(&settings_dir).unwrap();

    write_settings(&settings_path, &target_dir);

    let file_path = outside_dir.join("Secret.md");
    fs::write(&file_path, "secret").unwrap();

    let result = read_text_file(&settings_path, file_path.to_string_lossy().to_string());

    assert!(result.is_err());

    fs::remove_dir_all(target_dir).ok();
    fs::remove_dir_all(outside_dir).ok();
    fs::remove_dir_all(settings_dir).ok();
}

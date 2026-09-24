use super::*;

#[test]
fn update_markdown_file_body_updates_body_without_renaming() {
    let target_dir = unique_test_dir("target");
    let settings_dir = unique_test_dir("settings");
    let settings_path = settings_dir.join("settings.json");

    fs::create_dir_all(&target_dir).unwrap();
    fs::create_dir_all(&settings_dir).unwrap();

    write_settings(&settings_path, &target_dir);

    let file_path = target_dir.join("Note.md");
    fs::write(&file_path, "old").unwrap();

    update_markdown_file_body(
        &settings_path,
        file_path.to_string_lossy().to_string(),
        "new".to_string(),
    )
    .unwrap();

    assert!(file_path.exists());
    assert_eq!(fs::read_to_string(file_path).unwrap(), "new");

    fs::remove_dir_all(target_dir).ok();
    fs::remove_dir_all(settings_dir).ok();
}

#[test]
fn save_text_file_renames_and_replaces_body_together() {
    let target_dir = unique_test_dir("target");
    let settings_dir = unique_test_dir("settings");
    let settings_path = settings_dir.join("settings.json");
    fs::create_dir_all(&target_dir).unwrap();
    fs::create_dir_all(&settings_dir).unwrap();
    write_settings(&settings_path, &target_dir);
    let old_path = target_dir.join("Old.md");
    fs::write(&old_path, "old body").unwrap();

    let saved_path = save_text_file(
        &settings_path,
        old_path.to_string_lossy().to_string(),
        "New".into(),
        "new body".into(),
    )
    .unwrap();

    assert_same_path(&saved_path, target_dir.join("New.md"));
    assert!(!old_path.exists());
    assert_eq!(fs::read_to_string(saved_path).unwrap(), "new body");
    fs::remove_dir_all(target_dir).ok();
    fs::remove_dir_all(settings_dir).ok();
}

#[test]
fn save_text_file_collision_leaves_original_unchanged() {
    let target_dir = unique_test_dir("target");
    let settings_dir = unique_test_dir("settings");
    let settings_path = settings_dir.join("settings.json");
    fs::create_dir_all(&target_dir).unwrap();
    fs::create_dir_all(&settings_dir).unwrap();
    write_settings(&settings_path, &target_dir);
    let old_path = target_dir.join("Old.md");
    let occupied_path = target_dir.join("Taken.md");
    fs::write(&old_path, "old body").unwrap();
    fs::write(&occupied_path, "occupied").unwrap();

    let result = save_text_file(
        &settings_path,
        old_path.to_string_lossy().to_string(),
        "Taken".into(),
        "new body".into(),
    );

    assert!(result.is_err());
    assert_eq!(fs::read_to_string(old_path).unwrap(), "old body");
    assert_eq!(fs::read_to_string(occupied_path).unwrap(), "occupied");
    fs::remove_dir_all(target_dir).ok();
    fs::remove_dir_all(settings_dir).ok();
}

#[test]
fn save_text_file_replaces_body_without_renaming() {
    let target_dir = unique_test_dir("target");
    let settings_dir = unique_test_dir("settings");
    let settings_path = settings_dir.join("settings.json");
    fs::create_dir_all(&target_dir).unwrap();
    fs::create_dir_all(&settings_dir).unwrap();
    write_settings(&settings_path, &target_dir);
    let file_path = target_dir.join("Note.gjson");
    fs::write(&file_path, "old body").unwrap();

    let saved_path = save_text_file(
        &settings_path,
        file_path.to_string_lossy().to_string(),
        "Note".into(),
        "new body".into(),
    )
    .unwrap();

    assert_same_path(&saved_path, &file_path);
    assert_eq!(fs::read_to_string(saved_path).unwrap(), "new body");
    fs::remove_dir_all(target_dir).ok();
    fs::remove_dir_all(settings_dir).ok();
}

#[test]
fn save_text_file_restores_original_after_rename_commit_failure() {
    let target_dir = unique_test_dir("target");
    let settings_dir = unique_test_dir("settings");
    let settings_path = settings_dir.join("settings.json");
    fs::create_dir_all(&target_dir).unwrap();
    fs::create_dir_all(&settings_dir).unwrap();
    write_settings(&settings_path, &target_dir);
    let original = target_dir.join("Old.md");
    fs::write(&original, "old body").unwrap();

    let result = save_text_file_with_hook(
        &settings_path,
        original.to_string_lossy().to_string(),
        "New".into(),
        "new body".into(),
        |stage| {
            if stage == SaveStage::BeforeOriginalRemove {
                Err("injected rename failure".into())
            } else {
                Ok(())
            }
        },
    );

    assert!(result.unwrap_err().contains("injected rename failure"));
    assert_eq!(fs::read_to_string(original).unwrap(), "old body");
    assert!(!target_dir.join("New.md").exists());
    assert_eq!(fs::read_dir(&target_dir).unwrap().count(), 1);
    fs::remove_dir_all(target_dir).ok();
    fs::remove_dir_all(settings_dir).ok();
}

#[test]
fn save_text_file_restores_original_after_replacement_failure() {
    let target_dir = unique_test_dir("target");
    let settings_dir = unique_test_dir("settings");
    let settings_path = settings_dir.join("settings.json");
    fs::create_dir_all(&target_dir).unwrap();
    fs::create_dir_all(&settings_dir).unwrap();
    write_settings(&settings_path, &target_dir);
    let original = target_dir.join("Note.md");
    fs::write(&original, "old body").unwrap();

    let result = save_text_file_with_hook(
        &settings_path,
        original.to_string_lossy().to_string(),
        "Note".into(),
        "new body".into(),
        |stage| {
            if stage == SaveStage::BeforeReplacement {
                Err("injected replacement failure".into())
            } else {
                Ok(())
            }
        },
    );

    assert!(result.unwrap_err().contains("injected replacement failure"));
    assert_eq!(fs::read_to_string(original).unwrap(), "old body");
    assert_eq!(fs::read_dir(&target_dir).unwrap().count(), 1);
    fs::remove_dir_all(target_dir).ok();
    fs::remove_dir_all(settings_dir).ok();
}

#[cfg(windows)]
#[test]
fn save_text_file_os_replacement_failure_keeps_original() {
    use std::os::windows::fs::OpenOptionsExt;

    let target_dir = unique_test_dir("target");
    let settings_dir = unique_test_dir("settings");
    let settings_path = settings_dir.join("settings.json");
    fs::create_dir_all(&target_dir).unwrap();
    fs::create_dir_all(&settings_dir).unwrap();
    write_settings(&settings_path, &target_dir);
    let original = target_dir.join("Note.md");
    fs::write(&original, "old body").unwrap();
    // Permit reads and writes, but deny DELETE sharing required by ReplaceFileW.
    let held = fs::OpenOptions::new()
        .read(true)
        .share_mode(0x0000_0001 | 0x0000_0002)
        .open(&original)
        .unwrap();

    let result = save_text_file(
        &settings_path,
        original.to_string_lossy().to_string(),
        "Note".into(),
        "new body".into(),
    );

    assert!(result.unwrap_err().contains("failed to replace file"));
    assert_eq!(fs::read_to_string(&original).unwrap(), "old body");
    assert_eq!(fs::read_dir(&target_dir).unwrap().count(), 1);
    drop(held);
    fs::remove_dir_all(target_dir).ok();
    fs::remove_dir_all(settings_dir).ok();
}

#[test]
fn update_markdown_file_title_renames_file() {
    let target_dir = unique_test_dir("target");
    let settings_dir = unique_test_dir("settings");
    let settings_path = settings_dir.join("settings.json");

    fs::create_dir_all(&target_dir).unwrap();
    fs::create_dir_all(&settings_dir).unwrap();

    write_settings(&settings_path, &target_dir);

    let file_path = target_dir.join("Old.md");
    fs::write(&file_path, "old").unwrap();

    let updated_path = update_markdown_file_title(
        &settings_path,
        file_path.to_string_lossy().to_string(),
        "New".to_string(),
    )
    .unwrap();

    assert_same_path(PathBuf::from(updated_path), target_dir.join("New.md"));
    assert!(!file_path.exists());
    assert_eq!(
        fs::read_to_string(target_dir.join("New.md")).unwrap(),
        "old"
    );

    fs::remove_dir_all(target_dir).ok();
    fs::remove_dir_all(settings_dir).ok();
}

#[test]
fn update_text_file_title_preserves_existing_extension() {
    let target_dir = unique_test_dir("target");
    let settings_dir = unique_test_dir("settings");
    let settings_path = settings_dir.join("settings.json");

    fs::create_dir_all(&target_dir).unwrap();
    fs::create_dir_all(&settings_dir).unwrap();

    write_settings(&settings_path, &target_dir);

    let file_path = target_dir.join("Old.txt");
    fs::write(&file_path, "old").unwrap();

    let updated_path = update_text_file_title(
        &settings_path,
        file_path.to_string_lossy().to_string(),
        "New".to_string(),
    )
    .unwrap();

    assert_same_path(PathBuf::from(updated_path), target_dir.join("New.txt"));
    assert!(!file_path.exists());
    assert_eq!(
        fs::read_to_string(target_dir.join("New.txt")).unwrap(),
        "old"
    );

    fs::remove_dir_all(target_dir).ok();
    fs::remove_dir_all(settings_dir).ok();
}

#[test]
fn update_text_file_title_preserves_missing_extension() {
    let target_dir = unique_test_dir("target");
    let settings_dir = unique_test_dir("settings");
    let settings_path = settings_dir.join("settings.json");

    fs::create_dir_all(&target_dir).unwrap();
    fs::create_dir_all(&settings_dir).unwrap();

    write_settings(&settings_path, &target_dir);

    let file_path = target_dir.join("Old");
    fs::write(&file_path, "old").unwrap();

    let updated_path = update_text_file_title(
        &settings_path,
        file_path.to_string_lossy().to_string(),
        "New".to_string(),
    )
    .unwrap();

    assert_same_path(PathBuf::from(updated_path), target_dir.join("New"));
    assert!(!file_path.exists());
    assert_eq!(fs::read_to_string(target_dir.join("New")).unwrap(), "old");

    fs::remove_dir_all(target_dir).ok();
    fs::remove_dir_all(settings_dir).ok();
}

#[test]
fn update_markdown_file_title_returns_same_path_when_title_matches() {
    let target_dir = unique_test_dir("target");
    let settings_dir = unique_test_dir("settings");
    let settings_path = settings_dir.join("settings.json");

    fs::create_dir_all(&target_dir).unwrap();
    fs::create_dir_all(&settings_dir).unwrap();

    write_settings(&settings_path, &target_dir);

    let file_path = target_dir.join("Note.md");
    fs::write(&file_path, "body").unwrap();

    let updated_path = update_markdown_file_title(
        &settings_path,
        file_path.to_string_lossy().to_string(),
        "Note".to_string(),
    )
    .unwrap();

    assert_same_path(PathBuf::from(updated_path), &file_path);
    assert_eq!(fs::read_to_string(file_path).unwrap(), "body");

    fs::remove_dir_all(target_dir).ok();
    fs::remove_dir_all(settings_dir).ok();
}

#[test]
fn update_markdown_file_title_rejects_rename_when_destination_exists() {
    let target_dir = unique_test_dir("target");
    let settings_dir = unique_test_dir("settings");
    let settings_path = settings_dir.join("settings.json");

    fs::create_dir_all(&target_dir).unwrap();
    fs::create_dir_all(&settings_dir).unwrap();

    write_settings(&settings_path, &target_dir);

    let old_path = target_dir.join("Old.md");
    let new_path = target_dir.join("New.md");

    fs::write(&old_path, "old").unwrap();
    fs::write(&new_path, "existing").unwrap();

    let result = update_markdown_file_title(
        &settings_path,
        old_path.to_string_lossy().to_string(),
        "New".to_string(),
    );

    assert!(result.is_err());
    assert_eq!(fs::read_to_string(old_path).unwrap(), "old");
    assert_eq!(fs::read_to_string(new_path).unwrap(), "existing");

    fs::remove_dir_all(target_dir).ok();
    fs::remove_dir_all(settings_dir).ok();
}

#[test]
fn overwrite_text_file_from_path_replaces_existing_content() {
    let target_dir = unique_test_dir("plugin-overwrite");
    fs::create_dir_all(&target_dir).unwrap();

    let file_path = target_dir.join("data.json");
    fs::write(&file_path, "{\n  \"ok\": true\n}\n").unwrap();

    let overwritten_path = overwrite_text_file_from_path(
        file_path.to_string_lossy().to_string(),
        "{\"ok\":true}\n".to_string(),
    )
    .unwrap();

    assert_same_path(PathBuf::from(overwritten_path), &file_path);
    assert_eq!(fs::read_to_string(&file_path).unwrap(), "{\"ok\":true}\n");

    fs::remove_dir_all(target_dir).ok();
}

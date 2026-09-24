use super::*;

#[test]
fn create_markdown_file_creates_file_in_current_target_primary_dir() {
    let target_dir = unique_test_dir("target");
    let settings_dir = unique_test_dir("settings");
    let settings_path = settings_dir.join("settings.json");

    fs::create_dir_all(&target_dir).unwrap();
    fs::create_dir_all(&settings_dir).unwrap();

    write_settings(&settings_path, &target_dir);

    let file_path = create_markdown_file_in_current_target(
        &settings_path,
        "Hello World".to_string(),
        "# Hello".to_string(),
    )
    .unwrap();

    let file_path = PathBuf::from(file_path);

    assert_same_path(&file_path, target_dir.join("Hello World.md"));
    assert_eq!(fs::read_to_string(file_path).unwrap(), "# Hello");

    fs::remove_dir_all(target_dir).ok();
    fs::remove_dir_all(settings_dir).ok();
}

#[test]
fn create_markdown_file_uses_unique_name_when_file_exists() {
    let target_dir = unique_test_dir("target");
    let settings_dir = unique_test_dir("settings");
    let settings_path = settings_dir.join("settings.json");

    fs::create_dir_all(&target_dir).unwrap();
    fs::create_dir_all(&settings_dir).unwrap();

    write_settings(&settings_path, &target_dir);

    fs::write(target_dir.join("Note.md"), "existing").unwrap();

    let file_path = create_markdown_file_in_current_target(
        &settings_path,
        "Note".to_string(),
        "new".to_string(),
    )
    .unwrap();

    assert_same_path(PathBuf::from(file_path), target_dir.join("Note 2.md"));

    assert_eq!(
        fs::read_to_string(target_dir.join("Note 2.md")).unwrap(),
        "new"
    );

    fs::remove_dir_all(target_dir).ok();
    fs::remove_dir_all(settings_dir).ok();
}

#[test]
fn create_markdown_file_sanitizes_title() {
    let target_dir = unique_test_dir("target");
    let settings_dir = unique_test_dir("settings");
    let settings_path = settings_dir.join("settings.json");

    fs::create_dir_all(&target_dir).unwrap();
    fs::create_dir_all(&settings_dir).unwrap();

    write_settings(&settings_path, &target_dir);

    let file_path = create_markdown_file_in_current_target(
        &settings_path,
        "a/b:c*?".to_string(),
        "body".to_string(),
    )
    .unwrap();

    assert_same_path(PathBuf::from(file_path), target_dir.join("a_b_c__.md"));

    fs::remove_dir_all(target_dir).ok();
    fs::remove_dir_all(settings_dir).ok();
}

#[test]
fn create_text_file_creates_gjson_file_in_current_target_primary_dir() {
    let target_dir = unique_test_dir("target");
    let settings_dir = unique_test_dir("settings");
    let settings_path = settings_dir.join("settings.json");

    fs::create_dir_all(&target_dir).unwrap();
    fs::create_dir_all(&settings_dir).unwrap();

    write_settings(&settings_path, &target_dir);

    let file_path = create_text_file_in_current_target(
        &settings_path,
        "Cards".to_string(),
        "{\"items\":[]}\n".to_string(),
        "gjson".to_string(),
    )
    .unwrap();

    let file_path = PathBuf::from(file_path);

    assert_same_path(&file_path, target_dir.join("Cards.gjson"));
    assert_eq!(fs::read_to_string(file_path).unwrap(), "{\"items\":[]}\n");

    fs::remove_dir_all(target_dir).ok();
    fs::remove_dir_all(settings_dir).ok();
}

#[test]
fn create_text_file_rejects_unsupported_extension() {
    let target_dir = unique_test_dir("target");
    let settings_dir = unique_test_dir("settings");
    let settings_path = settings_dir.join("settings.json");

    fs::create_dir_all(&target_dir).unwrap();
    fs::create_dir_all(&settings_dir).unwrap();

    write_settings(&settings_path, &target_dir);

    let result = create_text_file_in_current_target(
        &settings_path,
        "Raw".to_string(),
        "body".to_string(),
        "txt".to_string(),
    );

    assert!(result.is_err());
    assert!(result
        .unwrap_err()
        .contains("unsupported file extension: txt"));
    assert!(!target_dir.join("Raw.txt").exists());

    fs::remove_dir_all(target_dir).ok();
    fs::remove_dir_all(settings_dir).ok();
}

#[test]
fn create_text_file_at_path_creates_nested_file_inside_target_group() {
    let target_dir = unique_test_dir("target");
    let settings_dir = unique_test_dir("settings");
    let settings_path = settings_dir.join("settings.json");

    fs::create_dir_all(&target_dir).unwrap();
    fs::create_dir_all(&settings_dir).unwrap();

    write_settings(&settings_path, &target_dir);

    let requested_path = target_dir.join("docs").join("template.md");
    let file_path = create_text_file_at_path(
        &settings_path,
        requested_path.to_string_lossy().to_string(),
        "# Template".to_string(),
    )
    .unwrap();

    assert_same_path(PathBuf::from(file_path), &requested_path);
    assert_eq!(fs::read_to_string(requested_path).unwrap(), "# Template");

    fs::remove_dir_all(target_dir).ok();
    fs::remove_dir_all(settings_dir).ok();
}

#[test]
fn create_text_file_at_path_rejects_outside_target_group() {
    let target_dir = unique_test_dir("target");
    let outside_dir = unique_test_dir("outside");
    let settings_dir = unique_test_dir("settings");
    let settings_path = settings_dir.join("settings.json");

    fs::create_dir_all(&target_dir).unwrap();
    fs::create_dir_all(&outside_dir).unwrap();
    fs::create_dir_all(&settings_dir).unwrap();

    write_settings(&settings_path, &target_dir);

    let requested_path = outside_dir.join("secret.md");
    let result = create_text_file_at_path(
        &settings_path,
        requested_path.to_string_lossy().to_string(),
        "secret".to_string(),
    );

    assert!(result.is_err());
    assert!(!requested_path.exists());

    fs::remove_dir_all(target_dir).ok();
    fs::remove_dir_all(outside_dir).ok();
    fs::remove_dir_all(settings_dir).ok();
}

#[cfg(unix)]
#[test]
fn create_text_file_at_path_resolves_directory_aliases_without_allowing_escape() {
    use std::os::unix::fs::symlink;

    let test_dir = unique_test_dir("aliases");
    let target_dir = test_dir.join("target");
    let outside_dir = test_dir.join("outside");
    let target_alias = test_dir.join("target-alias");
    let outside_alias = target_dir.join("outside-alias");
    let settings_path = test_dir.join("settings.json");
    fs::create_dir_all(&target_dir).unwrap();
    fs::create_dir_all(&outside_dir).unwrap();
    symlink(&target_dir, &target_alias).unwrap();
    symlink(&outside_dir, &outside_alias).unwrap();
    write_settings(&settings_path, &target_dir);

    let requested_path = target_alias.join("docs").join("allowed.md");
    let created = create_text_file_at_path(
        &settings_path,
        requested_path.to_string_lossy().into_owned(),
        "allowed".into(),
    )
    .unwrap();
    assert_same_path(created, target_dir.join("docs").join("allowed.md"));

    let escaped_path = outside_alias.join("blocked.md");
    assert!(create_text_file_at_path(
        &settings_path,
        escaped_path.to_string_lossy().into_owned(),
        "blocked".into(),
    )
    .is_err());
    assert!(!outside_dir.join("blocked.md").exists());

    fs::remove_dir_all(test_dir).unwrap();
}

#[test]
fn create_text_file_at_path_rejects_parent_traversal() {
    let parent_dir = unique_test_dir("parent");
    let target_dir = parent_dir.join("target");
    let settings_dir = unique_test_dir("settings");
    let settings_path = settings_dir.join("settings.json");

    fs::create_dir_all(&target_dir).unwrap();
    fs::create_dir_all(&settings_dir).unwrap();

    write_settings(&settings_path, &target_dir);

    let requested_path = target_dir.join("..").join("outside.md");
    let result = create_text_file_at_path(
        &settings_path,
        requested_path.to_string_lossy().to_string(),
        "outside".to_string(),
    );

    assert!(result.is_err());
    assert!(!parent_dir.join("outside.md").exists());

    fs::remove_dir_all(parent_dir).ok();
    fs::remove_dir_all(settings_dir).ok();
}

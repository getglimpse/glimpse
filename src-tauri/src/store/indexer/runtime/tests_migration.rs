use super::*;

#[test]
fn migrate_primary_glimpse_dirs_moves_directory_when_primary_path_changes() {
    let old_dir = unique_test_dir("old");
    let new_dir = unique_test_dir("new");

    fs::create_dir_all(old_dir.join(".glimpse")).unwrap();
    fs::write(old_dir.join(".glimpse").join("index.db"), "db").unwrap();

    let previous_settings = AppSettings {
        target_groups: vec![target_group("work", vec![old_dir.clone()])],
        current_target_group_id: Some("work".to_string()),
        ..Default::default()
    };

    let settings = AppSettings {
        target_groups: vec![target_group("work", vec![new_dir.clone()])],
        current_target_group_id: Some("work".to_string()),
        ..Default::default()
    };

    migrate_primary_glimpse_dirs(&previous_settings, &settings).unwrap();

    assert!(!old_dir.join(".glimpse").exists());
    assert_eq!(
        fs::read_to_string(new_dir.join(".glimpse").join("index.db")).unwrap(),
        "db"
    );

    fs::remove_dir_all(old_dir).ok();
    fs::remove_dir_all(new_dir).ok();
}

#[test]
fn migrate_primary_glimpse_dirs_removes_old_directory_when_destination_exists() {
    let old_dir = unique_test_dir("old");
    let new_dir = unique_test_dir("new");

    fs::create_dir_all(old_dir.join(".glimpse")).unwrap();
    fs::create_dir_all(new_dir.join(".glimpse")).unwrap();
    fs::write(old_dir.join(".glimpse").join("old.db"), "old").unwrap();
    fs::write(new_dir.join(".glimpse").join("index.db"), "new").unwrap();

    let previous_settings = AppSettings {
        target_groups: vec![target_group("work", vec![old_dir.clone()])],
        current_target_group_id: Some("work".to_string()),
        ..Default::default()
    };

    let settings = AppSettings {
        target_groups: vec![target_group("work", vec![new_dir.clone()])],
        current_target_group_id: Some("work".to_string()),
        ..Default::default()
    };

    migrate_primary_glimpse_dirs(&previous_settings, &settings).unwrap();

    assert!(!old_dir.join(".glimpse").exists());
    assert_eq!(
        fs::read_to_string(new_dir.join(".glimpse").join("index.db")).unwrap(),
        "new"
    );

    fs::remove_dir_all(old_dir).ok();
    fs::remove_dir_all(new_dir).ok();
}

#[test]
fn global_primary_target_dirs_uses_fallback_when_no_groups_exist() {
    let settings = AppSettings::default();

    let result = global_primary_target_dirs(&settings, PathBuf::from("/fallback"));

    assert_eq!(result, vec![PathBuf::from("/fallback")]);
}

#[test]
fn global_primary_target_dirs_uses_first_path_from_each_group() {
    let settings = AppSettings {
        target_groups: vec![
            target_group(
                "work",
                vec![PathBuf::from("/work/a"), PathBuf::from("/work/b")],
            ),
            target_group("personal", vec![PathBuf::from("/personal")]),
        ],
        current_target_group_id: Some("work".to_string()),
        ..Default::default()
    };

    let result = global_primary_target_dirs(&settings, PathBuf::from("/fallback"));

    assert_eq!(
        result,
        vec![PathBuf::from("/work/a"), PathBuf::from("/personal"),]
    );
}

#[test]
fn global_primary_target_dirs_skips_empty_groups() {
    let settings = AppSettings {
        target_groups: vec![
            target_group("empty", vec![]),
            target_group("work", vec![PathBuf::from("/work")]),
        ],
        ..Default::default()
    };

    let result = global_primary_target_dirs(&settings, PathBuf::from("/fallback"));

    assert_eq!(result, vec![PathBuf::from("/work")]);
}

use super::*;

#[test]
fn default_settings_create_welcome_target_group_for_default_workspace() {
    let settings_dir = unique_test_dir("settings");
    let settings_path = settings_dir.join("settings.json");
    let default_target_dir = unique_test_dir("workspace").join("Glimpse");

    ensure_default_settings(&settings_path, &default_target_dir).unwrap();

    let settings = load_settings(&settings_path);

    assert_eq!(settings.current_target_group_id, Some("welcome".into()));
    assert_eq!(settings.target_groups.len(), 1);
    assert_eq!(settings.target_groups[0].id, "welcome");
    assert_eq!(settings.target_groups[0].name, "Welcome");
    assert_eq!(
        settings.target_groups[0].paths,
        vec![default_target_dir.to_string_lossy().to_string()]
    );
    assert!(settings.target_groups[0].active);

    fs::remove_dir_all(settings_dir).ok();
}

#[test]
fn save_replaces_settings_and_keeps_previous_valid_backup() {
    let dir = unique_test_dir("atomic-backup");
    let path = dir.join("settings.json");
    let first = AppSettings {
        theme: "first".into(),
        ..Default::default()
    };
    save_settings(&path, &first).unwrap();
    let mut second = first.clone();
    second.theme = "second".into();
    save_settings(&path, &second).unwrap();

    assert_eq!(try_load_settings(&path).unwrap().theme, "second");
    assert_eq!(
        try_load_settings(&backup_path(&path)).unwrap().theme,
        "first"
    );
    assert!(fs::read_dir(&dir).unwrap().all(|entry| {
        !entry
            .unwrap()
            .file_name()
            .to_string_lossy()
            .ends_with(".tmp")
    }));
    fs::remove_dir_all(dir).unwrap();
}

#[test]
fn corrupt_primary_is_not_overwritten_and_backup_is_available_for_read_only_use() {
    let dir = unique_test_dir("corrupt-backup");
    let path = dir.join("settings.json");
    let first = AppSettings {
        theme: "first".into(),
        ..Default::default()
    };
    save_settings(&path, &first).unwrap();
    let mut second = first.clone();
    second.theme = "second".into();
    save_settings(&path, &second).unwrap();
    fs::write(&path, b"{ incomplete").unwrap();

    assert!(try_load_settings(&path).unwrap_err().contains("invalid"));
    assert_eq!(load_settings(&path).theme, "first");
    assert!(save_settings(&path, &second)
        .unwrap_err()
        .contains("refusing"));
    assert_eq!(fs::read(&path).unwrap(), b"{ incomplete");
    assert_eq!(
        try_load_settings(&backup_path(&path)).unwrap().theme,
        "first"
    );
    fs::remove_dir_all(dir).unwrap();
}

#[test]
fn interrupted_temporary_write_does_not_change_settings() {
    let dir = unique_test_dir("interrupted-temp");
    let path = dir.join("settings.json");
    let settings = AppSettings::default();
    save_settings(&path, &settings).unwrap();
    let original = fs::read(&path).unwrap();
    fs::write(dir.join(".settings.json.interrupted.tmp"), b"{ incomplete").unwrap();

    assert_eq!(fs::read(&path).unwrap(), original);
    assert!(try_load_settings(&path).is_ok());
    save_settings(&path, &settings).unwrap();
    assert!(try_load_settings(&path).is_ok());
    fs::remove_dir_all(dir).unwrap();
}

#[test]
fn failed_backup_replacement_leaves_primary_unchanged() {
    let dir = unique_test_dir("backup-failure");
    let path = dir.join("settings.json");
    let first = AppSettings::default();
    save_settings(&path, &first).unwrap();
    let original = fs::read(&path).unwrap();
    fs::create_dir(backup_path(&path)).unwrap();
    let mut second = first.clone();
    second.theme = "changed".into();

    assert!(save_settings(&path, &second).is_err());
    assert_eq!(fs::read(&path).unwrap(), original);
    assert!(try_load_settings(&path).is_ok());
    assert!(fs::read_dir(&dir).unwrap().all(|entry| {
        !entry
            .unwrap()
            .file_name()
            .to_string_lossy()
            .ends_with(".tmp")
    }));
    fs::remove_dir_all(dir).unwrap();
}

#[cfg(windows)]
#[test]
fn locked_primary_replacement_leaves_previous_settings_and_cleans_temporary_file() {
    use std::os::windows::fs::OpenOptionsExt;

    let dir = unique_test_dir("locked-primary");
    let path = dir.join("settings.json");
    let first = AppSettings::default();
    save_settings(&path, &first).unwrap();
    let original = fs::read(&path).unwrap();
    // Permit reading/writing but deny the delete access required to replace
    // an open destination on Windows.
    let held = fs::OpenOptions::new()
        .read(true)
        .share_mode(0x0000_0001 | 0x0000_0002)
        .open(&path)
        .unwrap();
    let mut second = first.clone();
    second.theme = "changed".into();

    assert!(save_settings(&path, &second).is_err());
    assert_eq!(fs::read(&path).unwrap(), original);
    assert_eq!(
        try_load_settings(&backup_path(&path)).unwrap().theme,
        first.theme
    );
    assert!(fs::read_dir(&dir).unwrap().all(|entry| {
        !entry
            .unwrap()
            .file_name()
            .to_string_lossy()
            .ends_with(".tmp")
    }));
    drop(held);
    fs::remove_dir_all(dir).unwrap();
}

#[test]
fn corrupt_primary_and_backup_are_reported_without_overwriting_either() {
    let dir = unique_test_dir("both-corrupt");
    let path = dir.join("settings.json");
    save_settings(&path, &AppSettings::default()).unwrap();
    fs::write(&path, b"{ broken primary").unwrap();
    fs::write(backup_path(&path), b"{ broken backup").unwrap();

    let status = settings_recovery_status(&path);
    assert!(status.needs_recovery);
    assert!(!status.backup_available);
    assert!(status.error.is_some());
    assert_eq!(load_settings(&path).theme, AppSettings::default().theme);
    assert!(restore_settings_backup(&path).is_err());
    assert_eq!(fs::read(&path).unwrap(), b"{ broken primary");
    assert_eq!(fs::read(backup_path(&path)).unwrap(), b"{ broken backup");
    fs::remove_dir_all(dir).unwrap();
}

#[test]
fn restore_valid_backup_preserves_corrupt_primary() {
    let dir = unique_test_dir("restore-corrupt");
    let path = dir.join("settings.json");
    let first = AppSettings {
        theme: "first".into(),
        ..Default::default()
    };
    save_settings(&path, &first).unwrap();
    let mut second = first.clone();
    second.theme = "second".into();
    save_settings(&path, &second).unwrap();
    let corrupt = b"{ incomplete";
    fs::write(&path, corrupt).unwrap();

    let status = settings_recovery_status(&path);
    assert!(status.needs_recovery);
    assert!(status.backup_available);
    let restored = restore_settings_backup(&path).unwrap();
    assert_eq!(restored.theme, "first");
    assert_eq!(try_load_settings(&path).unwrap().theme, "first");
    assert!(!settings_recovery_status(&path).needs_recovery);
    let preserved = fs::read_dir(&dir)
        .unwrap()
        .map(|entry| entry.unwrap().path())
        .find(|entry| {
            entry
                .file_name()
                .unwrap()
                .to_string_lossy()
                .starts_with("settings.json.corrupt.")
        })
        .unwrap();
    assert_eq!(fs::read(preserved).unwrap(), corrupt);
    fs::remove_dir_all(dir).unwrap();
}

#[test]
fn restore_valid_backup_preserves_valid_primary() {
    let dir = unique_test_dir("restore-valid");
    let path = dir.join("settings.json");
    let first = AppSettings {
        theme: "first".into(),
        ..Default::default()
    };
    save_settings(&path, &first).unwrap();
    let mut second = first.clone();
    second.theme = "second".into();
    save_settings(&path, &second).unwrap();
    let current = fs::read(&path).unwrap();

    let status = settings_recovery_status(&path);
    assert!(!status.needs_recovery);
    assert!(status.backup_available);
    assert_eq!(restore_settings_backup(&path).unwrap().theme, "first");
    let preserved = fs::read_dir(&dir)
        .unwrap()
        .map(|entry| entry.unwrap().path())
        .find(|entry| {
            entry
                .file_name()
                .unwrap()
                .to_string_lossy()
                .starts_with("settings.json.before-restore.")
        })
        .unwrap();
    assert_eq!(fs::read(preserved).unwrap(), current);
    fs::remove_dir_all(dir).unwrap();
}

#[test]
fn prepared_restore_uses_validated_snapshot_even_if_backup_changes() {
    let dir = unique_test_dir("prepared-restore");
    let path = dir.join("settings.json");
    let first = AppSettings {
        theme: "first".into(),
        ..Default::default()
    };
    save_settings(&path, &first).unwrap();
    let second = AppSettings {
        theme: "second".into(),
        ..Default::default()
    };
    save_settings(&path, &second).unwrap();

    let prepared = prepare_settings_backup(&path).unwrap();
    fs::write(backup_path(&path), b"{ changed after validation").unwrap();
    restore_prepared_settings_backup(&path, &prepared).unwrap();

    assert_eq!(try_load_settings(&path).unwrap().theme, "first");
    fs::remove_dir_all(dir).unwrap();
}

#[test]
fn invalid_backup_cannot_replace_corrupt_primary() {
    let dir = unique_test_dir("restore-invalid-backup");
    let path = dir.join("settings.json");
    save_settings(&path, &AppSettings::default()).unwrap();
    fs::write(&path, b"{ corrupt primary").unwrap();
    fs::write(backup_path(&path), b"{ corrupt backup").unwrap();

    let status = settings_recovery_status(&path);
    assert!(status.needs_recovery);
    assert!(!status.backup_available);
    assert!(restore_settings_backup(&path).is_err());
    assert_eq!(fs::read(&path).unwrap(), b"{ corrupt primary");
    fs::remove_dir_all(dir).unwrap();
}

use super::*;

#[tokio::test]
async fn warms_non_current_nested_target_group_database() {
    let fallback_target_dir = unique_test_dir("fallback");
    let parent_dir = unique_test_dir("parent");
    let nested_dir = parent_dir.join("ZZZ");
    let settings_dir = unique_test_dir("settings");
    let settings_path = settings_dir.join("settings.json");

    fs::create_dir_all(&fallback_target_dir).unwrap();
    fs::create_dir_all(&nested_dir).unwrap();
    fs::create_dir_all(settings_path.parent().unwrap()).unwrap();
    fs::write(parent_dir.join("outside.md"), "# outside_token").unwrap();
    fs::write(nested_dir.join("inside.md"), "# nested_unique_token").unwrap();

    let settings = AppSettings {
        target_groups: vec![
            target_group("parent", vec![parent_dir.clone()]),
            target_group("nested", vec![nested_dir.clone()]),
        ],
        current_target_group_id: Some("parent".to_string()),
        ..Default::default()
    };

    save_settings(&settings_path, &settings).unwrap();

    let runtime = test_runtime(fallback_target_dir.clone(), settings_path);

    warm_non_current_active_target_group_indexes(
        settings.clone(),
        fallback_target_dir.clone(),
        runtime.engine.clone(),
        runtime.stats.clone(),
    )
    .await
    .unwrap();

    {
        let stats = runtime.stats.lock().unwrap();
        assert!(matches!(
            stats.startup_warm.status,
            StartupWarmStatus::Completed
        ));
        assert_eq!(stats.startup_warm.completed_groups, 1);
        assert_eq!(stats.startup_warm.total_groups, 1);
        assert!(stats.startup_warm.current_group_name.is_none());
    }

    let nested_settings = AppSettings {
        current_target_group_id: Some("nested".to_string()),
        ..settings
    };

    runtime.switch_database(&nested_settings).unwrap();

    let nested_results = runtime
        .engine
        .search(SearchRequest::new("nested_unique_token", 10))
        .await
        .unwrap();

    assert_eq!(nested_results.len(), 1);

    let outside_results = runtime
        .engine
        .search(SearchRequest::new("outside_token", 10))
        .await
        .unwrap();

    assert!(outside_results.is_empty());

    fs::remove_dir_all(fallback_target_dir).ok();
    fs::remove_dir_all(parent_dir).ok();
    fs::remove_dir_all(settings_dir).ok();
}

#[tokio::test]
async fn warm_non_current_active_target_group_indexes_skips_inactive_groups() {
    let fallback_target_dir = unique_test_dir("fallback");
    let work_dir = unique_test_dir("work");
    let archive_dir = unique_test_dir("archive");
    let settings_dir = unique_test_dir("settings");
    let settings_path = settings_dir.join("settings.json");

    fs::create_dir_all(&fallback_target_dir).unwrap();
    fs::create_dir_all(&work_dir).unwrap();
    fs::create_dir_all(&archive_dir).unwrap();
    fs::create_dir_all(settings_path.parent().unwrap()).unwrap();
    fs::write(archive_dir.join("archive.md"), "# inactive_archive_token").unwrap();

    let mut archive = target_group("archive", vec![archive_dir.clone()]);
    archive.active = false;

    let settings = AppSettings {
        target_groups: vec![target_group("work", vec![work_dir.clone()]), archive],
        current_target_group_id: Some("work".to_string()),
        ..Default::default()
    };

    save_settings(&settings_path, &settings).unwrap();

    let runtime = test_runtime(fallback_target_dir.clone(), settings_path);

    warm_non_current_active_target_group_indexes(
        settings.clone(),
        fallback_target_dir.clone(),
        runtime.engine.clone(),
        runtime.stats.clone(),
    )
    .await
    .unwrap();

    {
        let stats = runtime.stats.lock().unwrap();
        assert!(matches!(stats.startup_warm.status, StartupWarmStatus::Idle));
        assert_eq!(stats.startup_warm.total_groups, 0);
    }

    let archive_settings = AppSettings {
        current_target_group_id: Some("archive".to_string()),
        ..settings
    };

    runtime.switch_database(&archive_settings).unwrap();

    let archive_results = runtime
        .engine
        .search(SearchRequest::new("inactive_archive_token", 10))
        .await
        .unwrap();

    assert!(archive_results.is_empty());

    fs::remove_dir_all(fallback_target_dir).ok();
    fs::remove_dir_all(work_dir).ok();
    fs::remove_dir_all(archive_dir).ok();
    fs::remove_dir_all(settings_dir).ok();
}

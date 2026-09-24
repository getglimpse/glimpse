use super::*;

#[tokio::test]
async fn switch_next_target_group_skips_inactive_groups() {
    let fallback_target_dir = unique_test_dir("fallback");
    let work_dir = unique_test_dir("work");
    let personal_dir = unique_test_dir("personal");
    let archive_dir = unique_test_dir("archive");
    let settings_dir = unique_test_dir("settings");
    let settings_path = settings_dir.join("settings.json");

    fs::create_dir_all(&fallback_target_dir).unwrap();
    fs::create_dir_all(&work_dir).unwrap();
    fs::create_dir_all(&personal_dir).unwrap();
    fs::create_dir_all(&archive_dir).unwrap();
    fs::create_dir_all(settings_path.parent().unwrap()).unwrap();

    let mut personal = target_group("personal", vec![personal_dir.clone()]);
    personal.active = false;

    let settings = AppSettings {
        target_groups: vec![
            target_group("work", vec![work_dir.clone()]),
            personal,
            target_group("archive", vec![archive_dir.clone()]),
        ],
        current_target_group_id: Some("work".to_string()),
        ..Default::default()
    };

    save_settings(&settings_path, &settings).unwrap();

    let runtime = test_runtime(fallback_target_dir.clone(), settings_path);
    let settings = runtime.switch_next_target_group().await.unwrap();

    assert_eq!(
        settings.current_target_group_id,
        Some("archive".to_string())
    );

    fs::remove_dir_all(fallback_target_dir).ok();
    fs::remove_dir_all(work_dir).ok();
    fs::remove_dir_all(personal_dir).ok();
    fs::remove_dir_all(archive_dir).ok();
    fs::remove_dir_all(settings_dir).ok();
}

#[tokio::test]
async fn switch_next_target_group_waits_for_foreground_index_work() {
    let fallback_target_dir = unique_test_dir("fallback");
    let work_dir = unique_test_dir("work");
    let archive_dir = unique_test_dir("archive");
    let settings_dir = unique_test_dir("settings");
    let settings_path = settings_dir.join("settings.json");

    fs::create_dir_all(&fallback_target_dir).unwrap();
    fs::create_dir_all(&work_dir).unwrap();
    fs::create_dir_all(&archive_dir).unwrap();
    fs::create_dir_all(settings_path.parent().unwrap()).unwrap();

    let settings = AppSettings {
        target_groups: vec![
            target_group("work", vec![work_dir.clone()]),
            target_group("archive", vec![archive_dir.clone()]),
        ],
        current_target_group_id: Some("work".to_string()),
        ..Default::default()
    };

    save_settings(&settings_path, &settings).unwrap();

    let runtime = Arc::new(test_runtime(fallback_target_dir.clone(), settings_path));
    let foreground_guard = runtime.foreground_index_work.lock().await;
    let switching_runtime = runtime.clone();

    let switch_task =
        tokio::spawn(async move { switching_runtime.switch_next_target_group().await });

    tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    assert!(
        !switch_task.is_finished(),
        "target switch should wait while foreground index work is active"
    );

    drop(foreground_guard);

    let settings = switch_task.await.unwrap().unwrap();

    assert_eq!(
        settings.current_target_group_id,
        Some("archive".to_string())
    );

    fs::remove_dir_all(fallback_target_dir).ok();
    fs::remove_dir_all(work_dir).ok();
    fs::remove_dir_all(archive_dir).ok();
    fs::remove_dir_all(settings_dir).ok();
}

#[tokio::test]
async fn switch_next_target_group_aborts_manual_full_scan_task() {
    let fallback_target_dir = unique_test_dir("fallback");
    let work_dir = unique_test_dir("work");
    let archive_dir = unique_test_dir("archive");
    let settings_dir = unique_test_dir("settings");
    let settings_path = settings_dir.join("settings.json");

    fs::create_dir_all(&fallback_target_dir).unwrap();
    fs::create_dir_all(&work_dir).unwrap();
    fs::create_dir_all(&archive_dir).unwrap();
    fs::create_dir_all(settings_path.parent().unwrap()).unwrap();

    let settings = AppSettings {
        target_groups: vec![
            target_group("work", vec![work_dir.clone()]),
            target_group("archive", vec![archive_dir.clone()]),
        ],
        current_target_group_id: Some("work".to_string()),
        ..Default::default()
    };

    save_settings(&settings_path, &settings).unwrap();

    let runtime = test_runtime(fallback_target_dir.clone(), settings_path);
    let task_id = uuid::Uuid::new_v4();
    let scan_task = tokio::spawn(async {
        tokio::time::sleep(std::time::Duration::from_secs(60)).await;
    });
    let abort_handle = scan_task.abort_handle();

    {
        let mut slot = runtime.manual_full_scan_task.lock().unwrap();
        *slot = Some((task_id, abort_handle));
    }

    let settings = tokio::time::timeout(
        std::time::Duration::from_secs(2),
        runtime.switch_next_target_group(),
    )
    .await
    .expect("target switch should not wait for manual full scan")
    .unwrap();

    assert_eq!(
        settings.current_target_group_id,
        Some("archive".to_string())
    );
    assert!(scan_task.await.unwrap_err().is_cancelled());
    assert!(runtime.manual_full_scan_task.lock().unwrap().is_none());

    fs::remove_dir_all(fallback_target_dir).ok();
    fs::remove_dir_all(work_dir).ok();
    fs::remove_dir_all(archive_dir).ok();
    fs::remove_dir_all(settings_dir).ok();
}

#[tokio::test]
async fn switch_next_target_group_errors_when_no_other_active_group_exists() {
    let fallback_target_dir = unique_test_dir("fallback");
    let work_dir = unique_test_dir("work");
    let archive_dir = unique_test_dir("archive");
    let settings_dir = unique_test_dir("settings");
    let settings_path = settings_dir.join("settings.json");

    fs::create_dir_all(&fallback_target_dir).unwrap();
    fs::create_dir_all(&work_dir).unwrap();
    fs::create_dir_all(&archive_dir).unwrap();
    fs::create_dir_all(settings_path.parent().unwrap()).unwrap();

    let mut archive = target_group("archive", vec![archive_dir.clone()]);
    archive.active = false;

    let settings = AppSettings {
        target_groups: vec![target_group("work", vec![work_dir.clone()]), archive],
        current_target_group_id: Some("work".to_string()),
        ..Default::default()
    };

    save_settings(&settings_path, &settings).unwrap();

    let runtime = test_runtime(fallback_target_dir.clone(), settings_path);
    let error = runtime.switch_next_target_group().await.unwrap_err();

    assert_eq!(error, "no other active target groups available");

    fs::remove_dir_all(fallback_target_dir).ok();
    fs::remove_dir_all(work_dir).ok();
    fs::remove_dir_all(archive_dir).ok();
    fs::remove_dir_all(settings_dir).ok();
}

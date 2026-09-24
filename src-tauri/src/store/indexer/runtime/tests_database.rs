use super::*;

#[test]
fn db_path_for_target_dir_creates_glimpse_dir() {
    let target_dir = unique_test_dir("target");

    fs::create_dir_all(&target_dir).unwrap();

    let db_path = db_path_for_target_dir(&target_dir).unwrap();

    assert_eq!(db_path, target_dir.join(".glimpse").join("index.db"));
    assert!(target_dir.join(".glimpse").is_dir());

    fs::remove_dir_all(target_dir).ok();
}

#[test]
fn settings_path_returns_cloned_path() {
    let target_dir = unique_test_dir("target");
    let settings_path = unique_test_dir("settings").join("settings.json");

    fs::create_dir_all(&target_dir).unwrap();
    fs::create_dir_all(settings_path.parent().unwrap()).unwrap();

    let runtime = test_runtime(target_dir.clone(), settings_path.clone());

    assert_eq!(runtime.settings_path().unwrap(), settings_path);

    fs::remove_dir_all(target_dir).ok();
    fs::remove_dir_all(settings_path.parent().unwrap()).ok();
}

#[test]
fn cached_global_search_engine_reuses_engine_for_same_database_path() {
    let target_dir = unique_test_dir("target");
    let settings_path = unique_test_dir("settings").join("settings.json");

    fs::create_dir_all(&target_dir).unwrap();
    fs::create_dir_all(settings_path.parent().unwrap()).unwrap();

    let runtime = test_runtime(target_dir.clone(), settings_path.clone());
    let db_path = db_path_for_target_dir(&target_dir).unwrap();

    let first = runtime.cached_global_search_engine(&db_path).unwrap();
    let second = runtime.cached_global_search_engine(&db_path).unwrap();

    assert!(first.cache_miss);
    assert!(!second.cache_miss);
    assert!(Arc::ptr_eq(&first.engine, &second.engine));

    runtime.invalidate_global_search_engine(&db_path);

    let third = runtime.cached_global_search_engine(&db_path).unwrap();

    assert!(third.cache_miss);
    assert!(!Arc::ptr_eq(&first.engine, &third.engine));

    fs::remove_dir_all(target_dir).ok();
    fs::remove_dir_all(settings_path.parent().unwrap()).ok();
}

#[test]
fn switch_database_uses_fallback_target_when_no_group_exists() {
    let fallback_target_dir = unique_test_dir("fallback");
    let settings_path = unique_test_dir("settings").join("settings.json");

    fs::create_dir_all(&fallback_target_dir).unwrap();
    fs::create_dir_all(settings_path.parent().unwrap()).unwrap();

    let runtime = test_runtime(fallback_target_dir.clone(), settings_path);

    let settings = AppSettings::default();

    runtime.switch_database(&settings).unwrap();

    assert!(fallback_target_dir
        .join(".glimpse")
        .join("index.db")
        .is_file());

    fs::remove_dir_all(fallback_target_dir).ok();
}

#[test]
fn switch_database_uses_current_target_group_primary_path() {
    let fallback_target_dir = unique_test_dir("fallback");
    let work_dir = unique_test_dir("work");
    let docs_dir = unique_test_dir("docs");
    let settings_path = unique_test_dir("settings").join("settings.json");

    fs::create_dir_all(&fallback_target_dir).unwrap();
    fs::create_dir_all(&work_dir).unwrap();
    fs::create_dir_all(&docs_dir).unwrap();
    fs::create_dir_all(settings_path.parent().unwrap()).unwrap();

    let runtime = test_runtime(fallback_target_dir.clone(), settings_path);

    let settings = AppSettings {
        target_groups: vec![target_group(
            "work",
            vec![work_dir.clone(), docs_dir.clone()],
        )],
        current_target_group_id: Some("work".to_string()),
        ..Default::default()
    };

    runtime.switch_database(&settings).unwrap();

    assert!(work_dir.join(".glimpse").join("index.db").is_file());
    assert!(!docs_dir.join(".glimpse").join("index.db").exists());

    fs::remove_dir_all(fallback_target_dir).ok();
    fs::remove_dir_all(work_dir).ok();
    fs::remove_dir_all(docs_dir).ok();
}

#[test]
fn switch_database_uses_empty_database_when_current_group_has_no_paths() {
    let fallback_target_dir = unique_test_dir("fallback");
    let settings_path = unique_test_dir("settings").join("settings.json");

    fs::create_dir_all(&fallback_target_dir).unwrap();
    fs::create_dir_all(settings_path.parent().unwrap()).unwrap();

    let runtime = test_runtime(fallback_target_dir.clone(), settings_path);
    let fallback_settings = AppSettings::default();

    runtime.switch_database(&fallback_settings).unwrap();

    {
        let conn = runtime.db.lock().unwrap();

        conn.execute("CREATE TABLE runtime_marker (value TEXT NOT NULL)", [])
            .unwrap();

        conn.execute("INSERT INTO runtime_marker (value) VALUES ('fallback')", [])
            .unwrap();
    }

    let empty_settings = AppSettings {
        target_groups: vec![target_group("empty", vec![])],
        current_target_group_id: Some("empty".to_string()),
        ..Default::default()
    };

    runtime.switch_database(&empty_settings).unwrap();

    let marker_exists_in_current_db = {
        let conn = runtime.db.lock().unwrap();

        conn.query_row("SELECT COUNT(*) FROM runtime_marker", [], |row| {
            row.get::<_, i64>(0)
        })
        .is_ok()
    };

    assert!(!marker_exists_in_current_db);

    fs::remove_dir_all(fallback_target_dir).ok();
}

#[test]
fn switch_database_replaces_current_connection() {
    let fallback_target_dir = unique_test_dir("fallback");
    let work_dir = unique_test_dir("work");
    let settings_path = unique_test_dir("settings").join("settings.json");

    fs::create_dir_all(&fallback_target_dir).unwrap();
    fs::create_dir_all(&work_dir).unwrap();
    fs::create_dir_all(settings_path.parent().unwrap()).unwrap();

    let runtime = test_runtime(fallback_target_dir.clone(), settings_path);

    let fallback_settings = AppSettings::default();

    runtime.switch_database(&fallback_settings).unwrap();

    {
        let conn = runtime.db.lock().unwrap();

        conn.execute("CREATE TABLE runtime_marker (value TEXT NOT NULL)", [])
            .unwrap();

        conn.execute("INSERT INTO runtime_marker (value) VALUES ('fallback')", [])
            .unwrap();
    }

    let work_settings = AppSettings {
        target_groups: vec![target_group("work", vec![work_dir.clone()])],
        current_target_group_id: Some("work".to_string()),
        ..Default::default()
    };

    runtime.switch_database(&work_settings).unwrap();

    let marker_exists_in_current_db = {
        let conn = runtime.db.lock().unwrap();

        conn.query_row("SELECT COUNT(*) FROM runtime_marker", [], |row| {
            row.get::<_, i64>(0)
        })
        .is_ok()
    };

    assert!(!marker_exists_in_current_db);

    assert!(fallback_target_dir
        .join(".glimpse")
        .join("index.db")
        .is_file());

    assert!(work_dir.join(".glimpse").join("index.db").is_file());

    fs::remove_dir_all(fallback_target_dir).ok();
    fs::remove_dir_all(work_dir).ok();
}

#[tokio::test]
async fn full_scan_recovers_current_database_when_search_index_is_broken() {
    let fallback_target_dir = unique_test_dir("fallback");
    let work_dir = unique_test_dir("work");
    let settings_dir = unique_test_dir("settings");
    let settings_path = settings_dir.join("settings.json");

    fs::create_dir_all(&fallback_target_dir).unwrap();
    fs::create_dir_all(&work_dir).unwrap();
    fs::create_dir_all(settings_path.parent().unwrap()).unwrap();
    fs::write(work_dir.join("note.md"), "# recovery_unique_token").unwrap();

    let settings = AppSettings {
        target_groups: vec![target_group("work", vec![work_dir.clone()])],
        current_target_group_id: Some("work".to_string()),
        ..Default::default()
    };

    save_settings(&settings_path, &settings).unwrap();

    let runtime = test_runtime(fallback_target_dir.clone(), settings_path);

    runtime.switch_database(&settings).unwrap();
    runtime.full_scan().await.unwrap();

    {
        let conn = runtime.db.lock().unwrap();

        conn.execute("DROP TABLE search_index", []).unwrap();
    }

    runtime.full_scan().await.unwrap();

    let results = runtime
        .engine
        .search(SearchRequest::new("recovery_unique_token", 10))
        .await
        .unwrap();

    assert_eq!(results.len(), 1);

    fs::remove_dir_all(fallback_target_dir).ok();
    fs::remove_dir_all(work_dir).ok();
    fs::remove_dir_all(settings_dir).ok();
}

#[tokio::test]
async fn prepare_full_scan_keeps_existing_current_target_items() {
    let fallback_target_dir = unique_test_dir("fallback");
    let work_dir = unique_test_dir("work");
    let settings_dir = unique_test_dir("settings");
    let settings_path = settings_dir.join("settings.json");

    fs::create_dir_all(&fallback_target_dir).unwrap();
    fs::create_dir_all(&work_dir).unwrap();
    fs::create_dir_all(settings_path.parent().unwrap()).unwrap();

    let source_path = work_dir.join("note.md");
    fs::write(&source_path, "# Existing").unwrap();

    let settings = AppSettings {
        target_groups: vec![target_group("work", vec![work_dir.clone()])],
        current_target_group_id: Some("work".to_string()),
        ..Default::default()
    };

    save_settings(&settings_path, &settings).unwrap();

    let runtime = test_runtime(fallback_target_dir.clone(), settings_path);
    runtime.switch_database(&settings).unwrap();

    runtime
        .engine
        .upsert(
            IndexItem::new(
                "work/0/note.md",
                "Existing Item",
                Utc::now(),
                Preview::Markdown {
                    content: "keep_existing_token".to_string(),
                },
            )
            .with_source_path(source_path.to_string_lossy().to_string()),
        )
        .await
        .unwrap();

    runtime
        .prepare_indexer_for_full_scan(settings, "test full scan prepare")
        .await
        .unwrap();

    let results = runtime
        .engine
        .search(SearchRequest::new("keep_existing_token", 10))
        .await
        .unwrap();

    assert_eq!(results.len(), 1);

    fs::remove_dir_all(fallback_target_dir).ok();
    fs::remove_dir_all(work_dir).ok();
    fs::remove_dir_all(settings_dir).ok();
}

use super::*;

#[tokio::test]
async fn global_search_preserves_snippets_after_merge() {
    let fallback_target_dir = unique_test_dir("fallback");
    let work_dir = unique_test_dir("work");
    let settings_dir = unique_test_dir("settings");
    let settings_path = settings_dir.join("settings.json");

    fs::create_dir_all(&fallback_target_dir).unwrap();
    fs::create_dir_all(&work_dir).unwrap();
    fs::create_dir_all(settings_path.parent().unwrap()).unwrap();

    let settings = AppSettings {
        target_groups: vec![target_group("work", vec![work_dir.clone()])],
        current_target_group_id: Some("work".to_string()),
        ..Default::default()
    };

    save_settings(&settings_path, &settings).unwrap();

    let db_path = db_path_for_target_dir(&work_dir).unwrap();
    let connection = init_db(&db_path).unwrap();
    let engine = ActiveSearchEngine::new(
        Arc::new(Mutex::new(connection)),
        tantivy_index_path_for_db_path(&db_path),
    )
    .unwrap();

    engine
        .upsert(IndexItem::new(
            "item-1",
            "Global Snippet",
            Utc::now(),
            Preview::Markdown {
                content: "global_snippet_token body".to_string(),
            },
        ))
        .await
        .unwrap();

    drop(engine);

    let runtime = test_runtime(fallback_target_dir.clone(), settings_path);
    let results = runtime
        .search_global(SearchRequest::new("global_snippet_token", 10).global(true))
        .await
        .unwrap();

    assert_eq!(results.len(), 1);
    assert!(results[0].snippets.is_some());

    fs::remove_dir_all(fallback_target_dir).ok();
    fs::remove_dir_all(work_dir).ok();
    fs::remove_dir_all(settings_dir).ok();
}

#[tokio::test]
async fn global_search_records_load_stats_for_cold_and_cached_targets() {
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

    for (index, target_dir) in [&work_dir, &archive_dir].into_iter().enumerate() {
        let db_path = db_path_for_target_dir(target_dir).unwrap();
        let connection = init_db(&db_path).unwrap();
        let engine = ActiveSearchEngine::new(
            Arc::new(Mutex::new(connection)),
            tantivy_index_path_for_db_path(&db_path),
        )
        .unwrap();

        engine
            .upsert(IndexItem::new(
                format!("item-{index}"),
                format!("Load Stats {index}"),
                Utc::now(),
                Preview::Markdown {
                    content: "global_load_token body".to_string(),
                },
            ))
            .await
            .unwrap();
    }

    let runtime = test_runtime(fallback_target_dir.clone(), settings_path);

    let results = runtime
        .search_global(SearchRequest::new("global_load_token", 10).global(true))
        .await
        .unwrap();

    assert_eq!(results.len(), 2);

    {
        let stats = runtime.stats.lock().unwrap();
        assert_eq!(stats.global_search_load.last_target_database_count, 2);
        assert_eq!(stats.global_search_load.last_cache_miss_count, 2);
        assert_eq!(stats.global_search_load.cached_engine_count, 2);
        assert_eq!(stats.global_search_load.sqlite_connection_count, 2);
        assert_eq!(stats.global_search_load.tantivy_reader_count, 2);
        assert_eq!(stats.global_search_load.last_result_count, 2);
        assert!(stats.global_search_load.updated_at.is_some());
    }

    runtime
        .search_global(SearchRequest::new("global_load_token", 10).global(true))
        .await
        .unwrap();

    {
        let stats = runtime.stats.lock().unwrap();
        assert_eq!(stats.global_search_load.last_cache_miss_count, 0);
        assert_eq!(stats.global_search_load.cached_engine_count, 2);
        assert_eq!(stats.global_search_load.sqlite_connection_count, 2);
        assert_eq!(stats.global_search_load.tantivy_reader_count, 2);
    }

    fs::remove_dir_all(fallback_target_dir).ok();
    fs::remove_dir_all(work_dir).ok();
    fs::remove_dir_all(archive_dir).ok();
    fs::remove_dir_all(settings_dir).ok();
}

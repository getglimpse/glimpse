//! Search across target group databases and maintain the engine cache.

use super::*;

impl IndexerRuntime {
    /// Searches all target group databases.
    ///
    /// Unlike normal search, which queries only the current database,
    /// global search opens each target group's primary database and merges
    /// the results.
    ///
    /// Results are sorted by score descending and truncated to the request
    /// limit after merging, or by score ascending when reverse ordering is
    /// requested.
    pub async fn search_global(
        &self,
        req: SearchRequest,
    ) -> Result<Vec<SearchResult>, SearchError> {
        let started_at = Instant::now();
        debug!(
            query = %req.query,
            limit = req.limit,
            reverse_order = req.reverse_order,
            "global search started"
        );

        let settings = self.load_settings().map_err(SearchError::DbError)?;

        let db_paths = self.global_db_paths(&settings)?;

        debug!(
            db_count = db_paths.len(),
            "global search database paths resolved"
        );

        let mut results = Vec::new();
        let target_database_count = db_paths.len();
        let mut cache_miss_count = 0;
        let mut cold_open_latency = Duration::ZERO;

        for db_path in db_paths {
            debug!(
                db_path = %db_path.display(),
                "searching target group database"
            );

            let lookup = self.cached_global_search_engine(&db_path)?;
            if lookup.cache_miss {
                cache_miss_count += 1;
                cold_open_latency += lookup.open_latency;
            }
            lookup.engine.reload_index()?;

            let mut group_results = lookup.engine.search(req.clone()).await?;

            debug!(
                db_path = %db_path.display(),
                count = group_results.len(),
                "target group database search completed"
            );

            results.append(&mut group_results);
        }

        let empty_query = req.query.trim().is_empty();

        results.sort_by(|a, b| {
            let ordering = if empty_query {
                a.item
                    .metadata
                    .star
                    .cmp(&b.item.metadata.star)
                    .then_with(|| a.item.updated_at.cmp(&b.item.updated_at))
            } else {
                a.score
                    .partial_cmp(&b.score)
                    .unwrap_or(std::cmp::Ordering::Equal)
            };

            if req.reverse_order {
                ordering
            } else {
                ordering.reverse()
            }
        });

        results.truncate(req.limit);

        self.record_global_search_load(
            target_database_count,
            cache_miss_count,
            started_at.elapsed(),
            cold_open_latency,
            results.len(),
        );

        debug!(count = results.len(), "global search completed");

        Ok(results)
    }

    /// Returns database paths used for global search.
    pub(super) fn global_db_paths(
        &self,
        settings: &AppSettings,
    ) -> Result<Vec<PathBuf>, SearchError> {
        let target_dirs = global_primary_target_dirs(settings, self.fallback_target_dir.clone());

        debug!(
            target_dir_count = target_dirs.len(),
            "resolving global database paths"
        );

        target_dirs
            .into_iter()
            .map(|target_dir| db_path_for_target_dir(&target_dir).map_err(SearchError::DbError))
            .collect()
    }

    pub(super) fn cached_global_search_engine(
        &self,
        db_path: &Path,
    ) -> Result<GlobalSearchEngineLookup, SearchError> {
        let mut cache = self
            .global_search_engines
            .lock()
            .map_err(|error| SearchError::IndexError(error.to_string()))?;

        if let Some(engine) = cache.get(db_path) {
            debug!(
                db_path = %db_path.display(),
                "global search engine cache hit"
            );

            return Ok(GlobalSearchEngineLookup {
                engine: engine.clone(),
                cache_miss: false,
                open_latency: Duration::ZERO,
            });
        }

        debug!(
            db_path = %db_path.display(),
            "global search engine cache miss"
        );

        let started_at = Instant::now();
        let connection = init_db(db_path).map_err(|error| {
            error!(
                db_path = %db_path.display(),
                error = %error,
                "failed to initialize database for global search"
            );
            SearchError::DbError(error.to_string())
        })?;

        let db = Arc::new(Mutex::new(connection));
        let engine = Arc::new(ActiveSearchEngine::new(
            db,
            tantivy_index_path_for_db_path(db_path),
        )?);

        cache.insert(db_path.to_path_buf(), engine.clone());

        Ok(GlobalSearchEngineLookup {
            engine,
            cache_miss: true,
            open_latency: started_at.elapsed(),
        })
    }

    pub(super) fn invalidate_global_search_engine(&self, db_path: &Path) {
        match self.global_search_engines.lock() {
            Ok(mut cache) => {
                if cache.remove(db_path).is_some() {
                    debug!(
                        db_path = %db_path.display(),
                        "invalidated cached global search engine"
                    );
                }
            }
            Err(error) => {
                warn!(
                    error = %error,
                    "failed to lock global search engine cache for invalidation"
                );
            }
        }

        self.refresh_global_search_load_cache_counts();
    }

    pub(super) fn clear_global_search_engine_cache(&self) {
        match self.global_search_engines.lock() {
            Ok(mut cache) => {
                let count = cache.len();
                cache.clear();
                debug!(count, "cleared global search engine cache");
            }
            Err(error) => {
                warn!(
                    error = %error,
                    "failed to lock global search engine cache for clearing"
                );
            }
        }

        self.refresh_global_search_load_cache_counts();
    }

    pub(super) fn record_global_search_load(
        &self,
        target_database_count: usize,
        cache_miss_count: usize,
        search_latency: Duration,
        cold_open_latency: Duration,
        result_count: usize,
    ) {
        let (cached_engine_count, tantivy_reader_count, sqlite_connection_count) =
            self.global_search_cache_counts();

        self.update_global_search_load_stats(|load| {
            load.cached_engine_count = cached_engine_count;
            load.tantivy_reader_count = tantivy_reader_count;
            load.sqlite_connection_count = sqlite_connection_count;
            load.last_target_database_count = target_database_count;
            load.last_cache_miss_count = cache_miss_count;
            load.last_search_latency_ms = duration_millis_u64(search_latency);
            load.last_cold_open_latency_ms = duration_millis_u64(cold_open_latency);
            load.last_result_count = result_count;
            load.process_memory_bytes = current_process_memory_bytes();
        });
    }

    pub(super) fn refresh_global_search_load_cache_counts(&self) {
        let (cached_engine_count, tantivy_reader_count, sqlite_connection_count) =
            self.global_search_cache_counts();

        self.update_global_search_load_stats(|load| {
            load.cached_engine_count = cached_engine_count;
            load.tantivy_reader_count = tantivy_reader_count;
            load.sqlite_connection_count = sqlite_connection_count;
            load.process_memory_bytes = current_process_memory_bytes();
        });
    }

    pub(super) fn global_search_cache_counts(&self) -> (usize, usize, usize) {
        match self.global_search_engines.lock() {
            Ok(cache) => {
                let cached_engine_count = cache.len();
                let tantivy_reader_count = cache
                    .values()
                    .filter_map(|engine| engine.cached_index_count().ok())
                    .sum();
                let sqlite_connection_count = cached_engine_count;

                (
                    cached_engine_count,
                    tantivy_reader_count,
                    sqlite_connection_count,
                )
            }
            Err(error) => {
                warn!(
                    error = %error,
                    "failed to lock global search engine cache for load stats"
                );

                (0, 0, 0)
            }
        }
    }

    pub(super) fn update_global_search_load_stats(
        &self,
        update: impl FnOnce(&mut crate::models::indexing::GlobalSearchLoadStats),
    ) {
        match self.stats.lock() {
            Ok(mut stats) => {
                update(&mut stats.global_search_load);
                stats.global_search_load.updated_at = Some(chrono::Utc::now());
            }
            Err(error) => {
                warn!(
                    error = %error,
                    "failed to lock indexing stats for global search load update"
                );
            }
        }
    }
}

pub(super) struct GlobalSearchEngineLookup {
    pub(super) engine: Arc<ActiveSearchEngine>,
    pub(super) cache_miss: bool,
    pub(super) open_latency: Duration,
}

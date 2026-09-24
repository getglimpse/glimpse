use super::*;

use crate::test_utils::fixtures::unique_test_path;
use std::fs;

use crate::models::settings::{AppSettings, TargetGroup};
use crate::models::{IndexItem, Preview};
use crate::search::{ActiveSearchEngine, SearchEngine, SearchRequest};
use crate::store::settings::save_settings;
use chrono::Utc;

fn unique_test_dir(name: &str) -> PathBuf {
    unique_test_path("glimpse_runtime_test_", &format!("_{name}"))
}

fn target_group(id: &str, paths: Vec<PathBuf>) -> TargetGroup {
    TargetGroup {
        id: id.to_string(),
        name: id.to_string(),
        paths: paths
            .into_iter()
            .map(|path| path.to_string_lossy().to_string())
            .collect(),
        active: true,
    }
}

fn test_runtime(fallback_target_dir: PathBuf, settings_path: PathBuf) -> IndexerRuntime {
    let initial_db_path = fallback_target_dir.join(".glimpse").join("index.db");

    if let Some(parent) = initial_db_path.parent() {
        fs::create_dir_all(parent).unwrap();
    }

    let connection = init_db(&initial_db_path).unwrap();
    let db = Arc::new(Mutex::new(connection));
    let engine = Arc::new(
        ActiveSearchEngine::new(
            db.clone(),
            fallback_target_dir.join(".glimpse").join("tantivy"),
        )
        .unwrap(),
    );

    IndexerRuntime::new(
        engine,
        db,
        fallback_target_dir,
        Arc::new(Mutex::new(settings_path)),
    )
}

#[path = "tests_database.rs"]
mod database;
#[path = "tests_global_search.rs"]
mod global_search;
#[path = "tests_migration.rs"]
mod migration;
#[path = "tests_switch.rs"]
mod switch;
#[path = "tests_warm.rs"]
mod warm;

use super::*;

use std::fs;

use crate::models::settings::{AppSettings, TargetGroup};
use crate::store::settings::save_settings;

fn unique_test_dir(name: &str) -> PathBuf {
    let unique = uuid::Uuid::new_v4();
    std::env::temp_dir().join(format!("glimpse_file_test_{unique}_{name}"))
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

fn write_settings(settings_path: &Path, target_dir: &Path) {
    let settings = AppSettings {
        target_groups: vec![target_group("default", vec![target_dir.to_path_buf()])],
        current_target_group_id: Some("default".to_string()),
        ..Default::default()
    };

    save_settings(settings_path, &settings).unwrap();
}

fn write_settings_with_groups(settings_path: &Path, groups: Vec<TargetGroup>, current_id: &str) {
    let settings = AppSettings {
        target_groups: groups,
        current_target_group_id: Some(current_id.to_string()),
        ..Default::default()
    };

    save_settings(settings_path, &settings).unwrap();
}

fn assert_same_path(left: impl AsRef<Path>, right: impl AsRef<Path>) {
    let left = left.as_ref().canonicalize().unwrap();
    let right = right.as_ref().canonicalize().unwrap();

    assert_eq!(left, right);
}

#[path = "tests_create.rs"]
mod create;
#[path = "tests_read.rs"]
mod read;
#[path = "tests_write.rs"]
mod write;

use super::*;

use crate::models::settings::{AppSettings, KeybindingValue, TargetGroup};
use crate::test_utils::fixtures::unique_test_path;

fn unique_test_dir(name: &str) -> std::path::PathBuf {
    unique_test_path("glimpse_settings_test_", &format!("_{name}"))
}

#[path = "tests_normalization.rs"]
mod normalization;
#[path = "tests_persistence.rs"]
mod persistence;

use super::*;

use crate::models::settings::{AppSettings, KeybindingValue, TargetGroup};
use std::time::{SystemTime, UNIX_EPOCH};

fn unique_test_dir(name: &str) -> std::path::PathBuf {
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();

    std::env::temp_dir().join(format!("glimpse_settings_test_{unique}_{name}"))
}

#[path = "tests_normalization.rs"]
mod normalization;
#[path = "tests_persistence.rs"]
mod persistence;

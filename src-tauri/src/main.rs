//! Desktop application entrypoint.
//!
//! The actual application bootstrap lives in `lib.rs`.
//! This file only forwards execution to `glimpse_lib::run()`.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tracing_subscriber::{fmt, EnvFilter};

fn init_logging() {
    fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .init();
}

fn main() {
    init_logging();
    glimpse_lib::run()
}

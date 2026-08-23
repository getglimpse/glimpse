//! About information IPC commands.
//!
//! This module exposes basic application metadata to the frontend.
//!
//! Provided information:
//!
//! - application version
//! - build type (`debug` / `release`)
//! - software license
//!
//! The returned values are intended for:
//!
//! - About page
//! - Debug page
//! - Issue reports
//! - User support

use serde::Serialize;

/// Basic application metadata.
///
/// This structure is serialized and returned to the frontend.
///
/// Field naming uses `camelCase` to match the TypeScript API types.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AboutInfo {
    /// Application version.
    ///
    /// Derived from `Cargo.toml`:
    ///
    /// ```text
    /// CARGO_PKG_VERSION
    /// ```
    pub version: String,

    /// Current build profile.
    ///
    /// Possible values:
    ///
    /// - `debug`
    /// - `release`
    pub build: String,

    /// Application license identifier.
    ///
    /// Current value:
    ///
    /// ```text
    /// MIT
    /// ```
    pub license: String,
}

/// Returns application metadata.
///
/// This IPC command is typically called when:
///
/// - opening the About page
/// - displaying version information
/// - collecting debug information
///
/// The returned information is generated at compile time where possible.
///
/// # Returns
///
/// [`AboutInfo`] containing:
///
/// - version
/// - build profile
/// - license
#[tauri::command]
pub fn get_about_info() -> AboutInfo {
    AboutInfo {
        version: env!("CARGO_PKG_VERSION").to_string(),

        build: if cfg!(debug_assertions) {
            "debug".to_string()
        } else {
            "release".to_string()
        },

        license: "MIT".to_string(),
    }
}

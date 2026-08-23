//! Realtime settings file watcher.
//!
//! This module watches `settings.json` and notifies the frontend when the file
//! changes.
//!
//! Responsibilities:
//!
//! - Watch the directory containing `settings.json`.
//! - Detect changes to `settings.json`.
//! - Debounce rapid editor save events.
//! - Emit `settings-changed` to the frontend.
//!
//! This watcher is intentionally separate from the indexer watcher because
//! settings changes are application configuration events, not indexing events.

use std::path::{Path, PathBuf};
use std::time::Duration;

use notify_debouncer_full::{new_debouncer, notify::RecursiveMode, DebounceEventResult};
use tauri::{async_runtime, AppHandle, Emitter};
use tokio::sync::mpsc;
use tracing::{debug, error, info, warn};

/// Frontend event emitted when `settings.json` changes.
pub const SETTINGS_CHANGED_EVENT: &str = "settings-changed";

/// Starts watching `settings.json`.
///
/// The returned task must be kept alive by the caller.
///
/// This watches the parent directory non-recursively because many editors save
/// files by replacing them atomically, which may produce events on temporary
/// files or the parent directory rather than only on the original file path.
pub fn start_settings_watch(
    app_handle: AppHandle,
    settings_path: PathBuf,
) -> Option<async_runtime::JoinHandle<()>> {
    let settings_dir = settings_path.parent()?.to_path_buf();

    debug!(
        settings_path = %settings_path.display(),
        settings_dir = %settings_dir.display(),
        "starting settings watcher"
    );

    let (tx, mut rx) = mpsc::channel(100);

    let mut debouncer = match new_debouncer(
        Duration::from_millis(300),
        None,
        move |res: DebounceEventResult| match res {
            Ok(events) => {
                let _ = tx.blocking_send(events);
            }
            Err(errors) => {
                warn!(
                    count = errors.len(),
                    errors = ?errors,
                    "settings watcher debounce error"
                );
            }
        },
    ) {
        Ok(debouncer) => debouncer,
        Err(error) => {
            error!(
                error = %error,
                "failed to initialize settings watcher"
            );
            return None;
        }
    };

    if let Err(error) = debouncer.watch(&settings_dir, RecursiveMode::NonRecursive) {
        error!(
            settings_dir = %settings_dir.display(),
            error = %error,
            "failed to watch settings directory"
        );
        return None;
    }

    info!(
        settings_path = %settings_path.display(),
        "settings watcher started"
    );

    Some(async_runtime::spawn(async move {
        let _keep_debouncer_alive = debouncer;

        while let Some(events) = rx.recv().await {
            debug!(
                event_count = events.len(),
                "received filesystem events for settings watcher"
            );

            let changed = events.iter().any(|event| {
                event
                    .event
                    .paths
                    .iter()
                    .any(|path| is_settings_path(path, &settings_path))
            });

            if changed {
                info!(
                    settings_path = %settings_path.display(),
                    "settings file changed"
                );

                if let Err(error) = app_handle.emit(SETTINGS_CHANGED_EVENT, {}) {
                    warn!(
                        error = %error,
                        "failed to emit settings-changed event"
                    );
                } else {
                    debug!("settings-changed event emitted");
                }
            }
        }

        debug!("settings watcher stopped");
    }))
}

/// Returns true if the path points to the watched settings file.
fn is_settings_path(path: &Path, settings_path: &Path) -> bool {
    path == settings_path || path.file_name().is_some_and(|name| name == "settings.json")
}

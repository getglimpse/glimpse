use std::sync::Arc;

use crate::models::Preview;
use crate::search::ActiveSearchEngine;

#[tauri::command]
pub async fn get_preview(
    id: String,
    engine: tauri::State<'_, Arc<ActiveSearchEngine>>,
) -> Result<Option<Preview>, String> {
    engine.get_preview(&id).await.map_err(|e| e.to_string())
}

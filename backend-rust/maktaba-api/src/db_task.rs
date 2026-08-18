//! Runs a blocking rusqlite closure against the currently open library's database, off the async
//! runtime (spawn_blocking) since rusqlite is synchronous. Also reproduces Program.cs's
//! "library must be open" + "transparently rebuild + rescan a stale metadata.db" middleware:
//! every call here first verifies the schema (cheap after the first call per opened library,
//! thanks to LibraryService's internal cache) and triggers a rescan if it had to rebuild.

use std::path::PathBuf;

use maktaba_data::db;

use crate::error::ApiError;
use crate::state::AppState;

pub async fn with_conn<F, T>(state: &AppState, f: F) -> Result<T, ApiError>
where
    F: FnOnce(&mut rusqlite::Connection) -> anyhow::Result<T> + Send + 'static,
    T: Send + 'static,
{
    let db_path = ensure_ready_path(state).await?;

    tokio::task::spawn_blocking(move || -> Result<T, ApiError> {
        let mut conn = db::open_connection(&db_path)?;
        f(&mut conn).map_err(ApiError::from)
    })
    .await
    .map_err(|e| ApiError::Internal(e.into()))?
}

/// Ensures a library is open and its schema is current (rebuilding + rescanning it if not),
/// returning the database path to use. `ApiError::LibraryNotOpen` if no library is open. Exposed
/// (not just used internally by `with_conn`) for handlers like import whose service function has
/// its own non-anyhow error type and so can't go through `with_conn`'s generic closure.
pub async fn ensure_ready_path(state: &AppState) -> Result<PathBuf, ApiError> {
    let library_service = state.library_service.clone();
    let extractors = state.extractors.clone();
    let rescan_tracker = state.rescan_tracker.clone();

    tokio::task::spawn_blocking(move || -> Result<PathBuf, ApiError> {
        let rebuilt = library_service.ensure_current_schema().map_err(ApiError::Internal)?;

        let db_path = library_service.database_path().ok_or(ApiError::LibraryNotOpen)?;
        let library_root = library_service.library_root_path().ok_or(ApiError::LibraryNotOpen)?;

        if rebuilt {
            let mut conn = db::open_connection(&db_path).map_err(ApiError::Internal)?;
            maktaba_data::services::rescan::rescan(&mut conn, &library_root, &extractors, &rescan_tracker)
                .map_err(ApiError::Internal)?;
        }

        Ok(db_path)
    })
    .await
    .map_err(|e| ApiError::Internal(e.into()))?
}

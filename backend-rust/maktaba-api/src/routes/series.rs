//! Mirrors Maktaba.Api/Endpoints/SeriesEndpoints.cs.

use axum::extract::{Path, State};
use axum::routing::put;
use axum::{Json, Router};
use maktaba_core::ids;
use rusqlite::OptionalExtension;

use crate::db_task::with_conn;
use crate::dtos::{BrowseGroupDto, RenameSeriesRequestDto};
use crate::error::ApiError;
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new().route("/api/series/:id/name", put(rename))
}

async fn rename(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(request): Json<RenameSeriesRequestDto>,
) -> Result<Json<BrowseGroupDto>, ApiError> {
    let name = request.name.as_deref().map(str::trim).unwrap_or("").to_string();
    if name.is_empty() {
        return Err(ApiError::BadRequest("Name is required.".to_string()));
    }
    let Some(series_id) = ids::try_decode(&id) else { return Err(ApiError::NotFound) };

    let result = with_conn(&state, move |conn| {
        let exists: bool =
            conn.query_row("SELECT 1 FROM series WHERE id = ?1", [series_id], |_| Ok(true)).optional()?.unwrap_or(false);
        if !exists {
            return Ok(None);
        }

        let collision: bool = conn
            .query_row("SELECT 1 FROM series WHERE id != ?1 AND LOWER(name) = LOWER(?2)", rusqlite::params![series_id, name], |_| Ok(true))
            .optional()?
            .unwrap_or(false);
        if collision {
            return Ok(Some(Err(())));
        }

        conn.execute("UPDATE series SET name = ?1 WHERE id = ?2", rusqlite::params![name, series_id])?;
        let count: i64 = conn.query_row("SELECT COUNT(*) FROM book_series WHERE series_id = ?1", [series_id], |r| r.get(0))?;
        Ok(Some(Ok((name.clone(), count))))
    })
    .await?;

    match result {
        None => Err(ApiError::NotFound),
        Some(Err(())) => Err(ApiError::Conflict(format!("A series named \"{}\" already exists.", request.name.unwrap_or_default()))),
        Some(Ok((name, count))) => Ok(Json(BrowseGroupDto { id: ids::encode(series_id), name, book_count: count })),
    }
}

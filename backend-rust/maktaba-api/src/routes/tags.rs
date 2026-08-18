//! Mirrors Maktaba.Api/Endpoints/TagEndpoints.cs.

use axum::extract::{Path, State};
use axum::routing::put;
use axum::{Json, Router};
use maktaba_core::ids;
use rusqlite::OptionalExtension;

use crate::db_task::with_conn;
use crate::dtos::{BrowseGroupDto, RenameTagRequestDto};
use crate::error::ApiError;
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new().route("/api/tags/:id/name", put(rename))
}

async fn rename(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(request): Json<RenameTagRequestDto>,
) -> Result<Json<BrowseGroupDto>, ApiError> {
    let name = request.name.as_deref().map(str::trim).unwrap_or("").to_string();
    if name.is_empty() {
        return Err(ApiError::BadRequest("Name is required.".to_string()));
    }
    let Some(tag_id) = ids::try_decode(&id) else { return Err(ApiError::NotFound) };

    let result = with_conn(&state, move |conn| {
        let exists: bool = conn.query_row("SELECT 1 FROM tags WHERE id = ?1", [tag_id], |_| Ok(true)).optional()?.unwrap_or(false);
        if !exists {
            return Ok(None);
        }

        let collision: bool = conn
            .query_row("SELECT 1 FROM tags WHERE id != ?1 AND LOWER(name) = LOWER(?2)", rusqlite::params![tag_id, name], |_| Ok(true))
            .optional()?
            .unwrap_or(false);
        if collision {
            return Ok(Some(Err(())));
        }

        conn.execute("UPDATE tags SET name = ?1 WHERE id = ?2", rusqlite::params![name, tag_id])?;
        let count: i64 = conn.query_row("SELECT COUNT(*) FROM book_tags WHERE tag_id = ?1", [tag_id], |r| r.get(0))?;
        Ok(Some(Ok((name.clone(), count))))
    })
    .await?;

    match result {
        None => Err(ApiError::NotFound),
        Some(Err(())) => Err(ApiError::Conflict(format!("A tag named \"{}\" already exists.", request.name.unwrap_or_default()))),
        Some(Ok((name, count))) => Ok(Json(BrowseGroupDto { id: ids::encode(tag_id), name, book_count: count })),
    }
}

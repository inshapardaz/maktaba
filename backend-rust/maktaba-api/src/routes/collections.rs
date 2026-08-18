//! Mirrors Maktaba.Api/Endpoints/CollectionEndpoints.cs.

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::{Json, Router};
use maktaba_core::ids;
use rusqlite::OptionalExtension;

use crate::db_task::with_conn;
use crate::dtos::{BrowseGroupDto, CreateCollectionRequestDto};
use crate::error::ApiError;
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/collections", get(list).post(create))
        .route("/api/collections/:id", axum::routing::delete(delete))
}

async fn list(State(state): State<AppState>) -> Result<Json<Vec<BrowseGroupDto>>, ApiError> {
    let rows = with_conn(&state, |conn| maktaba_data::repo::browse::collections(conn)).await?;
    Ok(Json(rows.into_iter().map(|r| BrowseGroupDto { id: ids::encode(r.id), name: r.name, book_count: r.count }).collect()))
}

async fn create(State(state): State<AppState>, Json(request): Json<CreateCollectionRequestDto>) -> Result<Response, ApiError> {
    let name = request.name.as_deref().map(str::trim).unwrap_or("").to_string();
    if name.is_empty() {
        return Err(ApiError::BadRequest("Name is required.".to_string()));
    }

    let dto = with_conn(&state, move |conn| {
        let existing: Option<(i64, String, i64)> = conn
            .query_row(
                "SELECT c.id, c.name, (SELECT COUNT(*) FROM book_collections bc WHERE bc.collection_id = c.id)
                 FROM collections c WHERE LOWER(c.name) = LOWER(?1)",
                [&name],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .optional()?;

        if let Some((id, name, count)) = existing {
            return Ok((BrowseGroupDto { id: ids::encode(id), name, book_count: count }, false));
        }

        conn.execute("INSERT INTO collections(name) VALUES (?1)", [&name])?;
        let id = conn.last_insert_rowid();
        Ok((BrowseGroupDto { id: ids::encode(id), name, book_count: 0 }, true))
    })
    .await?;

    if dto.1 {
        Ok((StatusCode::CREATED, [(axum::http::header::LOCATION, format!("/api/collections/{}", dto.0.id))], Json(dto.0)).into_response())
    } else {
        Ok(Json(dto.0).into_response())
    }
}

async fn delete(State(state): State<AppState>, Path(id): Path<String>) -> Result<StatusCode, ApiError> {
    let Some(collection_id) = ids::try_decode(&id) else { return Err(ApiError::NotFound) };

    let deleted = with_conn(&state, move |conn| {
        let affected = conn.execute("DELETE FROM collections WHERE id = ?1", [collection_id])?;
        Ok(affected > 0)
    })
    .await?;

    if deleted {
        Ok(StatusCode::NO_CONTENT)
    } else {
        Err(ApiError::NotFound)
    }
}

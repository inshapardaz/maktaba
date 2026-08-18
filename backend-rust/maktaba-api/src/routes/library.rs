//! Mirrors Maktaba.Api/Endpoints/LibraryEndpoints.cs.

use std::collections::HashMap;

use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post, put};
use axum::{Json, Router};
use maktaba_data::services::rescan;

use crate::dtos::*;
use crate::error::ApiError;
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/libraries/current", get(current))
        .route("/api/libraries/open", post(open))
        .route("/api/libraries/rescan/progress", get(rescan_progress))
        .route("/api/libraries", get(list))
        .route("/api/libraries/:id/open", post(open_by_id))
        .route("/api/libraries/:id/name", put(rename))
        .route("/api/libraries/:id/path", put(relocate))
        .route("/api/libraries/:id", axum::routing::delete(remove))
        .route("/api/libraries/:id/resync", post(resync))
}

async fn current(State(state): State<AppState>) -> Response {
    match state.library_service.library_root_path() {
        Some(path) => Json(LibraryDto { path }).into_response(),
        None => StatusCode::NO_CONTENT.into_response(),
    }
}

async fn open(State(state): State<AppState>, Json(request): Json<OpenLibraryRequest>) -> Result<Json<LibraryDto>, ApiError> {
    if request.path.trim().is_empty() {
        return Err(ApiError::BadRequest("Path is required.".to_string()));
    }

    let service = state.library_service.clone();
    let info = tokio::task::spawn_blocking(move || service.open(&request.path))
        .await
        .map_err(|e| ApiError::Internal(e.into()))??;

    Ok(Json(LibraryDto { path: info.path }))
}

async fn rescan_progress(State(state): State<AppState>) -> Json<RescanProgressDto> {
    let snapshot = state.rescan_tracker.snapshot();
    Json(RescanProgressDto {
        is_running: snapshot.is_running,
        processed: snapshot.processed,
        total: snapshot.total,
        current_book: snapshot.current_book,
    })
}

async fn list(State(state): State<AppState>) -> Json<Vec<LibraryEntryDto>> {
    let current_id = state.library_service.current_library_id();
    let entries = state
        .library_service
        .libraries()
        .into_iter()
        .map(|l| LibraryEntryDto { is_active: Some(&l.id) == current_id.as_ref(), id: l.id, name: l.name, path: l.path })
        .collect();
    Json(entries)
}

async fn open_by_id(State(state): State<AppState>, Path(id): Path<String>) -> Result<Json<LibraryDto>, ApiError> {
    let service = state.library_service.clone();
    let info = tokio::task::spawn_blocking(move || service.open_library_by_id(&id))
        .await
        .map_err(|e| ApiError::Internal(e.into()))??;

    match info {
        Some(info) => Ok(Json(LibraryDto { path: info.path })),
        None => Err(ApiError::NotFound),
    }
}

async fn rename(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(request): Json<RenameLibraryRequestDto>,
) -> Result<Json<LibraryEntryDto>, ApiError> {
    let name = request.name.as_deref().map(str::trim).unwrap_or("").to_string();
    if name.is_empty() {
        return Err(ApiError::BadRequest("Name is required.".to_string()));
    }

    let service = state.library_service.clone();
    let entry = tokio::task::spawn_blocking(move || service.rename(&id, &name))
        .await
        .map_err(|e| ApiError::Internal(e.into()))??;

    let current_id = state.library_service.current_library_id();
    match entry {
        Some(e) => Ok(Json(LibraryEntryDto { is_active: Some(&e.id) == current_id.as_ref(), id: e.id, name: e.name, path: e.path })),
        None => Err(ApiError::NotFound),
    }
}

async fn relocate(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(request): Json<RelocateLibraryRequestDto>,
) -> Result<Json<LibraryEntryDto>, ApiError> {
    if request.path.trim().is_empty() {
        return Err(ApiError::BadRequest("Path is required.".to_string()));
    }

    let service = state.library_service.clone();
    let entry = tokio::task::spawn_blocking(move || service.relocate(&id, &request.path))
        .await
        .map_err(|e| ApiError::Internal(e.into()))??;

    let current_id = state.library_service.current_library_id();
    match entry {
        Some(e) => Ok(Json(LibraryEntryDto { is_active: Some(&e.id) == current_id.as_ref(), id: e.id, name: e.name, path: e.path })),
        None => Err(ApiError::NotFound),
    }
}

async fn remove(State(state): State<AppState>, Path(id): Path<String>) -> Result<StatusCode, ApiError> {
    let service = state.library_service.clone();
    let removed = tokio::task::spawn_blocking(move || service.remove(&id))
        .await
        .map_err(|e| ApiError::Internal(e.into()))??;

    if removed {
        Ok(StatusCode::NO_CONTENT)
    } else {
        Err(ApiError::NotFound)
    }
}

/// Switches to the given library (if it isn't already active) and rescans it in one call.
async fn resync(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Query(_query): Query<HashMap<String, String>>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let service = state.library_service.clone();
    let target_id = id.clone();

    let opened = if state.library_service.current_library_id().as_deref() != Some(id.as_str()) {
        tokio::task::spawn_blocking(move || service.open_library_by_id(&target_id))
            .await
            .map_err(|e| ApiError::Internal(e.into()))??
    } else {
        Some(maktaba_data::library_service::LibraryInfo { path: state.library_service.library_root_path().unwrap_or_default() })
    };

    if opened.is_none() {
        return Err(ApiError::NotFound);
    }

    let root = state.library_service.library_root_path().ok_or(ApiError::LibraryNotOpen)?;
    let extractors = state.extractors.clone();
    let tracker = state.rescan_tracker.clone();
    let db_path = state.library_service.database_path().ok_or(ApiError::LibraryNotOpen)?;

    let book_count = tokio::task::spawn_blocking(move || -> anyhow::Result<i64> {
        let mut conn = maktaba_data::db::open_connection(&db_path)?;
        rescan::rescan(&mut conn, &root, &extractors, &tracker)
    })
    .await
    .map_err(|e| ApiError::Internal(e.into()))??;

    Ok(Json(serde_json::json!({ "bookCount": book_count })))
}

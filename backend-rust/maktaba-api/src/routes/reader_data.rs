//! Mirrors Maktaba.Api/Endpoints/ReaderDataEndpoints.cs.

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::routing::{get, put};
use axum::{Json, Router};
use maktaba_core::ids;
use maktaba_data::repo::{books::book_exists, reader_data};

use crate::db_task::with_conn;
use crate::dtos::*;
use crate::error::ApiError;
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/books/:id/bookmarks", get(list_bookmarks))
        .route("/api/books/:id/bookmarks/:bookmark_id", put(save_bookmark).delete(delete_bookmark))
        .route("/api/books/:id/notes", get(list_notes))
        .route("/api/books/:id/notes/:note_id", put(save_note).delete(delete_note))
        .route("/api/books/:id/progress", get(get_progress).put(save_progress))
}

fn decode_book_id(id: &str) -> Result<i64, ApiError> {
    ids::try_decode(id).ok_or(ApiError::NotFound)
}

async fn list_bookmarks(State(state): State<AppState>, Path(id): Path<String>) -> Result<Json<Vec<BookmarkDto>>, ApiError> {
    let book_id = decode_book_id(&id)?;
    let rows = with_conn(&state, move |conn| reader_data::list_bookmarks(conn, book_id)).await?;
    Ok(Json(
        rows.into_iter()
            .map(|b| BookmarkDto { id: b.client_id, chapter_id: b.chapter_id, position: b.position, name: b.name, created_at: b.created_at, updated_at: b.updated_at })
            .collect(),
    ))
}

async fn save_bookmark(
    State(state): State<AppState>,
    Path((id, bookmark_id)): Path<(String, String)>,
    Json(request): Json<SaveBookmarkRequestDto>,
) -> Result<StatusCode, ApiError> {
    let book_id = decode_book_id(&id)?;

    with_conn(&state, move |conn| {
        if !book_exists(conn, book_id)? {
            anyhow::bail!(NotFoundMarker);
        }
        reader_data::upsert_bookmark(conn, book_id, &bookmark_id, &request.chapter_id, request.position, &request.name, request.created_at, request.updated_at)
    })
    .await
    .map_err(map_not_found)?;

    Ok(StatusCode::NO_CONTENT)
}

async fn delete_bookmark(State(state): State<AppState>, Path((id, bookmark_id)): Path<(String, String)>) -> Result<StatusCode, ApiError> {
    let book_id = decode_book_id(&id)?;
    let deleted = with_conn(&state, move |conn| reader_data::delete_bookmark(conn, book_id, &bookmark_id)).await?;
    if deleted { Ok(StatusCode::NO_CONTENT) } else { Err(ApiError::NotFound) }
}

async fn list_notes(State(state): State<AppState>, Path(id): Path<String>) -> Result<Json<Vec<NoteDto>>, ApiError> {
    let book_id = decode_book_id(&id)?;
    let rows = with_conn(&state, move |conn| reader_data::list_notes(conn, book_id)).await?;
    Ok(Json(
        rows.into_iter()
            .map(|n| NoteDto {
                id: n.client_id,
                chapter_id: n.chapter_id,
                start_offset: n.start_offset,
                end_offset: n.end_offset,
                text: n.text,
                comment: n.comment,
                created_at: n.created_at,
                updated_at: n.updated_at,
            })
            .collect(),
    ))
}

async fn save_note(
    State(state): State<AppState>,
    Path((id, note_id)): Path<(String, String)>,
    Json(request): Json<SaveNoteRequestDto>,
) -> Result<StatusCode, ApiError> {
    let book_id = decode_book_id(&id)?;

    with_conn(&state, move |conn| {
        if !book_exists(conn, book_id)? {
            anyhow::bail!(NotFoundMarker);
        }
        reader_data::upsert_note(
            conn, book_id, &note_id, &request.chapter_id, request.start_offset, request.end_offset,
            &request.text, request.comment.as_deref(), request.created_at, request.updated_at,
        )
    })
    .await
    .map_err(map_not_found)?;

    Ok(StatusCode::NO_CONTENT)
}

async fn delete_note(State(state): State<AppState>, Path((id, note_id)): Path<(String, String)>) -> Result<StatusCode, ApiError> {
    let book_id = decode_book_id(&id)?;
    let deleted = with_conn(&state, move |conn| reader_data::delete_note(conn, book_id, &note_id)).await?;
    if deleted { Ok(StatusCode::NO_CONTENT) } else { Err(ApiError::NotFound) }
}

async fn get_progress(State(state): State<AppState>, Path(id): Path<String>) -> Result<Json<Option<ReadingProgressDto>>, ApiError> {
    let book_id = decode_book_id(&id)?;
    let row = with_conn(&state, move |conn| reader_data::get_progress(conn, book_id)).await?;
    Ok(Json(row.map(|p| ReadingProgressDto {
        current_chapter: p.current_chapter,
        total_chapters: p.total_chapters,
        current_page: p.current_page,
        total_pages: p.total_pages,
        chapter_title: p.chapter_title,
        percentage: p.percentage,
        chapter_id: p.chapter_id,
        position: p.position,
        updated_at: p.updated_at,
    })))
}

async fn save_progress(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(request): Json<SaveReadingProgressRequestDto>,
) -> Result<StatusCode, ApiError> {
    let book_id = decode_book_id(&id)?;

    with_conn(&state, move |conn| {
        if !book_exists(conn, book_id)? {
            anyhow::bail!(NotFoundMarker);
        }
        reader_data::save_progress(
            conn,
            book_id,
            &reader_data::SaveProgressRequest {
                current_chapter: request.current_chapter,
                total_chapters: request.total_chapters,
                current_page: request.current_page,
                total_pages: request.total_pages,
                chapter_title: request.chapter_title,
                percentage: request.percentage,
                chapter_id: request.chapter_id,
                position: request.position,
            },
        )
    })
    .await
    .map_err(map_not_found)?;

    Ok(StatusCode::NO_CONTENT)
}

/// Marker error used to signal "book not found" out of a `with_conn` closure (whose error type is
/// `anyhow::Error`) without a special early-return path through `ApiError` inside the closure.
#[derive(Debug, thiserror::Error)]
#[error("book not found")]
struct NotFoundMarker;

fn map_not_found(err: ApiError) -> ApiError {
    if let ApiError::Internal(e) = &err {
        if e.downcast_ref::<NotFoundMarker>().is_some() {
            return ApiError::NotFound;
        }
    }
    err
}

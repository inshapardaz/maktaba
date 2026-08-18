//! Mirrors Maktaba.Api/Endpoints/BookEndpoints.cs.

use std::collections::HashMap;

use axum::extract::{Path, Query, State};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, patch, post};
use axum::{Json, Router};
use maktaba_core::entities::{BookFormat, ReadingStatus};
use maktaba_core::error::ImportError;
use maktaba_core::ids;
use maktaba_core::services::{BookConversionOutcome, BookEditRequest, ImportDuplicateResolution};
use maktaba_data::repo::books::BookListFilters;
use maktaba_data::services::{book_conversion, book_edit, book_removal, import};
use rusqlite::OptionalExtension;

use crate::db_task::with_conn;
use crate::dtos::*;
use crate::error::ApiError;
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/books", get(list_books))
        .route("/api/books/continue-reading", get(continue_reading))
        .route("/api/books/import", post(import_book))
        .route("/api/books/:id", get(get_book).put(update_book).delete(delete_book))
        .route("/api/books/:id/cover", get(get_cover))
        .route("/api/books/:id/file", get(get_file))
        .route("/api/books/:id/status", patch(update_status))
        .route("/api/books/:id/convert", post(convert_book))
}

async fn list_books(
    State(state): State<AppState>,
    Query(query): Query<HashMap<String, String>>,
) -> Result<Json<Vec<BookSummaryDto>>, ApiError> {
    let filters = BookListFilters {
        search: query.get("search").cloned(),
        author_id: query.get("authorId").map(|v| ids::try_decode(v).unwrap_or(-1)),
        series_id: query.get("seriesId").map(|v| ids::try_decode(v).unwrap_or(-1)),
        tag_id: query.get("tagId").map(|v| ids::try_decode(v).unwrap_or(-1)),
        collection_id: query.get("collectionId").map(|v| ids::try_decode(v).unwrap_or(-1)),
        reading_status: query.get("readingStatus").and_then(|v| ReadingStatus::parse(v)),
        format: query.get("format").and_then(|v| BookFormat::parse(v)),
        min_rating: query.get("minRating").and_then(|v| v.parse().ok()),
    };

    let root = state
        .library_service
        .library_root_path()
        .ok_or(ApiError::LibraryNotOpen)?;

    let rows = with_conn(&state, move |conn| maktaba_data::repo::books::list_books(conn, &root, &filters)).await?;

    Ok(Json(
        rows.into_iter()
            .map(|r| BookSummaryDto {
                id: ids::encode(r.id),
                title: r.title,
                sort_title: r.sort_title,
                authors: r.authors,
                rating: r.rating,
                date_added: r.date_added,
                has_cover: r.has_cover,
                reading_status: r.reading_status.as_str().to_string(),
                series_index: r.series_index,
                last_read_at: r.last_read_at,
            })
            .collect(),
    ))
}

async fn continue_reading(
    State(state): State<AppState>,
    Query(query): Query<HashMap<String, String>>,
) -> Result<Json<Vec<ContinueReadingBookDto>>, ApiError> {
    let limit = query.get("limit").and_then(|v| v.parse::<i64>().ok()).filter(|v| *v > 0).unwrap_or(20);
    let root = state.library_service.library_root_path().ok_or(ApiError::LibraryNotOpen)?;

    let rows = with_conn(&state, move |conn| maktaba_data::repo::books::continue_reading(conn, &root, limit)).await?;

    Ok(Json(
        rows.into_iter()
            .map(|r| ContinueReadingBookDto {
                id: ids::encode(r.id),
                title: r.title,
                authors: r.authors,
                has_cover: r.has_cover,
                reading_status: r.reading_status.as_str().to_string(),
                format: r.format.as_str().to_string(),
                absolute_path: r.absolute_path,
                percentage: r.percentage,
                updated_at: r.updated_at,
            })
            .collect(),
    ))
}

async fn get_book(State(state): State<AppState>, Path(id): Path<String>) -> Result<Json<BookDetailDto>, ApiError> {
    let Some(book_id) = ids::try_decode(&id) else { return Err(ApiError::NotFound) };
    let root = state.library_service.library_root_path().ok_or(ApiError::LibraryNotOpen)?;

    let row = with_conn(&state, move |conn| maktaba_data::repo::books::get_book_detail(conn, &root, book_id)).await?;
    let Some(row) = row else { return Err(ApiError::NotFound) };

    Ok(Json(BookDetailDto {
        id,
        title: row.title,
        sort_title: row.sort_title,
        description: row.description,
        language: row.language,
        publisher: row.publisher,
        date_published: row.date_published,
        rating: row.rating,
        date_added: row.date_added,
        authors: row.authors,
        series_name: row.series_name,
        series_index: row.series_index,
        tags: row.tags,
        identifiers: row.identifiers.into_iter().map(|i| IdentifierDto { scheme: i.scheme, value: i.value }).collect(),
        files: row
            .files
            .into_iter()
            .map(|f| BookFileDto { format: f.format.as_str().to_string(), file_size_bytes: f.file_size_bytes, absolute_path: f.absolute_path })
            .collect(),
        has_cover: row.has_cover,
        reading_status: row.reading_status.as_str().to_string(),
        collections: row.collections.into_iter().map(|c| BookCollectionDto { id: ids::encode(c.id), name: c.name }).collect(),
    }))
}

async fn get_cover(State(state): State<AppState>, Path(id): Path<String>) -> Response {
    let Some(book_id) = ids::try_decode(&id) else { return ApiError::NotFound.into_response() };
    let Some(root) = state.library_service.library_root_path() else { return ApiError::LibraryNotOpen.into_response() };

    let result = with_conn(&state, move |conn| {
        let folder_path: Option<String> = conn
            .query_row("SELECT folder_path FROM books WHERE id = ?1", [book_id], |r| r.get(0))
            .optional()?;
        Ok(folder_path)
    })
    .await;

    let folder_path = match result {
        Ok(Some(p)) => p,
        Ok(None) => return ApiError::NotFound.into_response(),
        Err(e) => return e.into_response(),
    };

    let Some((path, content_type)) = maktaba_data::cover_locator::find(std::path::Path::new(&root), &folder_path) else {
        return ApiError::NotFound.into_response();
    };

    match tokio::fs::read(&path).await {
        Ok(bytes) => ([(axum::http::header::CONTENT_TYPE, content_type)], bytes).into_response(),
        Err(_) => ApiError::NotFound.into_response(),
    }
}

async fn get_file(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Query(query): Query<HashMap<String, String>>,
) -> Response {
    let Some(book_id) = ids::try_decode(&id) else { return ApiError::NotFound.into_response() };
    let Some(format) = query.get("format").and_then(|f| BookFormat::parse(f)) else {
        return ApiError::BadRequest("Invalid or missing format.".to_string()).into_response();
    };
    let Some(root) = state.library_service.library_root_path() else { return ApiError::LibraryNotOpen.into_response() };

    let result = with_conn(&state, move |conn| {
        let file_path: Option<String> = conn
            .query_row(
                "SELECT file_path FROM book_files WHERE book_id = ?1 AND format = ?2 LIMIT 1",
                rusqlite::params![book_id, format.as_str()],
                |r| r.get(0),
            )
            .optional()?;
        Ok(file_path)
    })
    .await;

    let file_path = match result {
        Ok(Some(p)) => p,
        Ok(None) => return ApiError::NotFound.into_response(),
        Err(e) => return e.into_response(),
    };

    let absolute = std::path::Path::new(&root).join(&file_path);
    match tokio::fs::read(&absolute).await {
        Ok(bytes) => ([(axum::http::header::CONTENT_TYPE, format.content_type())], bytes).into_response(),
        Err(_) => ApiError::NotFound.into_response(),
    }
}

async fn update_book(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(request): Json<BookEditRequestDto>,
) -> Result<axum::http::StatusCode, ApiError> {
    let Some(book_id) = ids::try_decode(&id) else { return Err(ApiError::NotFound) };
    if request.title.trim().is_empty() {
        return Err(ApiError::BadRequest("Title is required.".to_string()));
    }

    // Ids that fail to decode are silently dropped rather than rejected - this is a save
    // operation, not a filter, and a stale/invalid collection id shouldn't block the rest of the edit.
    let collection_ids: Vec<i64> = request.collection_ids.iter().filter_map(|c| ids::try_decode(c)).collect();

    let edit_request = BookEditRequest {
        title: request.title.trim().to_string(),
        authors: request.authors,
        language: request.language,
        publisher: request.publisher,
        published_date: request.published_date,
        description: request.description,
        rating: request.rating,
        series_name: request.series_name,
        series_index: request.series_index,
        tags: request.tags,
        collection_ids,
    };

    let root = state.library_service.library_root_path().ok_or(ApiError::LibraryNotOpen)?;
    let updated = with_conn(&state, move |conn| book_edit::update(conn, &root, book_id, &edit_request)).await?;

    if updated {
        Ok(axum::http::StatusCode::NO_CONTENT)
    } else {
        Err(ApiError::NotFound)
    }
}

async fn update_status(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(request): Json<UpdateBookStatusRequestDto>,
) -> Result<axum::http::StatusCode, ApiError> {
    let Some(book_id) = ids::try_decode(&id) else { return Err(ApiError::NotFound) };
    let Some(status) = ReadingStatus::parse(&request.reading_status) else {
        return Err(ApiError::BadRequest("Invalid reading status.".to_string()));
    };

    let updated = with_conn(&state, move |conn| {
        let affected = conn.execute(
            "UPDATE books SET reading_status = ?1 WHERE id = ?2",
            rusqlite::params![status.as_str(), book_id],
        )?;
        Ok(affected > 0)
    })
    .await?;

    if updated {
        Ok(axum::http::StatusCode::NO_CONTENT)
    } else {
        Err(ApiError::NotFound)
    }
}

async fn convert_book(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(request): Json<ConvertBookRequestDto>,
) -> Result<Response, ApiError> {
    let Some(book_id) = ids::try_decode(&id) else { return Err(ApiError::NotFound) };
    let Some(target_format) = BookFormat::parse(&request.target_format) else {
        return Err(ApiError::BadRequest("Invalid target format.".to_string()));
    };

    let root = state.library_service.library_root_path().ok_or(ApiError::LibraryNotOpen)?;
    let calibre = state.calibre.clone();

    let result = with_conn(&state, move |conn| book_conversion::convert(conn, &root, &calibre, book_id, target_format)).await?;

    match result.outcome {
        BookConversionOutcome::Converted => {
            let file = result.file.unwrap();
            Ok(Json(BookFileDto {
                format: file.format.as_str().to_string(),
                file_size_bytes: file.file_size_bytes,
                absolute_path: {
                    let root = state.library_service.library_root_path().unwrap_or_default();
                    std::path::Path::new(&root).join(&file.file_path).to_string_lossy().to_string()
                },
            })
            .into_response())
        }
        BookConversionOutcome::BookNotFound => Err(ApiError::NotFound),
        BookConversionOutcome::AlreadyHasFormat => {
            Err(ApiError::Conflict(format!("This book already has a {} file.", request.target_format)))
        }
        BookConversionOutcome::CalibreUnavailable => {
            Err(ApiError::ServiceUnavailable("Calibre's ebook-convert isn't available on this machine.".to_string()))
        }
    }
}

async fn delete_book(State(state): State<AppState>, Path(id): Path<String>) -> Result<Json<serde_json::Value>, ApiError> {
    let Some(book_id) = ids::try_decode(&id) else { return Err(ApiError::NotFound) };
    let root = state.library_service.library_root_path().ok_or(ApiError::LibraryNotOpen)?;

    let result = with_conn(&state, move |conn| book_removal::remove(conn, &root, book_id)).await?;
    match result {
        Some(r) => Ok(Json(serde_json::json!({ "folderPath": r.absolute_folder_path }))),
        None => Err(ApiError::NotFound),
    }
}

async fn import_book(
    State(state): State<AppState>,
    Json(request): Json<ImportBookRequest>,
) -> Result<Response, ApiError> {
    if request.file_path.trim().is_empty() || !std::path::Path::new(&request.file_path).is_file() {
        return Err(ApiError::BadRequest("File not found.".to_string()));
    }

    let resolution = ImportDuplicateResolution::parse(request.duplicate_action.as_deref());
    let root = state.library_service.library_root_path().ok_or(ApiError::LibraryNotOpen)?;
    let extractors = state.extractors.clone();

    let db_path = crate::db_task::ensure_ready_path(&state).await?;

    let outcome = tokio::task::spawn_blocking(move || -> Result<_, ImportError> {
        let mut conn = maktaba_data::db::open_connection(&db_path).map_err(ImportError::Other)?;
        import::import_file(&mut conn, &root, &extractors, &request.file_path, resolution)
    })
    .await
    .map_err(|e| ApiError::Internal(e.into()))?;

    match outcome {
        Ok(book) => {
            let sqid = ids::encode(book.id);
            Ok((
                axum::http::StatusCode::CREATED,
                [(axum::http::header::LOCATION, format!("/api/books/{sqid}"))],
                Json(serde_json::json!({ "id": sqid })),
            )
                .into_response())
        }
        Err(ImportError::UnsupportedFileType(ext)) => {
            Err(ApiError::BadRequest(format!("Unsupported ebook file type: {ext}")))
        }
        Err(ImportError::DuplicateDetected { info }) => {
            let body = serde_json::json!({
                "error": format!("A matching book already exists: \"{}\".", info.existing_title),
                "duplicate": DuplicateBookDto {
                    existing_book_id: ids::encode(info.existing_book_id),
                    existing_title: info.existing_title,
                    existing_authors: info.existing_authors,
                    same_content_hash: info.same_content_hash,
                },
            });
            Ok((axum::http::StatusCode::CONFLICT, Json(body)).into_response())
        }
        Err(ImportError::Other(err)) => Err(ApiError::Internal(err)),
    }
}

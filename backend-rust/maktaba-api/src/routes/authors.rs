//! Mirrors Maktaba.Api/Endpoints/AuthorEndpoints.cs.

use axum::extract::{Path, State};
use axum::routing::put;
use axum::{Json, Router};
use maktaba_core::ids;
use maktaba_core::services::AuthorRenameOutcome;
use maktaba_data::services::author_rename;

use crate::db_task::with_conn;
use crate::dtos::{BrowseGroupDto, RenameAuthorRequestDto};
use crate::error::ApiError;
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new().route("/api/authors/:id/name", put(rename))
}

/// Cascades to every book by this author - see maktaba_data::services::author_rename for the
/// on-disk folder move this triggers for books where they're the primary author.
async fn rename(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(request): Json<RenameAuthorRequestDto>,
) -> Result<Json<BrowseGroupDto>, ApiError> {
    let name = request.name.as_deref().map(str::trim).unwrap_or("").to_string();
    if name.is_empty() {
        return Err(ApiError::BadRequest("Name is required.".to_string()));
    }

    let Some(author_id) = ids::try_decode(&id) else { return Err(ApiError::NotFound) };
    let root = state.library_service.library_root_path().ok_or(ApiError::LibraryNotOpen)?;

    let result = with_conn(&state, move |conn| author_rename::rename(conn, &root, author_id, &name)).await?;

    match result.outcome {
        AuthorRenameOutcome::Renamed => Ok(Json(BrowseGroupDto {
            id: ids::encode(result.author_id.unwrap()),
            name: result.author_name.unwrap(),
            book_count: result.affected_book_count,
        })),
        AuthorRenameOutcome::AuthorNotFound => Err(ApiError::NotFound),
        AuthorRenameOutcome::NameConflict => {
            Err(ApiError::Conflict(format!("An author named \"{}\" already exists.", request.name.unwrap_or_default())))
        }
    }
}

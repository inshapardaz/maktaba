//! Mirrors Maktaba.Api/Endpoints/BrowseEndpoints.cs.

use axum::extract::State;
use axum::routing::get;
use axum::{Json, Router};
use maktaba_core::ids;

use crate::db_task::with_conn;
use crate::dtos::{BrowseGroupDto, ReadingStatusCountDto};
use crate::error::ApiError;
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/authors", get(authors))
        .route("/api/series", get(series))
        .route("/api/tags", get(tags))
        .route("/api/publishers", get(publishers))
        .route("/api/reading-statuses", get(reading_statuses))
}

async fn authors(State(state): State<AppState>) -> Result<Json<Vec<BrowseGroupDto>>, ApiError> {
    let rows = with_conn(&state, |conn| maktaba_data::repo::browse::authors(conn)).await?;
    Ok(Json(rows.into_iter().map(to_dto).collect()))
}

async fn series(State(state): State<AppState>) -> Result<Json<Vec<BrowseGroupDto>>, ApiError> {
    let rows = with_conn(&state, |conn| maktaba_data::repo::browse::series(conn)).await?;
    Ok(Json(rows.into_iter().map(to_dto).collect()))
}

async fn tags(State(state): State<AppState>) -> Result<Json<Vec<BrowseGroupDto>>, ApiError> {
    let rows = with_conn(&state, |conn| maktaba_data::repo::browse::tags(conn)).await?;
    Ok(Json(rows.into_iter().map(to_dto).collect()))
}

async fn publishers(State(state): State<AppState>) -> Result<Json<Vec<String>>, ApiError> {
    let rows = with_conn(&state, |conn| maktaba_data::repo::browse::publishers(conn)).await?;
    Ok(Json(rows))
}

async fn reading_statuses(State(state): State<AppState>) -> Result<Json<Vec<ReadingStatusCountDto>>, ApiError> {
    let rows = with_conn(&state, |conn| maktaba_data::repo::browse::reading_status_counts(conn)).await?;
    Ok(Json(rows.into_iter().map(|(status, count)| ReadingStatusCountDto { status: status.as_str().to_string(), count }).collect()))
}

fn to_dto(row: maktaba_data::repo::browse::BrowseGroupRow) -> BrowseGroupDto {
    BrowseGroupDto { id: ids::encode(row.id), name: row.name, book_count: row.count }
}

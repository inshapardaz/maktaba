use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::json;

pub enum ApiError {
    LibraryNotOpen,
    NotFound,
    BadRequest(String),
    Conflict(String),
    ServiceUnavailable(String),
    Internal(anyhow::Error),
}

impl From<anyhow::Error> for ApiError {
    fn from(err: anyhow::Error) -> Self {
        ApiError::Internal(err)
    }
}

impl From<rusqlite::Error> for ApiError {
    fn from(err: rusqlite::Error) -> Self {
        ApiError::Internal(err.into())
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let (status, message) = match self {
            ApiError::LibraryNotOpen => (StatusCode::BAD_REQUEST, "No library is open.".to_string()),
            ApiError::NotFound => (StatusCode::NOT_FOUND, String::new()),
            ApiError::BadRequest(msg) => (StatusCode::BAD_REQUEST, msg),
            ApiError::Conflict(msg) => (StatusCode::CONFLICT, msg),
            ApiError::ServiceUnavailable(msg) => (StatusCode::SERVICE_UNAVAILABLE, msg),
            ApiError::Internal(err) => {
                tracing::error!("internal error: {err:#}");
                (StatusCode::INTERNAL_SERVER_ERROR, "Internal server error.".to_string())
            }
        };

        if status == StatusCode::NOT_FOUND && message.is_empty() {
            return status.into_response();
        }

        (status, Json(json!({ "error": message }))).into_response()
    }
}

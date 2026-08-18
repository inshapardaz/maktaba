//! Bearer-token auth for every route except the unauthenticated health check. Token is generated
//! per-launch by the Electron main process and passed via --token; running the API directly (no
//! --token) skips auth, for local dev/testing. A `?access_token=` query param is also accepted,
//! since `<img>` tags can't set an Authorization header - used only for GET /api/books/{id}/cover.
//! Mirrors Program.cs's first `app.Use(...)`.

use axum::extract::State;
use axum::http::{Request, StatusCode};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};

use crate::state::AppState;

pub async fn require_token(
    State(state): State<AppState>,
    req: Request<axum::body::Body>,
    next: Next,
) -> Response {
    let Some(token) = &state.token else {
        return next.run(req).await;
    };
    if token.is_empty() || req.uri().path() == "/health" {
        return next.run(req).await;
    }

    let via_header = req
        .headers()
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .map(|v| v == format!("Bearer {token}"))
        .unwrap_or(false);

    let via_query = req
        .uri()
        .query()
        .map(|q| {
            url::form_urlencoded::parse(q.as_bytes())
                .any(|(k, v)| k == "access_token" && v == token.as_str())
        })
        .unwrap_or(false);

    if !via_header && !via_query {
        return StatusCode::UNAUTHORIZED.into_response();
    }

    next.run(req).await
}

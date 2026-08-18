//! Mirrors Maktaba.Api/Endpoints/SystemEndpoints.cs.

use axum::extract::State;
use axum::routing::get;
use axum::{Json, Router};

use crate::dtos::SystemCapabilitiesDto;
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new().route("/api/system/capabilities", get(capabilities))
}

async fn capabilities(State(state): State<AppState>) -> Json<SystemCapabilitiesDto> {
    Json(SystemCapabilitiesDto { calibre_available: state.calibre.is_available() })
}

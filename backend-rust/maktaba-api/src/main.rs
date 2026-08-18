mod auth;
mod chrono_utc;
mod db_task;
mod dtos;
mod error;
mod routes;
mod state;

use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::sync::Arc;

use axum::routing::get;
use axum::{Json, Router};
use clap::Parser;
use maktaba_core::metadata::BookMetadataExtractor;
use maktaba_data::library_service::LibraryService;
use maktaba_data::rescan_progress::RescanProgressTracker;
use maktaba_data::services::calibre::CalibreConverter;
use tower_http::cors::CorsLayer;

use state::AppState;

/// Maktaba's backend sidecar. Spawned by the Electron main process (see
/// apps/desktop/src/sidecar.ts) with a loopback port + a per-launch bearer token; running it
/// directly with no --token skips auth, for local dev/testing.
#[derive(Parser)]
struct Args {
    #[arg(long, default_value_t = 51000)]
    port: u16,
    #[arg(long)]
    token: Option<String>,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()))
        .init();

    let args = Args::parse();

    let library_service = Arc::new(LibraryService::new()?);
    let extractors: Arc<Vec<Box<dyn BookMetadataExtractor>>> = Arc::new(vec![
        Box::new(maktaba_metadata::epub::EpubMetadataExtractor),
        Box::new(maktaba_metadata::pdf::PdfMetadataExtractor),
    ]);
    let rescan_tracker = Arc::new(RescanProgressTracker::new());
    let calibre = Arc::new(CalibreConverter::new());

    let app_state = AppState {
        library_service,
        extractors,
        rescan_tracker,
        calibre,
        token: args.token.filter(|t| !t.is_empty()),
    };

    let app = Router::new()
        .route("/health", get(|| async { Json(serde_json::json!({ "status": "ok" })) }))
        .route("/api/hello", get(|| async { Json(serde_json::json!({ "message": "Hello from Maktaba.Api" })) }))
        .merge(routes::books::router())
        .merge(routes::library::router())
        .merge(routes::browse::router())
        .merge(routes::collections::router())
        .merge(routes::system::router())
        .merge(routes::reader_data::router())
        .merge(routes::authors::router())
        .merge(routes::tags::router())
        .merge(routes::series::router())
        .layer(axum::middleware::from_fn_with_state(app_state.clone(), auth::require_token))
        // Loopback-only server behind a per-launch bearer token, so any origin is fine here - the
        // renderer's origin differs from the API's in both dev (Vite) and packaged (file://) builds.
        .layer(CorsLayer::permissive())
        .with_state(app_state);

    let addr = SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), args.port);
    let listener = tokio::net::TcpListener::bind(addr).await?;
    tracing::info!("Maktaba.Api listening on {addr}");

    axum::serve(listener, app).await?;
    Ok(())
}

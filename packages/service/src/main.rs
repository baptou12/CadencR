mod api;
mod app_state;
mod config;
mod domain;
mod error;
mod shared;

use clap::Parser;
use tower_http::cors::CorsLayer;
use tracing::info;

use app_state::AppState;
use config::Config;
use shared::db;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "cadence_service=info".into()),
        )
        .init();

    let config = Config::parse();

    let write_pool = db::create_write_pool(&config.db_path).await?;
    let read_pool = db::create_read_pool(&config.db_path).await?;

    let state = AppState {
        read_pool,
        write_pool,
    };

    let app = api::build_router(state).layer(CorsLayer::permissive());

    let addr = format!("127.0.0.1:{}", config.port);
    info!("Cadence service listening on {addr}");

    let listener = tokio::net::TcpListener::bind(&addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}

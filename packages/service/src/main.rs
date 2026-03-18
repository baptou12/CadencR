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

    // Mark any sessions left as 'running' from a previous crash as 'paused'
    domain::ws_session::persistence::WsSessionPersistence::cleanup_stale_sessions(&write_pool).await;

    let state = AppState {
        read_pool,
        write_pool,
        electron_port: config.electron_port,
        max_parallel_agents: AppState::max_parallel_from_env(),
    };

    let app = api::build_router(state).layer(CorsLayer::permissive());

    let addr = format!("127.0.0.1:{}", config.port);
    info!("Cadence service listening on {addr}");

    let listener = tokio::net::TcpListener::bind(&addr).await?;
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await?;

    Ok(())
}

async fn shutdown_signal() {
    let ctrl_c = async {
        tokio::signal::ctrl_c()
            .await
            .expect("failed to install Ctrl+C handler");
    };
    #[cfg(unix)]
    let terminate = async {
        tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            .expect("failed to install SIGTERM handler")
            .recv()
            .await;
    };
    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => {},
        _ = terminate => {},
    }
    tracing::info!("Shutdown signal received, shutting down gracefully...");
}

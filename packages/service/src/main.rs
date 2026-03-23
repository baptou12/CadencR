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
use config::{Command, Config};
use shared::db;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let config = Config::parse();

    let is_mcp = config.command.is_some();
    init_tracing(is_mcp);

    match &config.command {
        Some(Command::McpServe {
            agent_type,
            feature_id,
        }) => {
            let db_path = config
                .db_path
                .clone()
                .expect("--db-path or CADENCE_DB_PATH env var required for mcp-serve");

            domain::mcp::stdio::run_mcp_stdio(&db_path, agent_type, *feature_id).await?;
        }
        None => {

            let db_path = config
                .db_path
                .clone()
                .expect("--db-path or CADENCE_DB_PATH env var required");

            // Set env var so MCP subprocesses inherit it
            std::env::set_var("CADENCE_DB_PATH", &db_path);

            let write_pool = db::create_write_pool(&db_path).await?;
            shared::migrate::run_migrations(&write_pool).await?;
            let read_pool = db::create_read_pool(&db_path).await?;

            // Mark any sessions left as 'running' from a previous crash as 'paused'
            domain::ws_session::persistence::WsSessionPersistence::cleanup_stale_sessions(
                &write_pool,
            )
            .await;

            let (turn_state_tx, _) = tokio::sync::broadcast::channel(64);

            let state = AppState {
                read_pool,
                write_pool,
                max_parallel_agents: AppState::max_parallel_from_env(),
                agent_timeout_minutes: AppState::agent_timeout_minutes_from_env(),
                turn_state_tx,
                pty_manager: domain::terminal::service::PtyManager::new(),
            };

            let app = api::build_router(state).layer(CorsLayer::permissive());

            let addr = format!("127.0.0.1:{}", config.port);
            info!("Cadence service listening on {addr}");

            let listener = tokio::net::TcpListener::bind(&addr).await?;
            axum::serve(listener, app)
                .with_graceful_shutdown(shutdown_signal())
                .await?;
        }
    }

    Ok(())
}

/// Initialize tracing. MCP subprocess mode writes to stderr to avoid
/// interfering with the MCP JSON protocol on stdout.
fn init_tracing(to_stderr: bool) {
    let filter = tracing_subscriber::EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| "cadence_service=info".into());

    if to_stderr {
        tracing_subscriber::fmt()
            .with_env_filter(filter)
            .with_writer(std::io::stderr)
            .init();
    } else {
        tracing_subscriber::fmt().with_env_filter(filter).init();
    }
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

    // Pause all workflow agents so they can resume on next start
    crate::domain::ws_session::handler::workflow::pause_all_engines().await;

    tracing::info!("All workflow agents paused.");
}

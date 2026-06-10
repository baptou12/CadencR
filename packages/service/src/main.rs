mod api;
mod app_state;
mod config;
mod dev_env;
mod domain;
mod error;
mod remote;
mod shared;

use axum::http::header::{HeaderName, CONTENT_TYPE};
use axum::http::Method;
use clap::Parser;
use std::path::PathBuf;
use tower_http::cors::CorsLayer;
use tracing::info;

use app_state::AppState;
use config::{Command, Config};
use shared::db;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Only debug builds touch the dev `.env`. Release binaries shipped inside
    // the desktop app must not pick up whatever happens to live next to the
    // source tree on the developer machine — that is exactly how the prod
    // database used to get repointed at the dev DB on the user's laptop.
    let dotenv_path = if cfg!(debug_assertions) {
        dev_env::load_optional_package_dotenv(env!("CARGO_MANIFEST_DIR"))?
    } else {
        None
    };

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
                .expect("--db-path or CADENCR_DB_PATH env var required for mcp-serve");

            domain::mcp::stdio::run_mcp_stdio(&db_path, agent_type, *feature_id).await?;
        }
        None => {
            if cfg!(debug_assertions) {
                let dotenv_path = dev_env::require_dev_env_file(dotenv_path)?;
                dev_env::validate_required_env_keys(
                    dev_env::SERVICE_DOTENV_DISPLAY_PATH,
                    &dev_env::REQUIRED_DEV_ENV_KEYS,
                )?;
                info!("Loaded env from {}", dotenv_path.display());
            } else if let Some(dotenv_path) = dotenv_path.as_deref() {
                info!("Loaded env from {}", dotenv_path.display());
            }

            // Hydrate process env from the user's login shell BEFORE any
            // subprocesses (git, gpg, ssh, agent CLIs, PTY shells) get
            // spawned. Without this, a Electron/launchd-launched binary
            // inherits a stripped-down env (`PATH=/usr/bin:/bin:...`, no
            // `GPG_TTY`, no `SSH_AUTH_SOCK`) and `git commit -S` fails for
            // anyone who configured signing or agent sockets in their
            // `.zshrc` / `.zprofile`. Best-effort: warns on failure,
            // never blocks startup.
            shared::login_env::hydrate_from_login_shell().await;

            let db_path = config
                .db_path
                .clone()
                .expect("--db-path or CADENCR_DB_PATH env var required");

            let write_pool = db::create_write_pool(&db_path).await?;
            shared::migrate::run_migrations(&shared::migrate::MigrationContext {
                pool: &write_pool,
                db_path: Some(std::path::Path::new(&db_path)),
                app_version: config.app_version.as_deref(),
            })
            .await?;
            let read_pool = db::create_read_pool(&db_path).await?;

            // Mark any sessions left as 'running' from a previous crash as 'paused'
            domain::ws_session::persistence::WsSessionPersistence::cleanup_stale_sessions(
                &write_pool,
            )
            .await;

            let auth_token = config.auth_token.ok_or_else(|| {
                anyhow::anyhow!(
                    "CADENCR_AUTH_TOKEN is required. Pass --auth-token <tok> or set the env \
                     var. Dev runs: set it in `packages/service/.env`. \
                     Production runs: the desktop shell generates one per launch and passes it \
                     as a CLI flag."
                )
            })?;

            let remote_controller =
                std::sync::Arc::new(remote::RemoteController::new(remote::RemoteConfig {
                    renderer_dir: config.renderer_dir.clone().map(PathBuf::from),
                    remote_port: config.remote_port,
                    data_dir: remote::paths::remote_data_dir(),
                }));

            let state = AppState::for_server(
                read_pool,
                write_pool,
                auth_token,
                config.frontend_port,
                config.port,
                remote_controller,
            );

            // Push user-selected CLI binary paths into the SDK overrides
            // BEFORE the warmup runs — the opencode warmup spawns the server
            // process, which needs to honor the override on first launch.
            domain::agents::apply_binary_overrides_from_settings(&state.read_pool).await;
            domain::agents::spawn_runtime_startup_warmups();

            // Reconcile custom-action runs orphaned by the previous exit: their
            // processes died with the old service instance, so finalize them
            // instead of leaving the UI stuck "running" and unable to re-run.
            match domain::custom_actions::repository::fail_orphaned_runs(&state.write_pool).await {
                Ok(n) if n > 0 => info!(count = n, "reconciled orphaned custom action runs"),
                Ok(_) => {}
                Err(e) => tracing::warn!("failed to reconcile orphaned custom action runs: {e}"),
            }

            // Resume periodic custom-action schedules from a previous launch.
            state.custom_action_scheduler.bootstrap(&state).await;

            // Auto-start remote access if the user left it enabled (persisted
            // setting). Failures are non-fatal — the loopback server must come
            // up regardless, and the UI surfaces the error on next toggle.
            if remote::is_enabled(&state.read_pool).await {
                match state.remote.start(&state).await {
                    Ok(info) => info!("Remote access auto-started on port {}", info.port),
                    Err(err) => tracing::warn!("Remote access auto-start failed: {err}"),
                }
            }

            let pty_manager = state.pty_manager.clone();
            let remote_for_shutdown = state.remote.clone();
            let app = api::build_router(state).layer(build_cors_layer(config.frontend_port));

            let addr = format!("127.0.0.1:{}", config.port);
            info!("Cadencr service listening on {addr}");

            let listener = tokio::net::TcpListener::bind(&addr).await?;
            // Wrap in a `Listener` that disables Nagle's algorithm on every
            // accepted connection. Nagle is the default on `tokio::net::TcpStream`
            // and silently coalesces small frames for ~200 ms — which turns
            // a real-time WebSocket stream (commit output, agent output) into
            // a "dump everything at the end" feed. We never want that here.
            axum::serve(NoDelayListener(listener), app)
                .with_graceful_shutdown(shutdown_signal(pty_manager, remote_for_shutdown))
                .await?;
        }
    }

    Ok(())
}

/// `tokio::net::TcpListener` wrapper that disables Nagle's algorithm on every
/// accepted connection. Without this, small WebSocket frames (single
/// command-output chunks, agent stream lines) sit in the OS TCP buffer for
/// up to ~200 ms before being flushed, which destroys the live-streaming UX
/// the commit dialog and agent panes depend on.
struct NoDelayListener(tokio::net::TcpListener);

impl axum::serve::Listener for NoDelayListener {
    type Io = tokio::net::TcpStream;
    type Addr = std::net::SocketAddr;

    async fn accept(&mut self) -> (Self::Io, Self::Addr) {
        loop {
            match self.0.accept().await {
                Ok((stream, addr)) => {
                    // Best-effort: a `set_nodelay` failure on a localhost
                    // TCP stream is exotic and not worth aborting the
                    // connection over — log it and continue.
                    if let Err(err) = stream.set_nodelay(true) {
                        tracing::warn!("set_nodelay failed: {err}");
                    }
                    return (stream, addr);
                }
                Err(err) => {
                    // Mirror axum's own retry-with-backoff behavior on
                    // transient accept errors; without this an EMFILE / per-
                    // process FD exhaustion would tight-loop.
                    tracing::warn!("accept failed: {err}");
                    tokio::time::sleep(std::time::Duration::from_millis(100)).await;
                }
            }
        }
    }

    fn local_addr(&self) -> std::io::Result<Self::Addr> {
        self.0.local_addr()
    }
}

fn build_cors_layer(frontend_port: u16) -> CorsLayer {
    let mut origins = vec!["null".parse().expect("static origin")];
    if cfg!(debug_assertions) {
        origins.push(
            format!("http://localhost:{frontend_port}")
                .parse()
                .expect("frontend origin"),
        );
        origins.push(
            format!("http://127.0.0.1:{frontend_port}")
                .parse()
                .expect("frontend origin"),
        );
    }

    CorsLayer::new()
        .allow_origin(origins)
        .allow_headers([
            HeaderName::from_static(api::middleware::AUTH_HEADER),
            CONTENT_TYPE,
        ])
        .allow_methods([
            Method::GET,
            Method::POST,
            Method::PUT,
            Method::DELETE,
            Method::PATCH,
        ])
}

/// MCP subprocess mode writes to stderr to keep stdout clean for JSON-RPC.
fn init_tracing(to_stderr: bool) {
    let filter = tracing_subscriber::EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| "cadencr_service=info".into());

    if to_stderr {
        tracing_subscriber::fmt()
            .with_env_filter(filter)
            .with_writer(std::io::stderr)
            .init();
    } else {
        tracing_subscriber::fmt().with_env_filter(filter).init();
    }
}

async fn shutdown_signal(
    pty_manager: domain::terminal::service::PtyManager,
    remote: std::sync::Arc<remote::RemoteController>,
) {
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

    // Drop the remote listener first so no new remote-driven work starts while
    // we tear the rest down. Bounded so a hung remote WS can't block quit.
    remote.stop().await;

    pty_manager.kill_all();
    crate::domain::agents::shutdown_runtime_servers().await;

    tracing::info!("Runtime servers stopped.");
}

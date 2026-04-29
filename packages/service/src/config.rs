use clap::{Parser, Subcommand};

#[derive(Parser, Debug, Clone)]
#[command(name = "cadencr-service", about = "Cadencr Rust backend service")]
pub struct Config {
    /// Path to the SQLite database file
    #[arg(long, global = true, env = "CADENCR_DB_PATH")]
    pub db_path: Option<String>,

    /// Port to listen on (overridable via CADENCR_RUST_PORT env var)
    #[arg(long, default_value = "5005", env = "CADENCR_RUST_PORT")]
    pub port: u16,

    /// Frontend dev server port used for local-origin allowlists.
    #[arg(long, default_value = "1420", env = "CADENCR_FRONTEND_PORT")]
    pub frontend_port: u16,

    /// Per-launch bearer token. Required when running the HTTP server; unused
    /// in `mcp-serve` mode. The Tauri shell mints one at launch; dev runs read
    /// it from `packages/service/.env`.
    #[arg(long, env = "CADENCR_AUTH_TOKEN", hide_env_values = true)]
    pub auth_token: Option<String>,

    #[command(subcommand)]
    pub command: Option<Command>,
}

#[derive(Subcommand, Debug, Clone)]
pub enum Command {
    /// Run as an MCP stdio server. Each subprocess is pinned to one feature:
    /// tool calls read the id from `McpContext` (see `mcp/context.rs`) rather
    /// than from caller-supplied arguments, closing the confused-deputy vector
    /// across features. A task-local scope would be cleaner but `rmcp`
    /// occasionally dispatches handlers on fresh tokio tasks that do not
    /// inherit task-locals, so the id is stored on the shared context instead.
    McpServe {
        /// plan, prd, execute, qa, review, risk, retro, or session.
        #[arg(long)]
        agent_type: String,

        #[arg(long)]
        feature_id: i64,
    },
}

use clap::{Parser, Subcommand};

#[derive(Parser, Debug, Clone)]
#[command(name = "cadence-service", about = "Cadence Rust backend service")]
pub struct Config {
    /// Path to the SQLite database file
    #[arg(long, global = true, env = "CADENCE_DB_PATH")]
    pub db_path: Option<String>,

    /// Port to listen on (overridable via CADENCE_RUST_PORT env var)
    #[arg(long, default_value = "45678", env = "CADENCE_RUST_PORT")]
    pub port: u16,

    /// Per-launch bearer token. Required when running the HTTP server; unused
    /// in `mcp-serve` mode. The Tauri shell mints one at launch; dev runs pick
    /// it up from `.env` via `scripts/ensure-dev-token.mjs`.
    #[arg(long, env = "CADENCE_AUTH_TOKEN", hide_env_values = true)]
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

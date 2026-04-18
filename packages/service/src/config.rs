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

    /// Per-launch bearer token. `None` disables auth (dev-only escape hatch).
    #[arg(long, env = "CADENCE_AUTH_TOKEN", hide_env_values = true)]
    pub auth_token: Option<String>,

    #[command(subcommand)]
    pub command: Option<Command>,
}

#[derive(Subcommand, Debug, Clone)]
pub enum Command {
    /// Run as an MCP stdio server. Each subprocess is pinned to one feature:
    /// tool calls read the id from task-local scope, not from caller-supplied
    /// arguments, which closes the confused-deputy vector across features.
    McpServe {
        /// plan, prd, execute, qa, review, risk, retro, or session.
        #[arg(long)]
        agent_type: String,

        #[arg(long)]
        feature_id: i64,
    },
}

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

    /// Port of the Electron IPC HTTP server (for callbacks like stop-agents)
    #[arg(long, default_value = "45679", env = "CADENCE_ELECTRON_PORT")]
    pub electron_port: u16,

    #[command(subcommand)]
    pub command: Option<Command>,
}

#[derive(Subcommand, Debug, Clone)]
pub enum Command {
    /// Run as an MCP stdio server for a specific agent type
    McpServe {
        /// Agent type to serve (plan, prd, execute, qa, review, risk, retro, session)
        #[arg(long)]
        agent_type: String,

        /// Feature ID for context
        #[arg(long)]
        feature_id: i64,
    },
}

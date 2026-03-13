use clap::Parser;

#[derive(Parser, Debug, Clone)]
#[command(name = "cadence-service", about = "Cadence Rust backend service")]
pub struct Config {
    /// Path to the SQLite database file
    #[arg(long)]
    pub db_path: String,

    /// Port to listen on (overridable via CADENCE_RUST_PORT env var)
    #[arg(long, default_value = "45678", env = "CADENCE_RUST_PORT")]
    pub port: u16,
}

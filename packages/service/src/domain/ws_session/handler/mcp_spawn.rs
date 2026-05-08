//! Build the `mcp_servers` config map for subprocess spawns.
//!
//! Invariant: one subprocess per (agent-type, feature). Do not revert to
//! sharing across features — feature-id pinning is what blocks a prompt-
//! injected agent from operating on another feature's data.

use std::collections::HashMap;
use std::env;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use tracing::info;

use crate::domain::agents::adapter::RuntimeMcpServerConfig;
use crate::domain::mcp::servers::{mcp_server_name, AgentType};

/// Process-local store for the canonical DB path.
///
/// The HTTP-server mode used to publish this via `CADENCR_DB_PATH` so
/// `build_mcp_server_config` could read it back when building MCP subprocess
/// configs. That export silently leaked into every PTY shell, agent CLI, and
/// nested `cargo run` the user (or an agent inside Cadencr) launched — and a
/// dev service started from a worktree happily ran its new migration against
/// the desktop shell's production DB. Keep the path in-process only.
static DB_PATH: OnceLock<String> = OnceLock::new();

#[allow(dead_code)] // called from `main.rs` (bin), not visible to the lib build
pub fn set_db_path(path: String) {
    let _ = DB_PATH.set(path);
}

fn current_db_path() -> Option<String> {
    if let Some(path) = DB_PATH.get() {
        return Some(path.clone());
    }
    // Tests set CADENCR_DB_PATH directly to exercise this without going
    // through main.rs. Production never reaches this branch — main.rs sets
    // DB_PATH before any consumer fires — so the env var stays untrusted in
    // release builds, which is the whole point of the in-process store.
    #[cfg(test)]
    {
        return env::var("CADENCR_DB_PATH").ok();
    }
    #[cfg(not(test))]
    None
}

pub fn build_mcp_server_config(
    agent_type: AgentType,
    feature_id: i64,
) -> HashMap<String, RuntimeMcpServerConfig> {
    let server_name = mcp_server_name(agent_type);
    let binary_path = env::current_exe()
        .unwrap_or_else(|_| "cadencr-service".into())
        .to_string_lossy()
        .to_string();

    let db_path = current_db_path().map(|path| absolute_db_path(&path));
    let env_vars = db_path
        .as_ref()
        .map(|path| HashMap::from([("CADENCR_DB_PATH".to_string(), path.clone())]));

    // Always pass --db-path explicitly so the subprocess doesn't rely solely
    // on inheriting the environment variable.
    let mut mcp_args = Vec::new();
    if let Some(ref path) = db_path {
        mcp_args.push("--db-path".to_string());
        mcp_args.push(path.clone());
    }
    mcp_args.push("mcp-serve".to_string());
    mcp_args.push("--agent-type".to_string());
    mcp_args.push(format!("{agent_type:?}").to_lowercase());
    mcp_args.push("--feature-id".to_string());
    mcp_args.push(feature_id.to_string());

    info!(
        server_name,
        binary_path,
        feature_id,
        ?mcp_args,
        "built MCP server config"
    );

    let config = RuntimeMcpServerConfig::Stdio {
        command: binary_path,
        args: Some(mcp_args),
        env: env_vars,
    };

    HashMap::from([(server_name, config)])
}

fn absolute_db_path(path: &str) -> String {
    let db_path = Path::new(path);
    if db_path.is_absolute() {
        return db_path.to_string_lossy().to_string();
    }
    env::current_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join(db_path)
        .to_string_lossy()
        .to_string()
}

#[cfg(test)]
mod tests {
    use std::env;
    use std::sync::{Mutex, OnceLock};

    use crate::domain::agents::adapter::RuntimeMcpServerConfig;
    use crate::domain::mcp::servers::AgentType;

    use super::build_mcp_server_config;

    fn env_lock() -> &'static Mutex<()> {
        static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
        LOCK.get_or_init(|| Mutex::new(()))
    }

    #[test]
    fn mcp_config_passes_absolute_db_path_to_subprocess() {
        let _guard = env_lock().lock().unwrap();
        env::set_var("CADENCR_DB_PATH", "./cadencr.local.db");

        let config = build_mcp_server_config(AgentType::Plan, 42);
        let RuntimeMcpServerConfig::Stdio { args, env, .. } = config
            .get("cadencr-plan")
            .expect("plan server config")
            .clone();
        let expected = env::current_dir()
            .unwrap()
            .join("./cadencr.local.db")
            .to_string_lossy()
            .to_string();

        assert!(args
            .expect("args")
            .windows(2)
            .any(|pair| pair[0] == "--db-path" && pair[1] == expected));
        assert_eq!(env.expect("env").get("CADENCR_DB_PATH"), Some(&expected));
        env::remove_var("CADENCR_DB_PATH");
    }
}

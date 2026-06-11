use std::collections::HashMap;
use std::path::{Path, PathBuf};

use crate::app_state::BrowserBridgeConfig;
use crate::domain::agents::adapter::{RuntimeMcpServerConfig, RuntimeSpawnConfig};

const CADENCR_BROWSER_MCP_NAME: &str = "cadencr-browser";

pub(super) fn attach_cadencr_browser_mcp(
    config: &mut RuntimeSpawnConfig,
    db_path: &str,
    feature_id: i64,
    command: &str,
    browser_bridge: Option<BrowserBridgeConfig>,
) -> Result<(), String> {
    let db_path = absolute_db_path(db_path)?;
    let servers = config.mcp_servers.get_or_insert_with(HashMap::new);
    servers.insert(
        CADENCR_BROWSER_MCP_NAME.to_string(),
        RuntimeMcpServerConfig::Stdio {
            command: command.to_string(),
            args: Some(vec![
                "--db-path".to_string(),
                db_path,
                "mcp-serve".to_string(),
                "--agent-type".to_string(),
                "browser".to_string(),
                "--feature-id".to_string(),
                feature_id.to_string(),
            ]),
            env: browser_bridge_env(browser_bridge),
        },
    );
    Ok(())
}

pub(super) fn attach_current_cadencr_browser_mcp(
    config: &mut RuntimeSpawnConfig,
    db_path: &str,
    feature_id: i64,
    browser_bridge: Option<BrowserBridgeConfig>,
) -> Result<(), String> {
    let current_exe = std::env::current_exe()
        .map_err(|error| format!("Could not resolve Cadencr service executable: {error}"))?;
    let command = current_exe.to_string_lossy().into_owned();
    attach_cadencr_browser_mcp(config, db_path, feature_id, &command, browser_bridge)
}

fn absolute_db_path(db_path: &str) -> Result<String, String> {
    let path = Path::new(db_path);
    let absolute = if path.is_absolute() {
        PathBuf::from(path)
    } else {
        std::env::current_dir()
            .map_err(|error| format!("Could not resolve service current directory: {error}"))?
            .join(path)
    };
    Ok(absolute.to_string_lossy().into_owned())
}

fn browser_bridge_env(config: Option<BrowserBridgeConfig>) -> Option<HashMap<String, String>> {
    if let Some(config) = config {
        return Some(HashMap::from(config.as_env()));
    }
    let env_config = BrowserBridgeConfig::from_env()?;
    Some(HashMap::from(env_config.as_env()))
}

#[cfg(test)]
mod tests {
    use crate::app_state::{BrowserBridgeConfig, BROWSER_BRIDGE_TOKEN_ENV, BROWSER_BRIDGE_URL_ENV};
    use crate::domain::agents::adapter::{RuntimeMcpServerConfig, RuntimeSpawnConfig};

    use super::attach_cadencr_browser_mcp;

    #[test]
    fn attach_cadencr_browser_mcp_adds_feature_pinned_stdio_server() {
        let mut config = RuntimeSpawnConfig::default();
        let db_path = std::env::current_dir()
            .expect("cwd")
            .join("cadencr.local.db")
            .to_string_lossy()
            .into_owned();

        attach_cadencr_browser_mcp(
            &mut config,
            "cadencr.local.db",
            42,
            "/bin/cadencr-service",
            Some(BrowserBridgeConfig {
                url: "http://127.0.0.1:4111/browser-bridge".to_string(),
                token: "secret".to_string(),
            }),
        )
        .expect("attach browser mcp");

        let server = config
            .mcp_servers
            .as_ref()
            .expect("mcp servers should be configured")
            .get("cadencr-browser")
            .expect("cadencr browser server should exist");
        let RuntimeMcpServerConfig::Stdio {
            command, args, env, ..
        } = server;

        assert_eq!(command, "/bin/cadencr-service");
        assert_eq!(
            args.as_ref().expect("args should be present"),
            &vec![
                "--db-path".to_string(),
                db_path,
                "mcp-serve".to_string(),
                "--agent-type".to_string(),
                "browser".to_string(),
                "--feature-id".to_string(),
                "42".to_string(),
            ]
        );
        assert_eq!(
            env.as_ref()
                .expect("bridge env should be passed")
                .get(BROWSER_BRIDGE_URL_ENV),
            Some(&"http://127.0.0.1:4111/browser-bridge".to_string())
        );
        assert_eq!(
            env.as_ref()
                .expect("bridge env should be passed")
                .get(BROWSER_BRIDGE_TOKEN_ENV),
            Some(&"secret".to_string())
        );
    }
}

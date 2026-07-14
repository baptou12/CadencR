use std::collections::HashMap;
use std::path::Path;

use serde_json::{json, Map, Value};

use crate::domain::agents::adapter::{RuntimeError, RuntimeMcpServerConfig};

const MCP_CONFIG_PATH: &str = ".cursor/mcp.json";

pub(super) async fn merge_runtime_mcp_servers(
    cwd: &Path,
    servers: Option<&HashMap<String, RuntimeMcpServerConfig>>,
) -> Result<(), RuntimeError> {
    let Some(servers) = servers.filter(|servers| !servers.is_empty()) else {
        return Ok(());
    };
    let path = cwd.join(MCP_CONFIG_PATH);
    let (existing, existing_content) = read_existing_config(&path).await?;
    let merged = merge_config(existing, servers)?;
    let serialized = serde_json::to_string_pretty(&merged)
        .map_err(|error| RuntimeError::new(format!("Cursor MCP config encode failed: {error}")))?;
    if existing_content.as_deref() == Some(serialized.as_str()) {
        return Ok(());
    }
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent).await.map_err(|error| {
            RuntimeError::new(format!("create Cursor config directory failed: {error}"))
        })?;
    }
    tokio::fs::write(&path, serialized)
        .await
        .map_err(|error| RuntimeError::new(format!("write {} failed: {error}", path.display())))
}

async fn read_existing_config(path: &Path) -> Result<(Value, Option<String>), RuntimeError> {
    match tokio::fs::read_to_string(path).await {
        Ok(content) => {
            let parsed = serde_json::from_str(&content).map_err(|error| {
                RuntimeError::new(format!("invalid {}: {error}", path.display()))
            })?;
            Ok((parsed, Some(content)))
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok((json!({}), None)),
        Err(error) => Err(RuntimeError::new(format!(
            "read {} failed: {error}",
            path.display()
        ))),
    }
}

fn merge_config(
    existing: Value,
    servers: &HashMap<String, RuntimeMcpServerConfig>,
) -> Result<Value, RuntimeError> {
    let mut root = existing
        .as_object()
        .cloned()
        .ok_or_else(|| RuntimeError::new("Cursor .cursor/mcp.json must contain a JSON object"))?;
    let mut configured = root
        .remove("mcpServers")
        .unwrap_or_else(|| json!({}))
        .as_object()
        .cloned()
        .ok_or_else(|| RuntimeError::new("Cursor mcpServers must contain a JSON object"))?;
    for (name, server) in servers {
        configured.insert(name.clone(), server_value(server));
    }
    root.insert("mcpServers".to_string(), Value::Object(configured));
    Ok(Value::Object(root))
}

fn server_value(server: &RuntimeMcpServerConfig) -> Value {
    match server {
        RuntimeMcpServerConfig::Stdio { command, args, env } => {
            let mut value = Map::new();
            value.insert("command".to_string(), Value::String(command.clone()));
            value.insert("args".to_string(), json!(args.clone().unwrap_or_default()));
            if let Some(env) = env.as_ref().filter(|env| !env.is_empty()) {
                value.insert("env".to_string(), json!(env));
            }
            Value::Object(value)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::merge_runtime_mcp_servers;
    use crate::domain::agents::adapter::RuntimeMcpServerConfig;
    use std::collections::HashMap;

    #[tokio::test]
    async fn merges_servers_without_overwriting_user_entries() {
        let cwd = tempfile::tempdir().unwrap();
        tokio::fs::create_dir_all(cwd.path().join(".cursor"))
            .await
            .unwrap();
        tokio::fs::write(
            cwd.path().join(".cursor/mcp.json"),
            r#"{"mcpServers":{"user":{"command":"user-tool"}},"keep":true}"#,
        )
        .await
        .unwrap();
        let servers = HashMap::from([(
            "cadencr-browser".to_string(),
            RuntimeMcpServerConfig::Stdio {
                command: "cadencr-service".to_string(),
                args: Some(vec!["browser-mcp".to_string()]),
                env: Some(HashMap::from([("TOKEN".to_string(), "secret".to_string())])),
            },
        )]);

        merge_runtime_mcp_servers(cwd.path(), Some(&servers))
            .await
            .unwrap();
        let value: serde_json::Value = serde_json::from_str(
            &tokio::fs::read_to_string(cwd.path().join(".cursor/mcp.json"))
                .await
                .unwrap(),
        )
        .unwrap();
        assert_eq!(value["keep"], true);
        assert_eq!(value["mcpServers"]["user"]["command"], "user-tool");
        assert_eq!(
            value["mcpServers"]["cadencr-browser"]["env"]["TOKEN"],
            "secret"
        );
    }

    #[tokio::test]
    async fn invalid_existing_config_is_user_visible_error() {
        let cwd = tempfile::tempdir().unwrap();
        tokio::fs::create_dir_all(cwd.path().join(".cursor"))
            .await
            .unwrap();
        tokio::fs::write(cwd.path().join(".cursor/mcp.json"), "not json")
            .await
            .unwrap();
        let servers = HashMap::from([(
            "tools".to_string(),
            RuntimeMcpServerConfig::Stdio {
                command: "tools".to_string(),
                args: None,
                env: None,
            },
        )]);
        let error = merge_runtime_mcp_servers(cwd.path(), Some(&servers))
            .await
            .expect_err("invalid config must not be swallowed");
        assert!(error.to_string().contains("invalid"));
    }
}

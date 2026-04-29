//! Materialize a per-worktree `opencode.json` so the shared OpenCode server
//! picks up Cadencr's MCP servers for this feature.
//!
//! OpenCode loads MCP servers from `opencode.json` files discovered by
//! walking up from the request's directory to the git root. Unlike the
//! Claude Code SDK, there is no per-session MCP attachment — config is
//! file-based and cached per directory at instance creation time.
//!
//! This module merges our `RuntimeMcpServerConfig` entries into the
//! `mcp` field of `cwd/opencode.json`, preserving unrelated keys
//! (e.g. `instructions`) and idempotent across re-spawns.

use std::collections::HashMap;
use std::io;
use std::path::Path;

use serde_json::{json, Map, Value};
use tokio::fs;

use crate::domain::agents::adapter::RuntimeMcpServerConfig;

const CONFIG_FILE: &str = "opencode.json";

/// Cadencr tools that gate on user approval. OpenCode evaluates these against
/// the permission map in `opencode.json` and emits `permission.asked` when the
/// rule is `"ask"` — see `emit_plan_approval_gate_events` in
/// `workflow::permission_router` for the corresponding intercept.
///
/// Keys must be the OpenCode-facing tool names (`<sanitized-server>_<tool>`),
/// not the canonicalised `mcp__server__tool` form — see
/// https://github.com/sst/opencode/blob/dev/packages/opencode/src/mcp/index.ts
const APPROVAL_GATE_TOOL_SUFFIXES: &[&str] = &["show_plan", "show_prd"];

/// Ensure every server in `mcp_servers` is present under the `mcp` key of
/// `cwd/opencode.json`, and that each approval-gate tool for those servers
/// has an `"ask"` rule in the `permission` map. Existing unrelated entries
/// and top-level keys are preserved. Writes are atomic (temp-file + rename)
/// to avoid the OpenCode server reading a partial file.
pub async fn ensure_worktree_opencode_config(
    cwd: &Path,
    mcp_servers: &HashMap<String, RuntimeMcpServerConfig>,
) -> io::Result<()> {
    if mcp_servers.is_empty() {
        return Ok(());
    }

    let path = cwd.join(CONFIG_FILE);
    let mut root = read_existing(&path).await?;
    let root_obj = ensure_object(&mut root);

    let mut changed = merge_mcp_entries(root_obj, mcp_servers)?;
    changed |= merge_permission_rules(root_obj, mcp_servers.keys().map(String::as_str))?;

    if !changed {
        return Ok(());
    }

    write_atomic(&path, &root).await
}

fn merge_mcp_entries(
    root_obj: &mut Map<String, Value>,
    mcp_servers: &HashMap<String, RuntimeMcpServerConfig>,
) -> io::Result<bool> {
    let mcp_entry = root_obj
        .entry("mcp")
        .or_insert_with(|| Value::Object(Map::new()));
    let mcp_obj = mcp_entry.as_object_mut().ok_or_else(|| {
        io::Error::new(
            io::ErrorKind::InvalidData,
            "existing `mcp` field in opencode.json is not an object",
        )
    })?;

    let mut changed = false;
    for (name, config) in mcp_servers {
        let new_entry = server_entry_value(config);
        match mcp_obj.get(name) {
            Some(existing) if existing == &new_entry => continue,
            _ => {
                mcp_obj.insert(name.clone(), new_entry);
                changed = true;
            }
        }
    }
    Ok(changed)
}

/// Write the approval-gate rules into the `permission` object.
///
/// OpenCode's permission evaluator uses `findLast` on the entries, so for our
/// `"<server>_show_plan": "ask"` rule to win over a broader catch-all, our
/// keys must be seen **after** that catch-all when OpenCode reads the file.
/// We rely on `serde_json::Map` (backed by `BTreeMap`) serializing keys in
/// alphabetical order: `"*"` (0x2A) and every built-in OpenCode category
/// (`bash`, `edit`, `glob`, ...) sort before any `cadencr-<server>_` key, so
/// our exact-match rules naturally land last among matching entries. This
/// fails only if a user introduces a catch-all with a key that sorts after
/// `cadencr-*` — in practice implausible, and an explicit
/// later-sorting exact rule on the same key is their stated intent anyway.
fn merge_permission_rules<'a>(
    root_obj: &mut Map<String, Value>,
    server_names: impl IntoIterator<Item = &'a str>,
) -> io::Result<bool> {
    let permission_entry = root_obj
        .entry("permission")
        .or_insert_with(|| Value::Object(Map::new()));
    let permission_obj = permission_entry.as_object_mut().ok_or_else(|| {
        io::Error::new(
            io::ErrorKind::InvalidData,
            "existing `permission` field in opencode.json is not an object",
        )
    })?;

    let target = Value::String("ask".to_string());
    let mut changed = false;
    for server_name in server_names {
        for suffix in APPROVAL_GATE_TOOL_SUFFIXES {
            let key = format!("{server_name}_{suffix}");
            if permission_obj.get(&key) == Some(&target) {
                continue;
            }
            permission_obj.insert(key, target.clone());
            changed = true;
        }
    }
    Ok(changed)
}

fn ensure_object(value: &mut Value) -> &mut Map<String, Value> {
    if !value.is_object() {
        *value = Value::Object(Map::new());
    }
    value.as_object_mut().expect("ensured above")
}

fn server_entry_value(config: &RuntimeMcpServerConfig) -> Value {
    match config {
        RuntimeMcpServerConfig::Stdio { command, args, env } => {
            let mut cmd = Vec::with_capacity(1 + args.as_ref().map_or(0, Vec::len));
            cmd.push(Value::String(command.clone()));
            if let Some(args) = args {
                cmd.extend(args.iter().cloned().map(Value::String));
            }
            let mut entry = json!({
                "type": "local",
                "command": cmd,
                "enabled": true,
            });
            if let Some(env) = env.as_ref().filter(|e| !e.is_empty()) {
                let env_map: Map<String, Value> = env
                    .iter()
                    .map(|(k, v)| (k.clone(), Value::String(v.clone())))
                    .collect();
                entry
                    .as_object_mut()
                    .expect("json object")
                    .insert("environment".to_string(), Value::Object(env_map));
            }
            entry
        }
    }
}

async fn read_existing(path: &Path) -> io::Result<Value> {
    match fs::read(path).await {
        Ok(bytes) if bytes.is_empty() => Ok(Value::Object(Map::new())),
        Ok(bytes) => serde_json::from_slice(&bytes)
            .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e)),
        Err(err) if err.kind() == io::ErrorKind::NotFound => Ok(Value::Object(Map::new())),
        Err(err) => Err(err),
    }
}

async fn write_atomic(path: &Path, value: &Value) -> io::Result<()> {
    let parent = path.parent().unwrap_or_else(|| Path::new("."));
    let tmp = path.with_extension("json.tmp");
    let serialized = serde_json::to_vec_pretty(value)
        .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;
    fs::create_dir_all(parent).await.ok();
    fs::write(&tmp, &serialized).await?;
    fs::rename(&tmp, path).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn stdio(cmd: &str, args: &[&str], env: &[(&str, &str)]) -> RuntimeMcpServerConfig {
        RuntimeMcpServerConfig::Stdio {
            command: cmd.to_string(),
            args: Some(args.iter().map(|s| (*s).to_string()).collect()),
            env: Some(
                env.iter()
                    .map(|(k, v)| ((*k).to_string(), (*v).to_string()))
                    .collect(),
            ),
        }
    }

    #[tokio::test]
    async fn writes_fresh_config_when_file_missing() {
        let dir = tempdir().unwrap();
        let mut servers = HashMap::new();
        servers.insert(
            "cadencr-plan".to_string(),
            stdio(
                "/bin/cadencr",
                &["mcp-serve", "--feature-id", "7"],
                &[("X", "1")],
            ),
        );

        ensure_worktree_opencode_config(dir.path(), &servers)
            .await
            .unwrap();

        let written: Value = serde_json::from_slice(
            &tokio::fs::read(dir.path().join("opencode.json"))
                .await
                .unwrap(),
        )
        .unwrap();
        assert_eq!(
            written,
            json!({
                "mcp": {
                    "cadencr-plan": {
                        "type": "local",
                        "command": ["/bin/cadencr", "mcp-serve", "--feature-id", "7"],
                        "enabled": true,
                        "environment": { "X": "1" }
                    }
                },
                "permission": {
                    "cadencr-plan_show_plan": "ask",
                    "cadencr-plan_show_prd": "ask"
                }
            })
        );
    }

    #[tokio::test]
    async fn preserves_unrelated_permission_entries() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("opencode.json");
        tokio::fs::write(
            &path,
            serde_json::to_vec_pretty(&json!({
                "permission": { "bash": "ask", "edit": "allow" }
            }))
            .unwrap(),
        )
        .await
        .unwrap();

        let mut servers = HashMap::new();
        servers.insert("cadencr-plan".to_string(), stdio("/bin/cadencr", &[], &[]));
        ensure_worktree_opencode_config(dir.path(), &servers)
            .await
            .unwrap();

        let written: Value =
            serde_json::from_slice(&tokio::fs::read(&path).await.unwrap()).unwrap();
        assert_eq!(written["permission"]["bash"], json!("ask"));
        assert_eq!(written["permission"]["edit"], json!("allow"));
        assert_eq!(
            written["permission"]["cadencr-plan_show_plan"],
            json!("ask")
        );
        assert_eq!(written["permission"]["cadencr-plan_show_prd"], json!("ask"));
    }

    #[tokio::test]
    async fn serialized_keys_place_cadencr_rules_after_catchall() {
        // Matters for OpenCode's `findLast` evaluator: a `"*": "allow"` entry
        // must be seen before our `"cadencr-*_show_plan": "ask"` so our rule
        // wins. Verify the alphabetical serialization we rely on.
        let dir = tempdir().unwrap();
        let path = dir.path().join("opencode.json");
        tokio::fs::write(
            &path,
            serde_json::to_vec_pretty(&json!({ "permission": { "*": "allow" } })).unwrap(),
        )
        .await
        .unwrap();

        let mut servers = HashMap::new();
        servers.insert("cadencr-plan".to_string(), stdio("/bin/cadencr", &[], &[]));
        ensure_worktree_opencode_config(dir.path(), &servers)
            .await
            .unwrap();

        let serialized = String::from_utf8(tokio::fs::read(&path).await.unwrap()).unwrap();
        let catchall_pos = serialized.find("\"*\"").expect("catch-all key present");
        let show_plan_pos = serialized
            .find("\"cadencr-plan_show_plan\"")
            .expect("show_plan key present");
        assert!(
            catchall_pos < show_plan_pos,
            "expected \"*\" to appear before \"cadencr-plan_show_plan\" for findLast to pick our rule; file was:\n{serialized}"
        );
    }

    #[tokio::test]
    async fn preserves_unrelated_top_level_keys() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("opencode.json");
        tokio::fs::write(
            &path,
            serde_json::to_vec_pretty(&json!({
                "instructions": ["AGENTS.md"],
                "mcp": {
                    "other-user-mcp": { "type": "local", "command": ["true"] }
                }
            }))
            .unwrap(),
        )
        .await
        .unwrap();

        let mut servers = HashMap::new();
        servers.insert(
            "cadencr-session".to_string(),
            stdio("/bin/cadencr", &["mcp-serve"], &[]),
        );
        ensure_worktree_opencode_config(dir.path(), &servers)
            .await
            .unwrap();

        let written: Value =
            serde_json::from_slice(&tokio::fs::read(&path).await.unwrap()).unwrap();
        assert_eq!(written["instructions"], json!(["AGENTS.md"]));
        assert_eq!(
            written["mcp"]["other-user-mcp"],
            json!({ "type": "local", "command": ["true"] })
        );
        assert_eq!(
            written["mcp"]["cadencr-session"],
            json!({ "type": "local", "command": ["/bin/cadencr", "mcp-serve"], "enabled": true })
        );
    }

    #[tokio::test]
    async fn is_idempotent_when_entry_matches() {
        let dir = tempdir().unwrap();
        let mut servers = HashMap::new();
        servers.insert("cadencr-plan".to_string(), stdio("/bin/cadencr", &[], &[]));

        ensure_worktree_opencode_config(dir.path(), &servers)
            .await
            .unwrap();
        let first_mtime = tokio::fs::metadata(dir.path().join("opencode.json"))
            .await
            .unwrap()
            .modified()
            .unwrap();

        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        ensure_worktree_opencode_config(dir.path(), &servers)
            .await
            .unwrap();
        let second_mtime = tokio::fs::metadata(dir.path().join("opencode.json"))
            .await
            .unwrap()
            .modified()
            .unwrap();

        assert_eq!(
            first_mtime, second_mtime,
            "re-running with identical config should not rewrite the file"
        );
    }

    #[tokio::test]
    async fn rejects_non_object_mcp_field() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("opencode.json");
        tokio::fs::write(&path, b"{\"mcp\": \"not-an-object\"}")
            .await
            .unwrap();

        let mut servers = HashMap::new();
        servers.insert("cadencr-plan".to_string(), stdio("/bin/cadencr", &[], &[]));
        let err = ensure_worktree_opencode_config(dir.path(), &servers)
            .await
            .unwrap_err();
        assert_eq!(err.kind(), io::ErrorKind::InvalidData);
    }

    #[tokio::test]
    async fn rejects_non_object_permission_field() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("opencode.json");
        tokio::fs::write(&path, b"{\"permission\": \"not-an-object\"}")
            .await
            .unwrap();

        let mut servers = HashMap::new();
        servers.insert("cadencr-plan".to_string(), stdio("/bin/cadencr", &[], &[]));
        let err = ensure_worktree_opencode_config(dir.path(), &servers)
            .await
            .unwrap_err();
        assert_eq!(err.kind(), io::ErrorKind::InvalidData);
    }
}

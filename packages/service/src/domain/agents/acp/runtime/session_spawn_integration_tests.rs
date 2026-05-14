use super::provider_hooks::AcpProviderHooks;
use super::{spawn_acp_runtime_session, AcpRuntimeSpawnArgs};
use crate::domain::agents::acp::AcpClientInfo;
use crate::domain::agents::adapter::{RuntimePermissionMode, RuntimeSpawnConfig};
use async_trait::async_trait;
use serde_json::Value;
use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::sync::Arc;
use tempfile::TempDir;
use tokio::process::Command;

struct SpawnHooks;

#[async_trait]
impl AcpProviderHooks for SpawnHooks {
    fn normalize_tool_name(&self, raw: &str) -> String {
        raw.to_string()
    }
    fn normalize_tool_input(&self, _: &str, input: Value) -> Value {
        input
    }
    fn mode_for_permission_mode(&self, mode: RuntimePermissionMode) -> Option<&'static str> {
        Some(if matches!(mode, RuntimePermissionMode::Plan) {
            "plan"
        } else {
            "build"
        })
    }
    fn model_config_id(&self) -> Option<&'static str> {
        Some("model")
    }
    fn thinking_effort_config_id(&self) -> Option<&'static str> {
        Some("effort")
    }
    fn default_mode_id(&self) -> Option<&'static str> {
        Some("build")
    }
}

#[tokio::test]
async fn spawn_runs_handshake_initial_config_and_prompt() {
    let temp = TempDir::new().unwrap();
    let log = temp.path().join("fake-acp.log");
    let script = temp.path().join("fake_acp.py");
    fs::write(&script, fake_agent_script(&log)).unwrap();
    fs::set_permissions(&script, fs::Permissions::from_mode(0o755)).unwrap();

    let mut command = Command::new("python3");
    command.arg(&script).kill_on_drop(true);
    let config = RuntimeSpawnConfig {
        cwd: temp.path().to_path_buf(),
        permission_mode: Some(RuntimePermissionMode::Plan),
        model: Some("openai/gpt-5.4".to_string()),
        thinking_effort: Some("high".to_string()),
        ..RuntimeSpawnConfig::default()
    };
    let mut session = spawn_acp_runtime_session(AcpRuntimeSpawnArgs {
        command,
        spawn_guard: None,
        client_info: AcpClientInfo::default(),
        config,
        initial_content: Value::String("hello".to_string()),
        context_window: Some(1000),
        hooks: Arc::new(SpawnHooks),
    })
    .await
    .unwrap();

    let mut rx = session.take_message_rx();
    let init = tokio::time::timeout(std::time::Duration::from_secs(2), rx.recv())
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    assert!(init.init().is_some());
    let result = tokio::time::timeout(std::time::Duration::from_secs(2), async {
        while let Some(event) = rx.recv().await {
            let event = event.unwrap();
            if event.is_result() {
                return true;
            }
        }
        false
    })
    .await
    .unwrap();
    assert!(result, "initial prompt should complete");
    session.close().await;

    let log = fs::read_to_string(log).unwrap();
    assert!(log.contains("initialize"));
    assert!(log.contains("session/new"));
    assert!(log.contains("session/set_mode:plan"));
    assert!(log.contains("session/set_config_option:model=openai/gpt-5.4"));
    assert!(log.contains("session/set_config_option:effort=high"));
    assert!(log.contains("session/prompt"));
}

fn fake_agent_script(log: &std::path::Path) -> String {
    format!(
        r#"import json, sys
log_path = {log_path}
def log(item):
    with open(log_path, "a", encoding="utf-8") as f:
        f.write(item + "\n")
def send(value):
    print(json.dumps(value), flush=True)
for line in sys.stdin:
    req = json.loads(line)
    method = req.get("method")
    params = req.get("params") or {{}}
    log(method)
    if method == "initialize":
        send({{"jsonrpc":"2.0","id":req["id"],"result":{{"protocolVersion":1,"agentCapabilities":{{"loadSession":False}}}}}})
    elif method == "session/new":
        send({{"jsonrpc":"2.0","id":req["id"],"result":{{"sessionId":"ses_fake","modes":{{"currentModeId":"build"}}}}}})
    elif method == "session/set_mode":
        log(method + ":" + str(params.get("modeId")))
        send({{"jsonrpc":"2.0","id":req["id"],"result":{{}}}})
    elif method == "session/set_config_option":
        log(method + ":" + str(params.get("configId")) + "=" + str(params.get("value")))
        send({{"jsonrpc":"2.0","id":req["id"],"result":{{}}}})
    elif method == "session/prompt":
        send({{"jsonrpc":"2.0","id":req["id"],"result":{{"stopReason":"end_turn"}}}})
"#,
        log_path = serde_json::to_string(&log.to_string_lossy()).unwrap()
    )
}

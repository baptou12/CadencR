use codex_app_server_sdk_rs::CodexMcpServerStatus;
use serde_json::json;

#[test]
fn codex_mcp_server_status_parses_name_auth_and_tools() {
    let status = CodexMcpServerStatus::from_value(&json!({
        "name": "cadencr-session",
        "authStatus": "unsupported",
        "tools": {
            "mark_agent_done": {},
            "read_conversation": {}
        }
    }))
    .expect("valid status");

    assert_eq!(status.name, "cadencr-session");
    assert_eq!(status.auth_status.as_deref(), Some("unsupported"));
    assert_eq!(
        status.tool_names,
        vec!["mark_agent_done", "read_conversation"]
    );
}

#[test]
fn codex_mcp_server_status_parses_tool_arrays() {
    let status = CodexMcpServerStatus::from_value(&json!({
        "name": "filesystem",
        "authStatus": "loggedIn",
        "tools": [
            { "name": "read_file" },
            "write_file"
        ]
    }))
    .expect("valid status");

    assert_eq!(status.tool_names, vec!["read_file", "write_file"]);
}

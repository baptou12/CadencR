use std::collections::HashMap;

use claude_agent_sdk_rs::{
    mcp::McpServerConfig,
    options::{Options, OptionsBuilder},
    permissions::{AllowAllTools, CanUseTool, PermissionMode, PermissionRequest, PermissionResult},
};

// ---------------------------------------------------------------------------
// PermissionMode serialization
// ---------------------------------------------------------------------------

#[test]
fn permission_mode_serializes_to_camel_case() {
    assert_eq!(
        serde_json::to_string(&PermissionMode::Plan).unwrap(),
        r#""plan""#
    );
    assert_eq!(
        serde_json::to_string(&PermissionMode::AcceptEdits).unwrap(),
        r#""acceptEdits""#
    );
    assert_eq!(
        serde_json::to_string(&PermissionMode::BypassPermissions).unwrap(),
        r#""bypassPermissions""#
    );
    assert_eq!(
        serde_json::to_string(&PermissionMode::Default).unwrap(),
        r#""default""#
    );
    assert_eq!(
        serde_json::to_string(&PermissionMode::DontAsk).unwrap(),
        r#""dontAsk""#
    );
}

#[test]
fn permission_mode_as_cli_flag() {
    assert_eq!(PermissionMode::Default.as_cli_flag(), "default");
    assert_eq!(PermissionMode::AcceptEdits.as_cli_flag(), "acceptEdits");
    assert_eq!(
        PermissionMode::BypassPermissions.as_cli_flag(),
        "bypassPermissions"
    );
    assert_eq!(PermissionMode::Plan.as_cli_flag(), "plan");
    assert_eq!(PermissionMode::DontAsk.as_cli_flag(), "dontAsk");
}

// ---------------------------------------------------------------------------
// PermissionResult serialization
// ---------------------------------------------------------------------------

#[test]
fn permission_result_allow_serializes_with_behavior_tag() {
    let result = PermissionResult::Allow {
        updated_input: None,
        updated_permissions: None,
        tool_use_id: None,
    };
    let json: serde_json::Value = serde_json::to_value(&result).unwrap();
    assert_eq!(json["behavior"], "allow");
}

#[test]
fn permission_result_deny_serializes_with_message_and_interrupt() {
    let result = PermissionResult::Deny {
        message: "not allowed".to_string(),
        interrupt: Some(true),
        tool_use_id: Some("tid-1".to_string()),
    };
    let json: serde_json::Value = serde_json::to_value(&result).unwrap();
    assert_eq!(json["behavior"], "deny");
    assert_eq!(json["message"], "not allowed");
    assert_eq!(json["interrupt"], true);
    assert_eq!(json["toolUseId"], "tid-1");
}

#[test]
fn permission_result_allow_skips_none_fields() {
    let result = PermissionResult::Allow {
        updated_input: None,
        updated_permissions: None,
        tool_use_id: None,
    };
    let json: serde_json::Value = serde_json::to_value(&result).unwrap();
    assert!(json.get("updatedInput").is_none());
    assert!(json.get("updatedPermissions").is_none());
    assert!(json.get("toolUseId").is_none());
}

#[test]
fn permission_result_allow_serializes_camel_case_fields() {
    let result = PermissionResult::Allow {
        updated_input: Some(serde_json::json!({"answer": "yes"})),
        updated_permissions: None,
        tool_use_id: Some("tu-99".to_string()),
    };
    let json: serde_json::Value = serde_json::to_value(&result).unwrap();
    // Fields must be camelCase for the CLI to recognize them
    assert_eq!(json["updatedInput"]["answer"], "yes");
    assert_eq!(json["toolUseId"], "tu-99");
    // snake_case variants must NOT be present
    assert!(json.get("updated_input").is_none());
    assert!(json.get("tool_use_id").is_none());
}

// ---------------------------------------------------------------------------
// Options defaults
// ---------------------------------------------------------------------------

#[test]
fn options_default_include_partial_messages_is_true() {
    let opts = Options::default();
    assert!(opts.include_partial_messages);
}

#[test]
fn options_default_setting_sources_has_three_entries() {
    let opts = Options::default();
    assert_eq!(opts.setting_sources.len(), 3);
    assert!(opts.setting_sources.contains(&"user".to_string()));
    assert!(opts.setting_sources.contains(&"project".to_string()));
    assert!(opts.setting_sources.contains(&"local".to_string()));
}

// ---------------------------------------------------------------------------
// Options::to_cli_args
// ---------------------------------------------------------------------------

#[test]
fn to_cli_args_always_includes_output_format() {
    let opts = Options::default();
    let args = opts.to_cli_args();
    let pos = args
        .windows(2)
        .position(|w| w[0] == "--output-format" && w[1] == "stream-json");
    assert!(pos.is_some(), "Expected --output-format stream-json in args");
}

#[test]
fn to_cli_args_includes_model_when_set() {
    let opts = OptionsBuilder::new()
        .model("claude-opus-4-5")
        .build();
    let args = opts.to_cli_args();
    let pos = args
        .windows(2)
        .position(|w| w[0] == "--model" && w[1] == "claude-opus-4-5");
    assert!(pos.is_some());
}

#[test]
fn to_cli_args_includes_resume_when_set() {
    let opts = OptionsBuilder::new()
        .resume("sess-abc-123")
        .build();
    let args = opts.to_cli_args();
    let pos = args
        .windows(2)
        .position(|w| w[0] == "--resume" && w[1] == "sess-abc-123");
    assert!(pos.is_some());
}

#[test]
fn to_cli_args_includes_permission_mode_when_set() {
    let opts = OptionsBuilder::new()
        .permission_mode(PermissionMode::Plan)
        .build();
    let args = opts.to_cli_args();
    let pos = args
        .windows(2)
        .position(|w| w[0] == "--permission-mode" && w[1] == "plan");
    assert!(pos.is_some());
}

#[test]
fn to_cli_args_omits_permission_mode_when_unset() {
    let opts = Options::default();
    let args = opts.to_cli_args();
    assert!(!args.iter().any(|a| a == "--permission-mode"));
}

#[test]
fn to_cli_args_includes_permission_prompt_tool_when_can_use_tool_set() {
    let opts = Options {
        can_use_tool: Some(Box::new(AllowAllTools)),
        ..Options::default()
    };
    let args = opts.to_cli_args();
    let pos = args
        .windows(2)
        .position(|w| w[0] == "--permission-prompt-tool" && w[1] == "stdio");
    assert!(pos.is_some(), "Expected --permission-prompt-tool stdio in args");
}

#[test]
fn to_cli_args_omits_permission_prompt_tool_when_no_can_use_tool() {
    let opts = Options::default();
    let args = opts.to_cli_args();
    assert!(!args.iter().any(|a| a == "--permission-prompt-tool"));
}

// ---------------------------------------------------------------------------
// McpServerConfig serde round-trip
// ---------------------------------------------------------------------------

#[test]
fn mcp_stdio_roundtrip() {
    let cfg = McpServerConfig::Stdio {
        command: "node".to_string(),
        args: Some(vec!["server.js".to_string()]),
        env: None,
    };
    let json = serde_json::to_string(&cfg).unwrap();
    let back: McpServerConfig = serde_json::from_str(&json).unwrap();
    assert_eq!(cfg, back);
}

#[test]
fn mcp_sse_roundtrip() {
    let mut headers = HashMap::new();
    headers.insert("Authorization".to_string(), "Bearer tok".to_string());
    let cfg = McpServerConfig::Sse {
        url: "https://example.com/sse".to_string(),
        headers: Some(headers),
    };
    let json = serde_json::to_string(&cfg).unwrap();
    let back: McpServerConfig = serde_json::from_str(&json).unwrap();
    assert_eq!(cfg, back);
}

#[test]
fn mcp_http_roundtrip() {
    let cfg = McpServerConfig::Http {
        url: "https://example.com/mcp".to_string(),
        headers: None,
    };
    let json = serde_json::to_string(&cfg).unwrap();
    let back: McpServerConfig = serde_json::from_str(&json).unwrap();
    assert_eq!(cfg, back);
}

#[test]
fn mcp_stdio_type_tag_in_json() {
    let cfg = McpServerConfig::Stdio {
        command: "python".to_string(),
        args: None,
        env: None,
    };
    let json: serde_json::Value = serde_json::to_value(&cfg).unwrap();
    assert_eq!(json["type"], "stdio");
}

// ---------------------------------------------------------------------------
// AllowAllTools
// ---------------------------------------------------------------------------

#[tokio::test]
async fn allow_all_tools_returns_allow_for_any_input() {
    let handler = AllowAllTools;
    let req = PermissionRequest {
        tool_name: "Bash".to_string(),
        input: serde_json::json!({"command": "ls"}),
        tool_use_id: "tu-1".to_string(),
        agent_id: None,
        suggestions: None,
        blocked_path: None,
        decision_reason: None,
    };
    let result = handler.can_use_tool(req).await;
    assert!(matches!(result, PermissionResult::Allow { .. }));
}

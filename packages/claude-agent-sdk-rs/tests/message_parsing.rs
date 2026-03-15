use claude_agent_sdk_rs::messages::{SdkMessage, StreamEventData, SystemMessage};
use claude_agent_sdk_rs::types::ContentDelta;
use serde_json::json;

// ── StreamEvent: content_block_delta ────────────────────────────────────────

#[test]
fn stream_event_text_delta() {
    let raw = json!({
        "type": "stream_event",
        "uuid": "u1",
        "session_id": "s1",
        "parent_tool_use_id": null,
        "event": {
            "type": "content_block_delta",
            "index": 0,
            "delta": { "type": "text_delta", "text": "hello" }
        }
    });
    let msg: SdkMessage = serde_json::from_value(raw).unwrap();
    assert!(msg.is_content_delta());
    assert_eq!(msg.session_id(), Some("s1"));
    if let SdkMessage::StreamEvent { event: StreamEventData::ContentBlockDelta { delta, .. }, .. } = &msg {
        assert!(matches!(delta, ContentDelta::TextDelta { text } if text == "hello"));
    } else {
        panic!("wrong variant");
    }
}

#[test]
fn stream_event_thinking_delta() {
    let raw = json!({
        "type": "stream_event",
        "uuid": "u2",
        "session_id": "s1",
        "parent_tool_use_id": null,
        "event": {
            "type": "content_block_delta",
            "index": 1,
            "delta": { "type": "thinking_delta", "thinking": "step 1" }
        }
    });
    let msg: SdkMessage = serde_json::from_value(raw).unwrap();
    assert!(msg.is_content_delta());
}

#[test]
fn stream_event_input_json_delta() {
    let raw = json!({
        "type": "stream_event",
        "uuid": "u3",
        "session_id": "s1",
        "parent_tool_use_id": null,
        "event": {
            "type": "content_block_delta",
            "index": 0,
            "delta": { "type": "input_json_delta", "partial_json": "{\"cmd\":" }
        }
    });
    let msg: SdkMessage = serde_json::from_value(raw).unwrap();
    assert!(msg.is_content_delta());
}

#[test]
fn stream_event_message_start() {
    let raw = json!({
        "type": "stream_event",
        "uuid": "u4",
        "session_id": "s1",
        "parent_tool_use_id": null,
        "event": {
            "type": "message_start",
            "message": { "id": "msg_1", "model": "claude-opus-4-5", "type": "message" }
        }
    });
    let msg: SdkMessage = serde_json::from_value(raw).unwrap();
    assert!(!msg.is_content_delta());
    assert!(!msg.is_turn_complete());
}

#[test]
fn stream_event_content_block_start() {
    let raw = json!({
        "type": "stream_event",
        "uuid": "u5",
        "session_id": "s1",
        "parent_tool_use_id": null,
        "event": {
            "type": "content_block_start",
            "index": 0,
            "content_block": { "type": "text", "text": "" }
        }
    });
    let msg: SdkMessage = serde_json::from_value(raw).unwrap();
    assert!(!msg.is_content_delta());
}

#[test]
fn stream_event_content_block_stop() {
    let raw = json!({
        "type": "stream_event",
        "uuid": "u6",
        "session_id": "s1",
        "parent_tool_use_id": null,
        "event": { "type": "content_block_stop", "index": 0 }
    });
    let _msg: SdkMessage = serde_json::from_value(raw).unwrap();
}

#[test]
fn stream_event_message_delta() {
    let raw = json!({
        "type": "stream_event",
        "uuid": "u7",
        "session_id": "s1",
        "parent_tool_use_id": null,
        "event": {
            "type": "message_delta",
            "delta": { "stop_reason": "end_turn" },
            "usage": { "input_tokens": 10, "output_tokens": 20 }
        }
    });
    let _msg: SdkMessage = serde_json::from_value(raw).unwrap();
}

#[test]
fn stream_event_message_stop() {
    let raw = json!({
        "type": "stream_event",
        "uuid": "u8",
        "session_id": "s1",
        "parent_tool_use_id": null,
        "event": { "type": "message_stop" }
    });
    let _msg: SdkMessage = serde_json::from_value(raw).unwrap();
}

// ── Result message ───────────────────────────────────────────────────────────

#[test]
fn result_success() {
    let raw = json!({
        "type": "result",
        "subtype": "success",
        "uuid": "r1",
        "session_id": "s1",
        "duration_ms": 1234,
        "duration_api_ms": 800,
        "is_error": false,
        "num_turns": 3,
        "result": "Done",
        "total_cost_usd": 0.002,
        "usage": { "input_tokens": 100, "output_tokens": 50 },
        "permission_denials": []
    });
    let msg: SdkMessage = serde_json::from_value(raw).unwrap();
    assert!(msg.is_turn_complete());
    assert_eq!(msg.session_id(), Some("s1"));
    if let SdkMessage::Result { subtype, usage, is_error, .. } = &msg {
        assert_eq!(subtype, "success");
        assert!(!is_error);
        assert_eq!(usage.output_tokens, 50);
    } else {
        panic!("wrong variant");
    }
    // usage() helper on Result
    assert!(msg.usage().is_some());
}

#[test]
fn result_error_max_turns() {
    let raw = json!({
        "type": "result",
        "subtype": "error_max_turns",
        "uuid": "r2",
        "session_id": "s1",
        "duration_ms": 5000,
        "duration_api_ms": 4000,
        "is_error": true,
        "num_turns": 10,
        "errors": ["Max turns reached"],
        "total_cost_usd": 0.01,
        "usage": { "input_tokens": 500, "output_tokens": 100 },
        "permission_denials": []
    });
    let msg: SdkMessage = serde_json::from_value(raw).unwrap();
    assert!(msg.is_turn_complete());
    if let SdkMessage::Result { subtype, errors, is_error, .. } = &msg {
        assert_eq!(subtype, "error_max_turns");
        assert!(is_error);
        assert_eq!(errors.as_ref().unwrap()[0], "Max turns reached");
    } else {
        panic!("wrong variant");
    }
}

// ── System init ──────────────────────────────────────────────────────────────

#[test]
fn system_init() {
    let raw = json!({
        "type": "system",
        "subtype": "init",
        "uuid": "sys1",
        "session_id": "sess_abc",
        "claude_code_version": "1.0.0",
        "cwd": "/home/user",
        "tools": ["bash", "read"],
        "mcp_servers": [],
        "model": "claude-opus-4-5",
        "permission_mode": "default",
        "slash_commands": [],
        "output_style": "streaming"
    });
    let msg: SdkMessage = serde_json::from_value(raw).unwrap();
    assert!(!msg.is_turn_complete());
    assert_eq!(msg.session_id(), Some("sess_abc"));
    assert!(!msg.is_compaction());
    if let SdkMessage::System(SystemMessage::Init { session_id, model, tools, .. }) = &msg {
        assert_eq!(session_id, "sess_abc");
        assert_eq!(model, "claude-opus-4-5");
        assert_eq!(tools[0], "bash");
    } else {
        panic!("wrong variant");
    }
}

// ── System compact_boundary ──────────────────────────────────────────────────

#[test]
fn system_compact_boundary() {
    let raw = json!({
        "type": "system",
        "subtype": "compact_boundary",
        "uuid": "cb1",
        "session_id": "sess_abc",
        "compact_metadata": { "trigger": "token_limit", "pre_tokens": 90000 }
    });
    let msg: SdkMessage = serde_json::from_value(raw).unwrap();
    assert!(msg.is_compaction());
    assert_eq!(msg.session_id(), Some("sess_abc"));
}

// ── Assistant message ────────────────────────────────────────────────────────

#[test]
fn assistant_message_with_usage() {
    let raw = json!({
        "type": "assistant",
        "uuid": "a1",
        "session_id": "s1",
        "parent_tool_use_id": null,
        "error": null,
        "message": {
            "id": "msg_1",
            "model": "claude-opus-4-5",
            "content": [{ "type": "text", "text": "Hello!" }],
            "stop_reason": "end_turn",
            "usage": { "input_tokens": 200, "output_tokens": 40 }
        }
    });
    let msg: SdkMessage = serde_json::from_value(raw).unwrap();
    assert!(!msg.is_turn_complete());
    assert!(!msg.is_content_delta());
    let usage = msg.usage().expect("should have usage");
    assert_eq!(usage.input_tokens, 200);
    assert_eq!(usage.output_tokens, 40);
}

// ── User message ─────────────────────────────────────────────────────────────

#[test]
fn user_message_with_tool_use_result() {
    let raw = json!({
        "type": "user",
        "uuid": "usr1",
        "session_id": "s1",
        "parent_tool_use_id": null,
        "message": { "role": "user", "content": "hi" },
        "tool_use_result": { "tool_use_id": "t1", "content": "ok" }
    });
    let msg: SdkMessage = serde_json::from_value(raw).unwrap();
    assert_eq!(msg.session_id(), Some("s1"));
    if let SdkMessage::User { tool_use_result, .. } = &msg {
        assert!(tool_use_result.is_some());
    } else {
        panic!("wrong variant");
    }
}

// ── Unknown type fallback ────────────────────────────────────────────────────

#[test]
fn unknown_type_falls_back_to_unknown() {
    let raw = json!({
        "type": "future_unknown_type",
        "uuid": "unk1",
        "session_id": "s1",
        "some_field": 42
    });
    let msg: SdkMessage = serde_json::from_value(raw.clone()).unwrap();
    assert!(matches!(msg, SdkMessage::Unknown(_)));
    assert_eq!(msg.session_id(), None);
    assert!(!msg.is_turn_complete());
    assert!(!msg.is_content_delta());
    assert!(msg.usage().is_none());
    assert!(!msg.is_compaction());
}

// ── Malformed JSON ───────────────────────────────────────────────────────────

#[test]
fn malformed_json_produces_error() {
    let result: Result<SdkMessage, _> = serde_json::from_str("{not valid json}");
    assert!(result.is_err());
}

// ── Helper method correctness ─────────────────────────────────────────────────

#[test]
fn helpers_on_non_matching_variants() {
    // A StreamEvent(message_stop) should NOT be is_content_delta
    let raw = json!({
        "type": "stream_event",
        "uuid": "x",
        "session_id": "s",
        "parent_tool_use_id": null,
        "event": { "type": "message_stop" }
    });
    let msg: SdkMessage = serde_json::from_value(raw).unwrap();
    assert!(!msg.is_content_delta());
    assert!(!msg.is_turn_complete());
    assert!(msg.usage().is_none());
    assert!(!msg.is_compaction());
}

// ── Serde roundtrip (Serialize + Deserialize) ─────────────────────────────────

#[test]
fn roundtrip_stream_event() {
    let raw = json!({
        "type": "stream_event",
        "uuid": "rt1",
        "session_id": "s1",
        "parent_tool_use_id": null,
        "event": {
            "type": "content_block_delta",
            "index": 0,
            "delta": { "type": "text_delta", "text": "hi" }
        }
    });
    let msg: SdkMessage = serde_json::from_value(raw).unwrap();
    let serialized = serde_json::to_string(&msg).unwrap();
    let back: SdkMessage = serde_json::from_str(&serialized).unwrap();
    assert!(back.is_content_delta());
}

#[test]
fn roundtrip_result() {
    let raw = json!({
        "type": "result",
        "subtype": "success",
        "uuid": "rt2",
        "session_id": "s1",
        "duration_ms": 100u64,
        "duration_api_ms": 80u64,
        "is_error": false,
        "num_turns": 1u64,
        "result": "ok",
        "total_cost_usd": 0.001,
        "usage": { "input_tokens": 10u64, "output_tokens": 5u64 },
        "permission_denials": []
    });
    let msg: SdkMessage = serde_json::from_value(raw).unwrap();
    let serialized = serde_json::to_string(&msg).unwrap();
    let back: SdkMessage = serde_json::from_str(&serialized).unwrap();
    assert!(back.is_turn_complete());
}

#[test]
fn roundtrip_system_init() {
    let raw = json!({
        "type": "system",
        "subtype": "init",
        "uuid": "rt3",
        "session_id": "s1",
        "claude_code_version": "1.0",
        "cwd": "/",
        "tools": [],
        "mcp_servers": [],
        "model": "claude-opus-4-5",
        "permission_mode": "default",
        "slash_commands": [],
        "output_style": "streaming"
    });
    let msg: SdkMessage = serde_json::from_value(raw).unwrap();
    let serialized = serde_json::to_string(&msg).unwrap();
    let back: SdkMessage = serde_json::from_str(&serialized).unwrap();
    assert_eq!(back.session_id(), Some("s1"));
    assert!(!back.is_compaction());
}

#[test]
fn roundtrip_system_compact_boundary() {
    let raw = json!({
        "type": "system",
        "subtype": "compact_boundary",
        "uuid": "rt4",
        "session_id": "s1",
        "compact_metadata": { "trigger": "auto", "pre_tokens": 50000u64 }
    });
    let msg: SdkMessage = serde_json::from_value(raw).unwrap();
    let serialized = serde_json::to_string(&msg).unwrap();
    let back: SdkMessage = serde_json::from_str(&serialized).unwrap();
    assert!(back.is_compaction());
}

#[test]
fn roundtrip_assistant() {
    let raw = json!({
        "type": "assistant",
        "uuid": "rt5",
        "session_id": "s1",
        "parent_tool_use_id": null,
        "error": null,
        "message": {
            "id": "m1",
            "model": "claude-opus-4-5",
            "content": [],
            "stop_reason": "end_turn",
            "usage": { "input_tokens": 1u64, "output_tokens": 1u64 }
        }
    });
    let msg: SdkMessage = serde_json::from_value(raw).unwrap();
    let serialized = serde_json::to_string(&msg).unwrap();
    let back: SdkMessage = serde_json::from_str(&serialized).unwrap();
    assert!(back.usage().is_some());
}

#[test]
fn roundtrip_user() {
    let raw = json!({
        "type": "user",
        "uuid": "rt6",
        "session_id": "s1",
        "parent_tool_use_id": null,
        "message": { "role": "user", "content": "hello" }
    });
    let msg: SdkMessage = serde_json::from_value(raw).unwrap();
    let serialized = serde_json::to_string(&msg).unwrap();
    let back: SdkMessage = serde_json::from_str(&serialized).unwrap();
    assert_eq!(back.session_id(), Some("s1"));
}

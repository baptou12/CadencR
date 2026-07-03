use serde_json::json;

use super::event_raw::raw_response_item_events;
use super::event_state::IndexState;
use crate::domain::agents::adapter::{RuntimeContentBlock, RuntimeStreamEvent};
#[test]
fn maps_raw_read_function_call_to_visible_tool_use() {
    let mut indexes = IndexState::default();
    let events = raw_response_item_events(
        json!({
            "threadId": "thread",
            "turnId": "turn",
            "item": {
                "type": "function_call",
                "call_id": "call_read",
                "name": "read_file",
                "arguments": "{\"file_path\":\"src/main.rs\"}"
            }
        }),
        &mut indexes,
    );

    let Some(RuntimeStreamEvent::ContentBlockStart { block, .. }) = events[0].stream_event() else {
        panic!("expected tool start");
    };
    let RuntimeContentBlock::ToolUse { id, name, input } = block else {
        panic!("expected tool use");
    };
    assert_eq!(id, "call_read");
    assert_eq!(name, "Read");
    assert_eq!(input["file_path"], json!("src/main.rs"));
    assert_eq!(input["raw_item"]["name"], json!("read_file"));
}

#[test]
fn suppresses_raw_bash_function_call() {
    let mut indexes = IndexState::default();
    let events = raw_response_item_events(
        json!({
            "threadId": "thread",
            "turnId": "turn",
            "item": {
                "type": "function_call",
                "call_id": "call_bash",
                "name": "exec_command",
                "arguments": "{\"command\":\"nl -ba src/lib.rs | sed -n '1,20p'\"}"
            }
        }),
        &mut indexes,
    );

    assert!(events.is_empty());

    let output_events = raw_response_item_events(
        json!({
            "threadId": "thread",
            "item": {
                "type": "function_call_output",
                "call_id": "call_bash",
                "output": "file contents"
            }
        }),
        &mut indexes,
    );
    assert!(output_events.is_empty());
}

#[test]
fn maps_raw_web_fetch_function_call_with_url_and_raw_payload() {
    let mut indexes = IndexState::default();
    let events = raw_response_item_events(
        json!({
            "threadId": "thread",
            "turnId": "turn",
            "item": {
                "type": "function_call",
                "call_id": "call_fetch",
                "name": "web_fetch",
                "arguments": "{\"url\":\"https://example.com\",\"format\":\"markdown\"}",
                "status": "completed"
            }
        }),
        &mut indexes,
    );

    let Some(RuntimeStreamEvent::ContentBlockStart { block, .. }) = events[0].stream_event() else {
        panic!("expected tool start");
    };
    let RuntimeContentBlock::ToolUse { name, input, .. } = block else {
        panic!("expected tool use");
    };
    assert_eq!(name, "WebFetch");
    assert_eq!(input["url"], json!("https://example.com"));
    assert_eq!(input["raw_item"]["status"], json!("completed"));
}

#[test]
fn dedupes_raw_tool_call_when_index_already_exists() {
    let mut indexes = IndexState::default();
    indexes.index_for("call_grep");
    let events = raw_response_item_events(
        json!({
            "threadId": "thread",
            "item": {
                "type": "function_call",
                "call_id": "call_grep",
                "name": "grep",
                "arguments": "{\"pattern\":\"foo\"}"
            }
        }),
        &mut indexes,
    );

    assert!(events.is_empty());
}

#[test]
fn aliases_response_item_id_to_call_id_for_later_dedupe() {
    let mut indexes = IndexState::default();
    let events = raw_response_item_events(
        json!({
            "threadId": "thread",
            "item": {
                "type": "function_call",
                "id": "fc_1",
                "call_id": "call_read",
                "name": "read",
                "arguments": "{\"file_path\":\"src/lib.rs\"}"
            }
        }),
        &mut indexes,
    );
    assert_eq!(events.len(), 1);
    assert!(indexes.has_index("fc_1"));

    let output_events = raw_response_item_events(
        json!({
            "threadId": "thread",
            "item": {
                "type": "function_call_output",
                "call_id": "call_read",
                "output": "ok"
            }
        }),
        &mut indexes,
    );
    assert_eq!(output_events.len(), 1);

    let duplicate_output_events = raw_response_item_events(
        json!({
            "threadId": "thread",
            "item": {
                "type": "function_call_output",
                "call_id": "call_read",
                "output": "ok"
            }
        }),
        &mut indexes,
    );
    assert!(duplicate_output_events.is_empty());
}

#[test]
fn maps_raw_custom_tool_call_input_as_json_when_possible() {
    let mut indexes = IndexState::default();
    let events = raw_response_item_events(
        json!({
            "threadId": "thread",
            "item": {
                "type": "custom_tool_call",
                "call_id": "call_glob",
                "name": "glob",
                "input": "{\"pattern\":\"**/*.rs\"}"
            }
        }),
        &mut indexes,
    );

    let Some(RuntimeStreamEvent::ContentBlockStart { block, .. }) = events[0].stream_event() else {
        panic!("expected tool start");
    };
    let RuntimeContentBlock::ToolUse { name, input, .. } = block else {
        panic!("expected tool use");
    };
    assert_eq!(name, "Glob");
    assert_eq!(input["pattern"], json!("**/*.rs"));
}

#[test]
fn spawn_agent_function_call_marks_pending_and_normalizes_name_to_agent() {
    let mut indexes = IndexState::default();
    let events = raw_response_item_events(
        json!({
            "threadId": "thread_root",
            "item": {
                "type": "function_call",
                "call_id": "call_spawn_x",
                "name": "spawn_agent",
                "arguments": "{\"agent_type\":\"default\"}"
            }
        }),
        &mut indexes,
    );
    let Some(RuntimeStreamEvent::ContentBlockStart { block, .. }) = events[0].stream_event() else {
        panic!("expected tool start");
    };
    let RuntimeContentBlock::ToolUse { name, id, .. } = block else {
        panic!("expected tool use");
    };
    assert_eq!(name, "Agent");
    assert_eq!(id, "call_spawn_x");
}

#[test]
fn function_call_output_for_spawn_agent_registers_each_agent_state_thread() {
    let mut indexes = IndexState::default();
    // First, the function_call (records pending).
    raw_response_item_events(
        json!({
            "threadId": "thread_root",
            "item": {
                "type": "function_call",
                "call_id": "call_spawn_y",
                "name": "spawn_agent",
                "arguments": "{}"
            }
        }),
        &mut indexes,
    );
    // Then the function_call_output for it carries the spawned thread(s)
    // under `output.agentsStates` — Codex can spawn multiple at once.
    raw_response_item_events(
        json!({
            "threadId": "thread_root",
            "item": {
                "type": "function_call_output",
                "call_id": "call_spawn_y",
                "output": {
                    "agentsStates": {
                        "child_thread_a": { "status": "pendingInit" },
                        "child_thread_b": { "status": "pendingInit" }
                    }
                }
            }
        }),
        &mut indexes,
    );
    assert_eq!(
        indexes.subagent_parent_tool_use_id("child_thread_a"),
        Some("call_spawn_y"),
    );
    assert_eq!(
        indexes.subagent_parent_tool_use_id("child_thread_b"),
        Some("call_spawn_y"),
    );
}

#[test]
fn function_call_output_without_spawn_pending_does_not_register_threads() {
    let mut indexes = IndexState::default();
    // A regular tool result that *happens* to have an `agentsStates`
    // shape (defensive — should not retroactively make any thread a
    // sub-agent if no spawn_agent was pending for this call_id).
    // First emit a non-spawn function_call so the call_id is known.
    raw_response_item_events(
        json!({
            "threadId": "thread_root",
            "item": {
                "type": "function_call",
                "call_id": "call_other",
                "name": "read_file",
                "arguments": "{\"file_path\":\"a\"}"
            }
        }),
        &mut indexes,
    );
    raw_response_item_events(
        json!({
            "threadId": "thread_root",
            "item": {
                "type": "function_call_output",
                "call_id": "call_other",
                "output": { "agentsStates": { "spurious_thread": {} } }
            }
        }),
        &mut indexes,
    );
    assert_eq!(indexes.subagent_parent_tool_use_id("spurious_thread"), None);
}

#[test]
fn canonicalizes_cadencr_mcp_namespace_tool_names() {
    let mut indexes = IndexState::default();
    let events = raw_response_item_events(
        json!({
            "threadId": "thread",
            "item": {
                "type": "function_call",
                "call_id": "call_session",
                "namespace": "mcp__cadencr_browser__",
                "name": "browser_screenshot",
                "arguments": "{\"feature_id\":1086}"
            }
        }),
        &mut indexes,
    );

    let Some(RuntimeStreamEvent::ContentBlockStart { block, .. }) = events[0].stream_event() else {
        panic!("expected tool start");
    };
    let RuntimeContentBlock::ToolUse { name, .. } = block else {
        panic!("expected tool use");
    };
    assert_eq!(name, "mcp__cadencr-browser__browser_screenshot");
}

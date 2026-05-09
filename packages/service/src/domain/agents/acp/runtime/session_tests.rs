//! End-to-end W10 harness for [`super::session`]. Split out via
//! `#[path = "session_tests.rs"] mod tests;` so the parent module stays
//! under the project's 400-line file ceiling. This split is the same
//! pattern used by `events.rs` / `events_tests.rs`.
//!
//! Drives a scripted ACP server through a full prompt turn (notification
//! stream + final stopReason) and asserts that any text block left open
//! at turn-end is drained BEFORE the per-turn `Result` envelope (the W4
//! drain bug).

// Note: included via `#[path = "session_tests.rs"] mod tests;` from
// `session.rs`, so `super` resolves to the `session` module. Sibling
// runtime modules live one extra level up.
use super::super::events_stream_blocks::EventIndexer;
use super::super::permissions::PendingPermissions;
use super::super::provider_hooks::AcpProviderHooks;
use super::super::server_requests::{spawn_event_loop, EventLoopConfig};
use super::super::terminal_registry::TerminalRegistry;
use super::super::turn_lifecycle::{drive_initial_prompt, PromptCancel};
use crate::domain::agents::acp::{AcpClient, AcpClientInfo};
use crate::domain::agents::adapter::{
    AgentRuntimeSession, RuntimeContentBlock, RuntimeEvent, RuntimePermissionDecision,
    RuntimePermissionMode, RuntimeStreamEvent,
};
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex as StdMutex};
use std::time::Duration;
use tokio::io::{duplex, AsyncBufReadExt, AsyncWriteExt, BufReader, DuplexStream};
use tokio::sync::{mpsc, Mutex as AsyncMutex, RwLock};

struct PlainHooks;

#[async_trait::async_trait]
impl AcpProviderHooks for PlainHooks {
    fn normalize_tool_name(&self, raw: &str) -> String {
        raw.to_string()
    }
    fn normalize_tool_input(&self, _: &str, input: Value) -> Value {
        input
    }
    fn flatten_tool_result_content(&self, blocks: &[Value]) -> Value {
        json!(blocks)
    }
    fn permission_decision_for_kind(&self, _: &str) -> RuntimePermissionDecision {
        RuntimePermissionDecision::AllowOnce
    }
    fn mode_for_permission_mode(&self, mode: RuntimePermissionMode) -> Option<&'static str> {
        Some(match mode {
            RuntimePermissionMode::Plan => "plan",
            _ => "build",
        })
    }
    fn decorate_system_prompt(&self, _: Option<&str>) -> Option<String> {
        None
    }
}

fn build_in_memory_client() -> (AcpClient, DuplexStream, BufReader<DuplexStream>) {
    let (client_reads_stdout, agent_writes_stdout) = duplex(64 * 1024);
    let (agent_reads_stdin, client_writes_stdin) = duplex(64 * 1024);
    let client = AcpClient::spawn_with_streams(
        Box::new(client_writes_stdin),
        client_reads_stdout,
        tokio::io::empty(),
        AcpClientInfo::default(),
    );
    (
        client,
        agent_writes_stdout,
        BufReader::new(agent_reads_stdin),
    )
}

async fn write_frame(stdout: &mut DuplexStream, value: Value) {
    let mut frame = serde_json::to_vec(&value).unwrap();
    frame.push(b'\n');
    stdout.write_all(&frame).await.unwrap();
}

async fn read_one_request(reader: &mut BufReader<DuplexStream>) -> Value {
    let mut line = String::new();
    reader.read_line(&mut line).await.unwrap();
    serde_json::from_str(line.trim()).unwrap()
}

/// Drives a scripted prompt turn:
/// 1. Driver thread sends `session/prompt`.
/// 2. Server pushes `tool_call` (Read), `tool_call_update` completed
///    with rawOutput, then `agent_message_chunk` (text — left OPEN).
/// 3. Server replies to `session/prompt` with `stopReason: end_turn`.
/// 4. Assertions: tool block has matching Start/Stop, text block Start
///    emitted, and a `ContentBlockStop` for the OPEN text block fires
///    BEFORE the `Result` envelope (the W4 drain assertion).
#[tokio::test]
async fn prompt_turn_lifecycle_drains_open_blocks_before_result_e2e() {
    let (client, mut agent_stdout, mut agent_stdin) = build_in_memory_client();
    let session_id = Arc::new(RwLock::new(Some("s-e2e".to_string())));
    let model = Arc::new(RwLock::new(None));
    let effort = Arc::new(RwLock::new(None));
    let mode = Arc::new(RwLock::new("build".to_string()));
    let indexer = Arc::new(StdMutex::new(EventIndexer::default()));
    let pending = PendingPermissions::default();
    let lock = Arc::new(AsyncMutex::new(()));
    let cancel = PromptCancel::new();
    let (tx, mut rx) = mpsc::channel(64);

    // Wire the event loop so `session/update` notifications get mapped
    // and forwarded to `rx` while the prompt turn is in flight.
    let event_rx = client.subscribe();
    let cfg = EventLoopConfig {
        session_id: Arc::clone(&session_id),
        current_model: Arc::clone(&model),
        current_effort: Arc::clone(&effort),
        current_mode: Arc::clone(&mode),
        cwd: PathBuf::from("/tmp"),
        closing: Arc::new(AtomicBool::new(false)),
        pending_permissions: pending,
        terminals: Arc::new(TerminalRegistry::default()),
        hooks: Arc::new(PlainHooks),
        indexer: Arc::clone(&indexer),
    };
    let _loop_handles = spawn_event_loop(client.clone(), event_rx, tx.clone(), cfg);

    // Driver: kick off the prompt turn off-thread so we can drive the wire.
    let driver = tokio::spawn({
        let client = client.clone();
        let session_id = Arc::clone(&session_id);
        let model = Arc::clone(&model);
        let effort = Arc::clone(&effort);
        let indexer = Arc::clone(&indexer);
        let lock = Arc::clone(&lock);
        let cancel = cancel.clone();
        let tx = tx.clone();
        async move {
            drive_initial_prompt(
                &client,
                &session_id,
                &model,
                &effort,
                json!("hello"),
                &tx,
                &indexer,
                None,
                &lock,
                &cancel,
            )
            .await
        }
    });

    // Read the `session/prompt` request so we know the lock is held.
    let prompt_req = read_one_request(&mut agent_stdin).await;
    assert_eq!(prompt_req["method"], "session/prompt");
    let prompt_id = prompt_req["id"].as_u64().unwrap();

    // Push notifications: tool_call (Read), tool_call_update completed
    // with rawOutput, then agent_message_chunk leaving an OPEN text block.
    write_frame(
        &mut agent_stdout,
        json!({
            "jsonrpc": "2.0",
            "method": "session/update",
            "params": {
                "sessionId": "s-e2e",
                "update": {
                    "sessionUpdate": "tool_call",
                    "toolCallId": "t-read-1",
                    "toolName": "Read",
                    "toolInput": { "path": "README.md" }
                }
            }
        }),
    )
    .await;
    write_frame(
        &mut agent_stdout,
        json!({
            "jsonrpc": "2.0",
            "method": "session/update",
            "params": {
                "sessionId": "s-e2e",
                "update": {
                    "sessionUpdate": "tool_call_update",
                    "toolCallId": "t-read-1",
                    "status": "completed",
                    "rawOutput": { "exitCode": 0, "output": "file contents" }
                }
            }
        }),
    )
    .await;
    write_frame(
        &mut agent_stdout,
        json!({
            "jsonrpc": "2.0",
            "method": "session/update",
            "params": {
                "sessionId": "s-e2e",
                "update": {
                    "sessionUpdate": "agent_message_chunk",
                    "content": { "type": "text", "text": "all done" }
                }
            }
        }),
    )
    .await;

    // Reply to `session/prompt` with end_turn — finalize_turn must drain
    // the still-open text block before emitting `Result`.
    write_frame(
        &mut agent_stdout,
        json!({ "id": prompt_id, "result": { "stopReason": "end_turn" } }),
    )
    .await;
    driver.await.unwrap().unwrap();

    // Drain rx with a timeout; collect everything up to the Result.
    let mut events: Vec<RuntimeEvent> = Vec::new();
    loop {
        let next = tokio::time::timeout(Duration::from_millis(500), rx.recv())
            .await
            .expect("timed out waiting for runtime events")
            .expect("rx channel closed");
        let event = next.expect("runtime error on stream");
        let is_result = event.is_result();
        events.push(event);
        if is_result {
            break;
        }
    }

    // --- Assertions --------------------------------------------------------
    // Tool ContentBlockStart (for `Read`).
    let tool_start = events
        .iter()
        .position(|e| {
            matches!(
                e.stream_event(),
                Some(RuntimeStreamEvent::ContentBlockStart {
                    block: RuntimeContentBlock::ToolUse { .. },
                    ..
                })
            )
        })
        .expect("expected a ToolUse ContentBlockStart");

    // Tool ContentBlockStop following the Start.
    let tool_stop = events
        .iter()
        .position(|e| {
            matches!(
                e.stream_event(),
                Some(RuntimeStreamEvent::ContentBlockStop { .. })
            )
        })
        .expect("expected a ContentBlockStop");
    assert!(
        tool_stop > tool_start,
        "tool ContentBlockStop must follow its Start"
    );

    // Streaming-text ContentBlockStart for the agent_message_chunk.
    let text_start = events
        .iter()
        .position(|e| {
            matches!(
                e.stream_event(),
                Some(RuntimeStreamEvent::ContentBlockStart {
                    block: RuntimeContentBlock::Text { .. },
                    ..
                })
            )
        })
        .expect("expected a Text ContentBlockStart for the streamed agent message");
    assert!(text_start > tool_start, "text Start follows the tool block");

    // Result is the last event (per drain loop above).
    let result_idx = events.len() - 1;
    assert!(events[result_idx].is_result(), "Result must be terminal");

    // The W4 drain assertion: there must be a `ContentBlockStop` emitted
    // AFTER the text Start and BEFORE the Result event.
    let drain_stop = events
        .iter()
        .enumerate()
        .skip(text_start + 1)
        .take_while(|(i, _)| *i < result_idx)
        .find(|(_, e)| {
            matches!(
                e.stream_event(),
                Some(RuntimeStreamEvent::ContentBlockStop { .. })
            )
        });
    assert!(
        drain_stop.is_some(),
        "W4 drain: an open text ContentBlockStop must fire \
         before the per-turn Result envelope"
    );

    // Sanity: the indexer drained — no open text block remains.
    assert!(
        indexer.lock().unwrap().current_text_index.is_none(),
        "indexer must clear current_text_index after drain"
    );

    drop(tx);
}

#[tokio::test]
async fn set_permission_mode_method_not_found_disables_future_probe_without_error() {
    let (client, mut agent_stdout, mut agent_stdin) = build_in_memory_client();
    let negotiated = super::super::lifecycle::NegotiatedSession {
        session_id: "s-mode".to_string(),
        model: None,
        mcp_servers: Vec::new(),
        context_window: None,
        current_mode: None,
    };
    let (tx, rx) = mpsc::channel(8);
    let indexer = Arc::new(StdMutex::new(EventIndexer::default()));
    let session = super::AcpRuntimeSession::assemble(
        &client,
        &negotiated,
        &crate::domain::agents::adapter::RuntimeSpawnConfig::default(),
        None,
        rx,
        tx,
        Arc::new(PlainHooks),
        indexer,
    );
    let current_mode = Arc::clone(&session.current_mode);

    let first = tokio::spawn(async move {
        session
            .set_permission_mode(RuntimePermissionMode::Plan)
            .await
    });
    let request = read_one_request(&mut agent_stdin).await;
    assert_eq!(request["method"], "session/set_mode");
    let id = request["id"].as_u64().unwrap();
    write_frame(
        &mut agent_stdout,
        json!({ "id": id, "error": { "code": -32601, "message": "method not found" } }),
    )
    .await;
    first
        .await
        .unwrap()
        .expect("MethodNotFound should be treated as unsupported capability");
    assert_eq!(current_mode.read().await.as_str(), "plan");
}

#[tokio::test]
async fn interrupt_releases_in_flight_prompt_turn_without_waiting_for_agent_reply() {
    let (client, _agent_stdout, mut agent_stdin) = build_in_memory_client();
    let negotiated = super::super::lifecycle::NegotiatedSession {
        session_id: "s-cancel".to_string(),
        model: None,
        mcp_servers: Vec::new(),
        context_window: None,
        current_mode: None,
    };
    let (tx, rx) = mpsc::channel(8);
    let mut session = super::AcpRuntimeSession::assemble(
        &client,
        &negotiated,
        &crate::domain::agents::adapter::RuntimeSpawnConfig::default(),
        None,
        rx,
        tx,
        Arc::new(PlainHooks),
        Arc::new(StdMutex::new(EventIndexer::default())),
    );
    let mut runtime_rx = session.take_message_rx();
    let session = Arc::new(session);

    let prompt = tokio::spawn({
        let session = Arc::clone(&session);
        async move { session.stream_input(json!("hello")).await }
    });
    let prompt_req = read_one_request(&mut agent_stdin).await;
    assert_eq!(prompt_req["method"], "session/prompt");

    session.interrupt().await.unwrap();
    let cancel = read_one_request(&mut agent_stdin).await;
    assert_eq!(cancel["method"], "session/cancel");

    tokio::time::timeout(Duration::from_millis(250), prompt)
        .await
        .expect("cancel should release prompt lock immediately")
        .unwrap()
        .unwrap();
    let result = runtime_rx.recv().await.unwrap().unwrap();
    assert!(result.is_result());
    assert_eq!(result.raw_json()["stop_reason"], "cancelled");
}

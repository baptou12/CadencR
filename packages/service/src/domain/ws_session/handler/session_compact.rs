use std::collections::HashSet;
use std::time::{Duration, Instant};
use axum::extract::ws::Message;
use serde_json::json;
use super::super::persistence::{SessionRow, WsSessionPersistence};
use super::super::protocol::*;
use super::{parse_session_id, send_error, QueryState, SdkSessions, WsSender};
use crate::app_state::AppState;
use crate::domain::agents::adapter::{
    RuntimeCompactMetadata, RuntimeContentBlock, RuntimeContentDelta, RuntimeEvent,
    RuntimeEventKind, RuntimeEventMetadata, RuntimeStreamEvent, RuntimeUsage,
};
use crate::domain::agents::opencode::parse_model_ref;
const OPENCODE_PROVIDER_ID: &str = "opencode";
const COMPACT_POLL_INTERVAL: Duration = Duration::from_millis(250);
const COMPACT_POLL_TIMEOUT: Duration = Duration::from_secs(15);
struct CompactTarget {
    feature_id: i64,
    runtime_session_id: String,
    directory: String,
    model_ref: opencode_sdk_rs::ModelRef,
}
fn message_has_compaction_part(message: &opencode_sdk_rs::Message) -> bool {
    message.parts.iter().any(|part| {
        matches!(
            part,
            opencode_sdk_rs::MessagePart::Other(raw)
                if raw.get("type").and_then(serde_json::Value::as_str) == Some("compaction")
        )
    })
}

fn summary_message_candidate(message: &opencode_sdk_rs::Message) -> bool {
    matches!(message.role, opencode_sdk_rs::MessageRole::Assistant)
        && message
            .parts
            .iter()
            .any(|part| matches!(part, opencode_sdk_rs::MessagePart::Text { .. } | opencode_sdk_rs::MessagePart::Thinking { .. }))
}
fn usage_from_message(message: &opencode_sdk_rs::Message) -> Option<RuntimeUsage> {
    message.tokens.as_ref().map(|tokens| RuntimeUsage {
        input_tokens: tokens.total_input(),
        output_tokens: tokens.output,
    })
}
fn compact_boundary_event(runtime_session_id: &str) -> RuntimeEvent {
    let metadata = RuntimeCompactMetadata {
        trigger: Some("manual".to_string()),
        pre_tokens: None,
    };
    RuntimeEvent::new(
        RuntimeEventMetadata {
            session_id: Some(runtime_session_id.to_string()),
            usage: None,
            context_window: None,
            raw: json!({
                "type": "system",
                "subtype": "compact_boundary",
                "session_id": runtime_session_id,
                "compact_metadata": metadata.clone(),
            }),
        },
        RuntimeEventKind::CompactBoundary {
            metadata: Some(metadata),
        },
    )
}
fn summary_stream_events(message: &opencode_sdk_rs::Message) -> Vec<RuntimeEvent> {
    let mut events = vec![RuntimeEvent::new(
        RuntimeEventMetadata {
            session_id: Some(message.session_id.clone()),
            usage: usage_from_message(message),
            context_window: None,
            raw: json!({
                "type": "stream_event",
                "session_id": message.session_id,
                "parent_tool_use_id": serde_json::Value::Null,
                "event": {
                    "type": "message_start",
                    "message": { "model": message.model.clone() },
                },
            }),
        },
        RuntimeEventKind::StreamEvent {
            event: RuntimeStreamEvent::MessageStart {
                model: message.model.clone(),
                input_tokens: None,
            },
            parent_tool_use_id: None,
        },
    )];
    let mut index: u32 = 0;
    for part in &message.parts {
        let (block, delta, raw_block, raw_delta) = match part {
            opencode_sdk_rs::MessagePart::Text { text, .. } => (
                RuntimeContentBlock::Text {
                    text: String::new(),
                },
                RuntimeContentDelta::Text { text: text.clone() },
                json!({ "type": "text", "text": "" }),
                json!({ "type": "text_delta", "text": text }),
            ),
            opencode_sdk_rs::MessagePart::Thinking { thinking, .. } => (
                RuntimeContentBlock::Thinking {
                    thinking: String::new(),
                },
                RuntimeContentDelta::Thinking {
                    thinking: thinking.clone(),
                },
                json!({ "type": "thinking", "thinking": "" }),
                json!({ "type": "thinking_delta", "thinking": thinking }),
            ),
            _ => continue,
        };

        events.push(RuntimeEvent::new(
            RuntimeEventMetadata {
                session_id: Some(message.session_id.clone()),
                usage: None,
                context_window: None,
                raw: json!({
                    "type": "stream_event",
                    "session_id": message.session_id,
                    "parent_tool_use_id": serde_json::Value::Null,
                    "event": {
                        "type": "content_block_start",
                        "index": index,
                        "content_block": raw_block,
                    },
                }),
            },
            RuntimeEventKind::StreamEvent {
                event: RuntimeStreamEvent::ContentBlockStart { index, block },
                parent_tool_use_id: None,
            },
        ));
        events.push(RuntimeEvent::new(
            RuntimeEventMetadata {
                session_id: Some(message.session_id.clone()),
                usage: None,
                context_window: None,
                raw: json!({
                    "type": "stream_event",
                    "session_id": message.session_id,
                    "parent_tool_use_id": serde_json::Value::Null,
                    "event": {
                        "type": "content_block_delta",
                        "index": index,
                        "delta": raw_delta,
                    },
                }),
            },
            RuntimeEventKind::StreamEvent {
                event: RuntimeStreamEvent::ContentBlockDelta { index, delta },
                parent_tool_use_id: None,
            },
        ));
        events.push(RuntimeEvent::new(
            RuntimeEventMetadata {
                session_id: Some(message.session_id.clone()),
                usage: None,
                context_window: None,
                raw: json!({
                    "type": "stream_event",
                    "session_id": message.session_id,
                    "parent_tool_use_id": serde_json::Value::Null,
                    "event": {
                        "type": "content_block_stop",
                        "index": index,
                    },
                }),
            },
            RuntimeEventKind::StreamEvent {
                event: RuntimeStreamEvent::ContentBlockStop { index },
                parent_tool_use_id: None,
            },
        ));
        index += 1;
    }

    events
}

fn send_runtime_event(sender: &WsSender, runtime_event: &RuntimeEvent) {
    let envelope = WsEnvelope::new(
        "session",
        "message",
        serde_json::to_value(SessionMessagePayload {
            blocks: vec![runtime_event.raw_json().clone()],
        })
        .unwrap(),
    );
    let _ = sender.send(Message::Text(String::from(envelope).into()));
}

fn resolve_compact_target(
    handle: &super::SdkHandle,
    row: Option<&SessionRow>,
) -> Result<CompactTarget, String> {
    if handle.runtime_provider != OPENCODE_PROVIDER_ID {
        return Err("/compact is only supported for OpenCode sessions".to_string());
    }

    let QueryState::Pending(options) = &handle.state else {
        return Err("Wait for the current turn to finish before using /compact".to_string());
    };

    let runtime_session_id = options
        .resume_session_id
        .clone()
        .or_else(|| handle.resume_session_id.clone())
        .or_else(|| row.and_then(|session| session.runtime_session_id.clone()))
        .ok_or_else(|| "Session has no OpenCode runtime session to compact".to_string())?;
    let model = options
        .model
        .clone()
        .or_else(|| handle.desired_model.clone())
        .or_else(|| handle.spawned_model.clone())
        .or_else(|| row.and_then(|session| session.model.clone()))
        .ok_or_else(|| "Session model is unavailable for compaction".to_string())?;
    let Some(model_ref) = parse_model_ref(&model) else {
        return Err("Session model is unavailable for compaction".to_string());
    };
    if model_ref.provider_id == "default" || model_ref.model_id.is_empty() {
        return Err(format!("OpenCode compaction requires a provider/model ref, got '{model}'"));
    }

    Ok(CompactTarget {
        feature_id: handle.feature_id,
        runtime_session_id,
        directory: handle.config.cwd.to_string_lossy().to_string(),
        model_ref,
    })
}

async fn await_compaction_messages(
    client: &opencode_sdk_rs::OpenCodeClient,
    runtime_session_id: &str,
    existing_ids: &HashSet<String>,
) -> Result<Vec<opencode_sdk_rs::Message>, String> {
    let started = Instant::now();
    loop {
        let messages = client
            .list_messages(runtime_session_id)
            .await
            .map_err(|error| format!("Failed to load summarized messages: {error}"))?;
        let fresh: Vec<opencode_sdk_rs::Message> = messages
            .into_iter()
            .filter(|message| !existing_ids.contains(&message.id))
            .collect();
        if fresh.iter().any(message_has_compaction_part)
            && fresh.iter().any(summary_message_candidate)
        {
            return Ok(fresh);
        }
        if started.elapsed() >= COMPACT_POLL_TIMEOUT {
            return Err("OpenCode did not return a compaction summary in time".to_string());
        }
        tokio::time::sleep(COMPACT_POLL_INTERVAL).await;
    }
}

async fn persist_and_forward_compaction(
    app_state: &AppState,
    sender: &WsSender,
    db_session_id: i64,
    feature_id: i64,
    runtime_session_id: &str,
    messages: &[opencode_sdk_rs::Message],
) -> Result<(), String> {
    let summary = messages
        .iter()
        .rev()
        .find(|message| summary_message_candidate(message))
        .ok_or_else(|| "OpenCode returned no summary message for the compaction".to_string())?;

    let mut persistence = WsSessionPersistence::with_session_id(
        app_state.write_pool.clone(),
        feature_id,
        Some(db_session_id),
    );
    let boundary = compact_boundary_event(runtime_session_id);
    persistence.persist_runtime_event(&boundary).await;
    send_runtime_event(sender, &boundary);

    for event in summary_stream_events(summary) {
        persistence.persist_runtime_event(&event).await;
        send_runtime_event(sender, &event);
    }

    Ok(())
}

/// Handle session.compact: trigger an OpenCode compaction and replay the
/// resulting divider + summary into Cadence's conversation history.
pub(super) async fn handle_compact(
    envelope: WsEnvelope,
    sender: &WsSender,
    sdk_sessions: &SdkSessions,
    app_state: &AppState,
) {
    let payload: SessionActionPayload = match serde_json::from_value(envelope.payload.clone()) {
        Ok(payload) => payload,
        Err(error) => {
            send_error(sender, &envelope.id, "INVALID_PAYLOAD", &error.to_string());
            return;
        }
    };

    let db_session_id = match parse_session_id(&payload.session_id) {
        Some(id) => id,
        None => {
            send_error(
                sender,
                &envelope.id,
                "INVALID_SESSION_ID",
                "Invalid session_id",
            );
            return;
        }
    };

    let session_row =
        WsSessionPersistence::get_session_row(&app_state.read_pool, db_session_id).await;
    let target = {
        let sessions = sdk_sessions.lock().await;
        let Some(handle) = sessions.get(&db_session_id) else {
            send_error(sender, &envelope.id, "SESSION_NOT_FOUND", "Session not found");
            return;
        };
        match resolve_compact_target(handle, session_row.as_ref()) {
            Ok(target) => target,
            Err(message) => {
                send_error(sender, &envelope.id, "INVALID_STATE", &message);
                return;
            }
        }
    };

    let client = match opencode_sdk_rs::OpenCodeClient::init().await {
        Ok(client) => client,
        Err(error) => {
            send_error(sender, &envelope.id, "SDK_ERROR", &error.to_string());
            return;
        }
    };

    let existing_messages = match client.list_messages(&target.runtime_session_id).await {
        Ok(messages) => messages,
        Err(error) => {
            send_error(sender, &envelope.id, "SDK_ERROR", &error.to_string());
            return;
        }
    };
    let existing_ids: HashSet<String> =
        existing_messages.into_iter().map(|message| message.id).collect();

    if let Err(error) = client
        .summarize_session_in_directory(
            &target.runtime_session_id,
            Some(&target.directory),
            &target.model_ref,
            false,
        )
        .await
    {
        send_error(sender, &envelope.id, "SDK_ERROR", &error.to_string());
        return;
    }

    let messages = match await_compaction_messages(&client, &target.runtime_session_id, &existing_ids).await {
        Ok(messages) => messages,
        Err(message) => {
            send_error(sender, &envelope.id, "SDK_ERROR", &message);
            return;
        }
    };

    if let Err(message) = persist_and_forward_compaction(
        app_state,
        sender,
        db_session_id,
        target.feature_id,
        &target.runtime_session_id,
        &messages,
    )
    .await
    {
        send_error(sender, &envelope.id, "SDK_ERROR", &message);
        return;
    }

    let reply = WsEnvelope::reply(
        &envelope.id,
        "session",
        "compact.ok",
        serde_json::Value::Null,
    );
    let _ = sender.send(Message::Text(String::from(reply).into()));
}

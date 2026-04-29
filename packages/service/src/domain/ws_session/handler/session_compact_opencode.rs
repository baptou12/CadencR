use std::collections::HashSet;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use axum::extract::ws::Message;
use serde_json::json;

use super::super::persistence::{SessionRow, WsSessionPersistence};
use super::super::protocol::*;
use super::session_compact_opencode_events::summary_stream_events;
use super::{send_error, QueryState, SdkSessions, WsSender};
use crate::app_state::AppState;
use crate::domain::agents::adapter::{
    RuntimeCompactMetadata, RuntimeEvent, RuntimeEventKind, RuntimeEventMetadata,
};
use crate::domain::agents::opencode::parse_model_ref;

const COMPACT_POLL_INTERVAL: Duration = Duration::from_millis(250);
const COMPACT_POLL_MAX_INTERVAL: Duration = Duration::from_secs(2);
const COMPACT_POLL_TIMEOUT: Duration = Duration::from_secs(120);

struct CompactTarget {
    feature_id: i64,
    runtime_session_id: String,
    directory: String,
    model_ref: opencode_sdk_rs::ModelRef,
    runtime_control_endpoint: Option<String>,
    cancel: Arc<AtomicBool>,
}

struct CompactError {
    code: &'static str,
    message: String,
}

pub(super) async fn handle_opencode_compact(
    envelope_id: &str,
    sender: &WsSender,
    sdk_sessions: &SdkSessions,
    app_state: &AppState,
    db_session_id: i64,
    session_row: Option<&SessionRow>,
) {
    match run_opencode_compact(sender, sdk_sessions, app_state, db_session_id, session_row).await {
        Ok(()) => send_compact_ok(envelope_id, sender),
        Err(error) => send_error(sender, envelope_id, error.code, &error.message),
    }
}

async fn run_opencode_compact(
    sender: &WsSender,
    sdk_sessions: &SdkSessions,
    app_state: &AppState,
    db_session_id: i64,
    session_row: Option<&SessionRow>,
) -> Result<(), CompactError> {
    let target = {
        let sessions = sdk_sessions.lock().await;
        let handle = sessions
            .get(&db_session_id)
            .ok_or_else(|| compact_error("SESSION_NOT_FOUND", "Session not found"))?;
        handle.manual_compact_cancel.store(false, Ordering::SeqCst);
        resolve_compact_target(handle, session_row)
            .map_err(|message| compact_error("INVALID_STATE", message))?
    };

    let client = match target.runtime_control_endpoint.as_deref() {
        Some(base_url) => opencode_sdk_rs::OpenCodeClient::with_base_url(base_url),
        None => opencode_sdk_rs::OpenCodeClient::init()
            .await
            .map_err(sdk_error)?,
    };

    let existing_messages = client
        .list_messages(&target.runtime_session_id)
        .await
        .map_err(sdk_error)?;
    let existing_ids = existing_messages
        .into_iter()
        .map(|message| message.id)
        .collect::<HashSet<_>>();

    client
        .summarize_session_in_directory(
            &target.runtime_session_id,
            Some(&target.directory),
            &target.model_ref,
            false,
        )
        .await
        .map_err(sdk_error)?;

    let messages = await_compaction_messages(
        sender,
        &client,
        &target.runtime_session_id,
        &existing_ids,
        &target.cancel,
    )
    .await
    .map_err(|message| compact_error("SDK_ERROR", message))?;

    persist_and_forward_compaction(
        app_state,
        sender,
        db_session_id,
        target.feature_id,
        &target.runtime_session_id,
        &messages,
    )
    .await
    .map_err(|message| compact_error("SDK_ERROR", message))?;

    Ok(())
}

fn compact_error(code: &'static str, message: impl Into<String>) -> CompactError {
    CompactError {
        code,
        message: message.into(),
    }
}

fn sdk_error(error: opencode_sdk_rs::SdkError) -> CompactError {
    compact_error("SDK_ERROR", error.to_string())
}

fn resolve_compact_target(
    handle: &super::SdkHandle,
    row: Option<&SessionRow>,
) -> Result<CompactTarget, String> {
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
        return Err(format!(
            "OpenCode compaction requires a provider/model ref, got '{model}'"
        ));
    }

    Ok(CompactTarget {
        feature_id: handle.feature_id,
        runtime_session_id,
        directory: handle.config.cwd.to_string_lossy().to_string(),
        model_ref,
        runtime_control_endpoint: handle.runtime_control_endpoint.clone(),
        cancel: Arc::clone(&handle.manual_compact_cancel),
    })
}

async fn await_compaction_messages(
    sender: &WsSender,
    client: &opencode_sdk_rs::OpenCodeClient,
    runtime_session_id: &str,
    existing_ids: &HashSet<String>,
    cancel: &AtomicBool,
) -> Result<Vec<opencode_sdk_rs::Message>, String> {
    let started = Instant::now();
    let mut poll_interval = COMPACT_POLL_INTERVAL;
    loop {
        if cancel.load(Ordering::SeqCst) {
            return Err("OpenCode compaction was interrupted".to_string());
        }
        if sender.is_closed() {
            return Err("OpenCode compaction cancelled because the websocket closed".to_string());
        }
        let messages = client
            .list_messages(runtime_session_id)
            .await
            .map_err(|error| format!("Failed to load summarized messages: {error}"))?;
        let fresh = messages
            .into_iter()
            .filter(|message| !existing_ids.contains(&message.id))
            .collect::<Vec<_>>();
        if fresh.iter().any(message_has_compaction_part)
            && fresh.iter().any(summary_message_candidate)
        {
            return Ok(fresh);
        }
        if started.elapsed() >= COMPACT_POLL_TIMEOUT {
            return Err("OpenCode did not return a compaction summary in time".to_string());
        }
        tokio::time::sleep(poll_interval).await;
        poll_interval = (poll_interval + COMPACT_POLL_INTERVAL).min(COMPACT_POLL_MAX_INTERVAL);
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
        && message.parts.iter().any(|part| {
            matches!(
                part,
                opencode_sdk_rs::MessagePart::Text { .. }
                    | opencode_sdk_rs::MessagePart::Thinking { .. }
            )
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

fn send_compact_ok(envelope_id: &str, sender: &WsSender) {
    let reply = WsEnvelope::reply(
        envelope_id,
        "session",
        "compact.ok",
        serde_json::Value::Null,
    );
    let _ = sender.send(Message::Text(String::from(reply).into()));
}

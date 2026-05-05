use std::collections::HashSet;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use axum::extract::ws::Message;
use serde_json::json;

use super::super::persistence::{
    raw_event_with_agent_message_id, PersistedMessageRef, SessionRow, WsSessionPersistence,
};
use super::super::protocol::*;
use super::session_compact_opencode_events::summary_stream_events;
use super::session_compact_opencode_poll::{await_compaction_messages, summary_message_candidate};
use super::{send_error, QueryState, SdkSessions, WsSender};
use crate::app_state::AppState;
use crate::domain::agents::adapter::{
    RuntimeCompactMetadata, RuntimeEvent, RuntimeEventKind, RuntimeEventMetadata,
};
use crate::domain::agents::opencode::parse_model_ref;

#[derive(Debug)]
struct CompactTarget {
    feature_id: i64,
    runtime_session_id: String,
    directory: String,
    model_ref: opencode_sdk_rs::ModelRef,
    runtime_control_endpoint: Option<String>,
    cancel: Arc<AtomicBool>,
    running: Arc<AtomicBool>,
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
        begin_compact_target(handle, session_row)
            .map_err(|message| compact_error("INVALID_STATE", message))?
    };
    let _running = CompactRunGuard(Arc::clone(&target.running));

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
        running: Arc::clone(&handle.manual_compact_running),
    })
}

fn begin_compact_target(
    handle: &super::SdkHandle,
    row: Option<&SessionRow>,
) -> Result<CompactTarget, String> {
    handle
        .manual_compact_running
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .map_err(|_| "A manual OpenCode compaction is already running".to_string())?;
    handle.manual_compact_cancel.store(false, Ordering::SeqCst);
    match resolve_compact_target(handle, row) {
        Ok(target) => Ok(target),
        Err(error) => {
            handle.manual_compact_running.store(false, Ordering::SeqCst);
            Err(error)
        }
    }
}

struct CompactRunGuard(Arc<AtomicBool>);

impl Drop for CompactRunGuard {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
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
    let persisted_boundary = persistence.persist_runtime_event(&boundary).await;
    send_runtime_event(sender, &boundary, persisted_boundary);

    for event in summary_stream_events(summary) {
        let persisted_event = persistence.persist_runtime_event(&event).await;
        send_runtime_event(sender, &event, persisted_event);
    }

    Ok(())
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

fn send_runtime_event(
    sender: &WsSender,
    runtime_event: &RuntimeEvent,
    persisted_message: Option<PersistedMessageRef>,
) {
    let envelope = WsEnvelope::new(
        "session",
        "message",
        serde_json::to_value(SessionMessagePayload {
            blocks: vec![raw_event_with_agent_message_id(
                runtime_event.raw_json(),
                persisted_message,
            )],
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

#[cfg(test)]
mod tests {
    use std::collections::HashSet;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Arc;

    use tokio::sync::{mpsc, Mutex};

    use super::{begin_compact_target, resolve_compact_target, QueryState};
    use crate::domain::agents::adapter::{
        AgentRuntimeSession, RuntimeError, RuntimeMessageRx, RuntimePermissionMode,
    };
    use crate::domain::ws_session::handler::{SdkHandle, SessionConfig};

    struct DummySession;

    #[async_trait::async_trait]
    impl AgentRuntimeSession for DummySession {
        fn take_message_rx(&mut self) -> RuntimeMessageRx {
            let (_tx, rx) = mpsc::channel(1);
            rx
        }

        async fn session_id(&self) -> Option<String> {
            None
        }

        async fn stream_input(&self, _content: serde_json::Value) -> Result<(), RuntimeError> {
            Ok(())
        }

        async fn interrupt(&self) -> Result<(), RuntimeError> {
            Ok(())
        }

        async fn close(&mut self) {}

        async fn set_model(&self, _model: &str) -> Result<(), RuntimeError> {
            Ok(())
        }

        async fn set_permission_mode(
            &self,
            _mode: RuntimePermissionMode,
        ) -> Result<(), RuntimeError> {
            Ok(())
        }

        fn pid(&self) -> Option<u32> {
            None
        }
    }

    fn pending_handle() -> SdkHandle {
        SdkHandle {
            state: QueryState::Pending(crate::domain::agents::adapter::RuntimeSpawnConfig {
                cwd: PathBuf::from("/tmp/project"),
                model: Some("openai/gpt-5.5".to_string()),
                resume_session_id: Some("ses_123".to_string()),
                permission_mode: Some(RuntimePermissionMode::Default),
                ..Default::default()
            }),
            feature_id: 1,
            runtime_provider: crate::domain::agents::opencode::PROVIDER_ID.to_string(),
            desired_model: Some("openai/gpt-5.5".to_string()),
            spawned_model: Some("openai/gpt-5.5".to_string()),
            desired_permission_mode: None,
            spawned_permission_mode: None,
            desired_thinking_effort: None,
            spawned_thinking_effort: None,
            runtime_control_endpoint: Some("http://127.0.0.1:4096".to_string()),
            manual_compact_running: Arc::new(AtomicBool::new(false)),
            session_cache: Arc::new(Mutex::new(HashSet::new())),
            allowed_patterns: Arc::new(HashSet::new()),
            resume_session_id: None,
            config: SessionConfig {
                cwd: PathBuf::from("/tmp/project"),
                canonical_cwd: PathBuf::from("/tmp/project"),
                permission_mode: None,
                thinking_effort: None,
                system_prompt: None,
                env: None,
            },
            manual_compact_cancel: Arc::new(AtomicBool::new(false)),
        }
    }

    #[test]
    fn resolve_compact_target_requires_pending_session() {
        let mut handle = pending_handle();
        handle.state = QueryState::Active {
            query: Arc::new(Mutex::new(Box::new(DummySession))),
            permission_tx: mpsc::channel(1).0,
        };

        let error = resolve_compact_target(&handle, None).expect_err("active turn should fail");
        assert!(error.contains("Wait for the current turn"));
    }

    #[test]
    fn begin_compact_target_rejects_concurrent_manual_compaction() {
        let handle = pending_handle();
        let target = begin_compact_target(&handle, None).expect("first compact should start");
        assert!(target.running.load(Ordering::SeqCst));

        let error = begin_compact_target(&handle, None).expect_err("second compact should fail");
        assert!(error.contains("already running"));
        target.running.store(false, Ordering::SeqCst);
    }
}

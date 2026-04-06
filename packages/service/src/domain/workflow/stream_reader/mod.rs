//! Background stream reader for workflow agents.
//!
//! Reads SDK messages from a spawned Claude agent, persists them, forwards
//! them to the frontend via WebSocket, and triggers engine callbacks on
//! completion or error.

mod cleanup;
mod live_refresh;

use std::sync::Arc;

use dashmap::DashMap;
use sqlx::SqlitePool;
use tokio::sync::mpsc;
use tracing::{debug, error, info, warn};

use axum::extract::ws::Message;
use claude_agent_sdk_rs::{Query, SdkError, SdkMessage, SystemMessage};

use crate::domain::features::repository as repo;
use crate::domain::workflow::engine::{to_value, AgentSlot, WsSender};
use crate::domain::ws_session::persistence::WsSessionPersistence;
use crate::domain::ws_session::protocol::*;

use cleanup::{broadcast_usage, build_stream_envelope, check_mcp_server_connected, post_stream_cleanup};
use live_refresh::handle_live_refresh;

/// Spawn a background task that reads agent stream messages and forwards them
/// via the workflow domain, then triggers engine callbacks on completion/error.
pub fn spawn_workflow_stream_reader(
    slot: AgentSlot,
    db_session_id: i64,
    feature_id: i64,
    expected_mcp_server: String,
    mut message_rx: mpsc::Receiver<Result<SdkMessage, SdkError>>,
    sender: WsSender,
    write_pool: SqlitePool,
    active_items: Arc<DashMap<AgentSlot, i64>>,
    queries: Arc<DashMap<AgentSlot, Arc<tokio::sync::Mutex<Query>>>>,
    paused_sessions: Arc<DashMap<AgentSlot, String>>,
    model: Option<&str>,
    turn_state_tx: tokio::sync::broadcast::Sender<crate::app_state::TurnStateEvent>,
) {
    let initial_context_window = model
        .map(|m| crate::domain::usage::context_window_for_model(m))
        .unwrap_or(crate::api::DEFAULT_CONTEXT_WINDOW);

    tokio::spawn(async move {
        debug!(slot = %slot, db_session_id, "workflow stream reader started");

        let phase_slug: Option<String> = if let AgentSlot::QueueItem(item_id) = &slot {
            repo::get_queue_item(&write_pool, *item_id)
                .await
                .ok()
                .flatten()
                .map(|qi| qi.item_type)
        } else {
            None
        };

        let mut persistence = WsSessionPersistence::with_session_id(
            write_pool.clone(),
            feature_id,
            Some(db_session_id),
        );
        let mut completed_ok = false;
        let mut agent_done_called = false;
        let mut error_msg: Option<String> = None;
        let mut ws_detached = false;
        let mut needs_session_id_capture = true;
        let mut context_window: u64 = initial_context_window;
        let mut pending_feature_update: Option<Vec<&'static str>> = None;
        let mut pending_queue_update = false;

        loop {
            // Use a short timeout on recv so we can periodically check if
            // the WS sender was detached (page refresh / disconnect).
            let recv_result = tokio::time::timeout(
                std::time::Duration::from_millis(500),
                message_rx.recv(),
            ).await;

            // Check if WS was detached — interrupt agent for clean resume on reconnect.
            if !sender.is_attached() {
                info!(slot = %slot, "WS sender detached — interrupting agent for clean resume on reconnect");
                interrupt_and_pause(&slot, db_session_id, &queries, &paused_sessions, &write_pool).await;
                ws_detached = true;
                break;
            }

            // Timeout — loop back and check sender again
            let msg = match recv_result {
                Ok(msg) => msg,
                Err(_) => continue,
            };

            match msg {
                Some(Ok(sdk_msg)) => {
                    capture_session_id(&sdk_msg, &mut needs_session_id_capture, &slot, db_session_id, &sender, &write_pool).await;

                    if let SdkMessage::System(SystemMessage::Init { ref mcp_servers, ref tools, ref model, .. }) = sdk_msg {
                        context_window = crate::domain::usage::context_window_for_model(model);
                        WsSessionPersistence::update_context_window(&write_pool, db_session_id, context_window).await;
                        debug!(slot = %slot, %model, context_window, ?mcp_servers, tool_count = tools.len(), "received init message from CLI");
                        if !check_mcp_server_connected(&slot, db_session_id, &expected_mcp_server, mcp_servers, &sender, &write_pool, &queries).await {
                            error_msg = Some(format!(
                                "MCP server '{}' failed to connect. The agent cannot function without its tools.",
                                expected_mcp_server
                            ));
                            break;
                        }
                    }

                    persistence.persist_sdk_message(&sdk_msg).await;
                    broadcast_usage(&sdk_msg, &slot, db_session_id, context_window, &sender, &write_pool).await;

                    let envelope = build_stream_envelope(&sdk_msg, &slot, db_session_id, &mut completed_ok, &mut agent_done_called, &write_pool).await;

                    if sender.send(Message::Text(String::from(envelope).into())).is_err() {
                        info!(slot = %slot, "WS sender channel error — interrupting agent for clean resume");
                        interrupt_and_pause(&slot, db_session_id, &queries, &paused_sessions, &write_pool).await;
                        ws_detached = true;
                        break;
                    }

                    if completed_ok {
                        debug!(slot = %slot, "breaking out of stream loop after Result");
                        break;
                    }

                    handle_live_refresh(&sdk_msg, feature_id, phase_slug.as_deref(), &sender, &write_pool, &mut agent_done_called, &mut pending_feature_update, &mut pending_queue_update).await;
                }
                Some(Err(e)) => {
                    error_msg = Some(handle_stream_error(&e, &slot, db_session_id, &sender, &write_pool).await);
                    break;
                }
                None => {
                    if !completed_ok {
                        warn!(slot = %slot, "workflow SDK stream closed unexpectedly without result");
                        error_msg = Some("Agent stream closed unexpectedly without result".to_string());
                    }
                    break;
                }
            }
        }

        post_stream_cleanup(slot, db_session_id, feature_id, completed_ok, agent_done_called, error_msg, ws_detached, &write_pool, &active_items, &queries, &paused_sessions, &turn_state_tx).await;
    });
}

/// Interrupt the agent and persist paused state for clean resume on reconnect.
async fn interrupt_and_pause(
    slot: &AgentSlot,
    db_session_id: i64,
    queries: &Arc<DashMap<AgentSlot, Arc<tokio::sync::Mutex<Query>>>>,
    paused_sessions: &Arc<DashMap<AgentSlot, String>>,
    write_pool: &SqlitePool,
) {
    if let Some(query_arc) = queries.get(slot) {
        let q = query_arc.lock().await;
        if let Some(cc_sid) = q.session_id().await {
            paused_sessions.insert(slot.clone(), cc_sid.clone());
            WsSessionPersistence::persist_claude_session_id_static(write_pool, db_session_id, &cc_sid).await;
        }
        let _ = q.interrupt().await;
    }
    WsSessionPersistence::mark_paused_static(write_pool, db_session_id).await;
}

/// Handle an SDK stream error: log, mark paused, and send error envelope.
async fn handle_stream_error(
    e: &claude_agent_sdk_rs::SdkError,
    slot: &AgentSlot,
    db_session_id: i64,
    sender: &WsSender,
    write_pool: &SqlitePool,
) -> String {
    error!(slot = %slot, error = %e, "workflow SDK stream error");
    WsSessionPersistence::mark_paused_static(write_pool, db_session_id).await;
    let err_env = WsEnvelope::new(
        "workflow",
        "agent_stream",
        to_value(WorkflowAgentStreamErrorPayload {
            agent_slot: slot.clone(),
            session_id: db_session_id,
            msg_type: "error".into(),
            error: e.to_string(),
        }),
    );
    let _ = sender.send(Message::Text(String::from(err_env).into()));
    e.to_string()
}

/// Capture the claude_session_id from the first message that has one.
async fn capture_session_id(
    sdk_msg: &SdkMessage,
    needs_capture: &mut bool,
    slot: &AgentSlot,
    db_session_id: i64,
    sender: &WsSender,
    write_pool: &SqlitePool,
) {
    if !*needs_capture {
        return;
    }
    let Some(cli_sid) = sdk_msg.session_id() else { return };
    if cli_sid.is_empty() {
        return;
    }
    *needs_capture = false;
    debug!(slot = %slot, db_session_id, claude_session_id = %cli_sid, "persisting CLI session_id to DB");
    WsSessionPersistence::persist_claude_session_id_static(write_pool, db_session_id, cli_sid).await;
    let sid_env = WsEnvelope::new(
        "workflow",
        "agent_session_id",
        serde_json::json!({
            "agent_slot": &slot,
            "session_id": db_session_id,
            "claude_session_id": cli_sid,
        }),
    );
    let _ = sender.send(Message::Text(String::from(sid_env).into()));
}

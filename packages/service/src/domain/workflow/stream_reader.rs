//! Background stream reader for workflow agents.
//!
//! Reads SDK messages from a spawned Claude agent, persists them, forwards
//! them to the frontend via WebSocket, and triggers engine callbacks on
//! completion or error.

use std::sync::Arc;

use dashmap::DashMap;
use sqlx::SqlitePool;
use tokio::sync::mpsc;
use tracing::{debug, error, info, warn};

use axum::extract::ws::Message;
use claude_agent_sdk_rs::{Query, SdkError, SdkMessage, SystemMessage};

use crate::domain::features::repository as repo;
use crate::domain::workflow::engine::{send_feature_updated_envelope, to_value, AgentSlot, WsSender};
use crate::domain::ws_session::persistence::WsSessionPersistence;
use crate::domain::ws_session::protocol::*;

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
    model: Option<&str>,
) {
    let initial_context_window = model
        .map(|m| crate::domain::usage::context_window_for_model(m))
        .unwrap_or(crate::api::DEFAULT_CONTEXT_WINDOW);
    tokio::spawn(async move {
        debug!(slot = %slot, db_session_id, "workflow stream reader started");
        let mut persistence = WsSessionPersistence::with_session_id(
            write_pool.clone(),
            feature_id,
            Some(db_session_id),
        );
        let mut completed_ok = false;
        let mut agent_done_called = false;
        let mut error_msg: Option<String> = None;
        let mut needs_session_id_capture = true;
        let mut context_window: u64 = initial_context_window;
        let mut pending_feature_update: Option<Vec<&'static str>> = None;
        let mut pending_queue_update = false;

        loop {
            match message_rx.recv().await {
                Some(Ok(sdk_msg)) => {
                    // Capture claude_session_id from the first message
                    if needs_session_id_capture {
                        if let Some(cli_sid) = sdk_msg.session_id() {
                            if !cli_sid.is_empty() {
                                needs_session_id_capture = false;
                                debug!(slot = %slot, db_session_id, claude_session_id = %cli_sid, "persisting CLI session_id to DB");
                                WsSessionPersistence::persist_claude_session_id_static(
                                    &write_pool, db_session_id, cli_sid,
                                ).await;
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
                        }
                    }

                    // Check MCP server status on init and capture context window from model
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

                    // Persist message
                    persistence.persist_sdk_message(&sdk_msg).await;

                    // Extract and broadcast usage
                    broadcast_usage(&sdk_msg, &slot, db_session_id, context_window, &sender, &write_pool).await;

                    let envelope = build_stream_envelope(&sdk_msg, &slot, db_session_id, &mut completed_ok, &mut agent_done_called, &write_pool).await;

                    if sender.send(Message::Text(String::from(envelope).into())).is_err() {
                        warn!(slot = %slot, "WS sender closed, stopping workflow stream reader");
                        break;
                    }

                    if completed_ok {
                        debug!(slot = %slot, "breaking out of stream loop after Result");
                        break;
                    }

                    // Live-refresh: detect plan/phase-modifying tool calls
                    handle_live_refresh(&sdk_msg, &slot, feature_id, &sender, &write_pool, &mut agent_done_called, &mut pending_feature_update, &mut pending_queue_update).await;
                }
                Some(Err(e)) => {
                    error!(slot = %slot, error = %e, "workflow SDK stream error");
                    error_msg = Some(e.to_string());
                    WsSessionPersistence::mark_paused_static(&write_pool, db_session_id).await;
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
                    break;
                }
                None => {
                    if completed_ok {
                        debug!(slot = %slot, "workflow SDK stream closed after result");
                    } else {
                        warn!(slot = %slot, "workflow SDK stream closed unexpectedly without result");
                        error_msg = Some("Agent stream closed unexpectedly without result".to_string());
                    }
                    break;
                }
            }
        }

        // Post-stream cleanup
        post_stream_cleanup(slot, db_session_id, feature_id, completed_ok, agent_done_called, error_msg, &write_pool, &active_items, &queries).await;
    });
}

/// Check if the expected MCP server is connected. Returns false if not connected
/// (and sends error envelope + interrupts the agent).
async fn check_mcp_server_connected(
    slot: &AgentSlot,
    db_session_id: i64,
    expected_mcp_server: &str,
    mcp_servers: &[claude_agent_sdk_rs::types::McpServerStatus],
    sender: &WsSender,
    write_pool: &SqlitePool,
    queries: &Arc<DashMap<AgentSlot, Arc<tokio::sync::Mutex<Query>>>>,
) -> bool {
    let server_status = mcp_servers.iter().find(|s| s.name == expected_mcp_server);
    let mcp_ok = server_status.map_or(false, |s| s.status == "connected");
    if !mcp_ok {
        let status_detail = match server_status {
            Some(s) => format!("status: {}", s.status),
            None => "server not found in init".to_string(),
        };
        let err = format!(
            "MCP server '{}' failed to connect ({}). The agent cannot function without its tools.",
            expected_mcp_server, status_detail
        );
        error!(slot = %slot, %err, "MCP server not connected");
        WsSessionPersistence::mark_paused_static(write_pool, db_session_id).await;
        let err_env = WsEnvelope::new(
            "workflow",
            "agent_stream",
            to_value(WorkflowAgentStreamErrorPayload {
                agent_slot: slot.clone(),
                session_id: db_session_id,
                msg_type: "error".into(),
                error: err,
            }),
        );
        let _ = sender.send(Message::Text(String::from(err_env).into()));
        if let Some(query_handle) = queries.get(slot) {
            let q = query_handle.value().lock().await;
            let _ = q.interrupt().await;
        }
        return false;
    }
    debug!(slot = %slot, server = %expected_mcp_server, "MCP server connected");
    true
}

/// Extract usage from an SDK message and broadcast to frontend.
async fn broadcast_usage(
    sdk_msg: &SdkMessage,
    slot: &AgentSlot,
    db_session_id: i64,
    context_window: u64,
    sender: &WsSender,
    write_pool: &SqlitePool,
) {
    if let Some(usage) = sdk_msg.usage() {
        let total_input = usage.input_tokens
            + usage.cache_creation_input_tokens.unwrap_or(0)
            + usage.cache_read_input_tokens.unwrap_or(0);
        let total_output = usage.output_tokens;
        WsSessionPersistence::update_token_usage(
            write_pool,
            db_session_id,
            total_input,
            total_output,
        )
        .await;

        let usage_env = WsEnvelope::new(
            "workflow",
            "usage_update",
            to_value(serde_json::json!({
                "agent_slot": slot,
                "session_id": db_session_id,
                "input_tokens": total_input,
                "output_tokens": total_output,
                "context_window": context_window,
            })),
        );
        let _ = sender.send(Message::Text(String::from(usage_env).into()));
    }
}

/// Build the WsEnvelope for an SDK message (result or generic block).
async fn build_stream_envelope(
    sdk_msg: &SdkMessage,
    slot: &AgentSlot,
    db_session_id: i64,
    completed_ok: &mut bool,
    agent_done_called: &mut bool,
    write_pool: &SqlitePool,
) -> WsEnvelope {
    match sdk_msg {
        SdkMessage::Result { .. } => {
            debug!(slot = %slot, agent_done_called = *agent_done_called, "received SDK Result message");
            *completed_ok = true;
            if *agent_done_called {
                WsSessionPersistence::mark_completed_static(write_pool, db_session_id).await;
            }
            WsEnvelope::new(
                "workflow",
                "agent_stream",
                to_value(WorkflowAgentStreamResultPayload {
                    agent_slot: slot.clone(),
                    session_id: db_session_id,
                    msg_type: "result".into(),
                }),
            )
        }
        _ => {
            let block = serde_json::to_value(sdk_msg).unwrap_or_default();
            WsEnvelope::new(
                "workflow",
                "agent_stream",
                to_value(WorkflowAgentStreamBlocksPayload {
                    agent_slot: slot.clone(),
                    session_id: db_session_id,
                    blocks: vec![block],
                }),
            )
        }
    }
}

/// Detect plan/phase-modifying tool calls and send live-refresh updates.
async fn handle_live_refresh(
    sdk_msg: &SdkMessage,
    _slot: &AgentSlot,
    feature_id: i64,
    sender: &WsSender,
    write_pool: &SqlitePool,
    agent_done_called: &mut bool,
    pending_feature_update: &mut Option<Vec<&'static str>>,
    pending_queue_update: &mut bool,
) {
    match sdk_msg {
        SdkMessage::Assistant { message, .. } => {
            use claude_agent_sdk_rs::types::ContentBlock;
            let mut fields: Vec<&'static str> = Vec::new();
            for block in &message.content {
                if let ContentBlock::ToolUse { name, .. } = block {
                    if name.contains("mark_agent_done") || name.contains("mark_phase_done") {
                        *agent_done_called = true;
                    }
                    if name.contains("create_phase") || name.contains("finalize_phases") {
                        fields.extend_from_slice(&["phases", "progress"]);
                        *pending_queue_update = true;
                    } else if name.contains("finalize_plan") {
                        fields.extend_from_slice(&["plan", "phases", "progress", "status"]);
                    } else if name.contains("save_plan") || name.contains("create_plan") {
                        fields.extend_from_slice(&["plan"]);
                    } else if name.contains("save_prd") || name.contains("create_prd") {
                        fields.extend_from_slice(&["prd"]);
                    }
                }
            }
            if !fields.is_empty() {
                fields.dedup();
                *pending_feature_update = Some(fields);
            }
        }
        SdkMessage::User { .. } => {
            if *pending_queue_update {
                *pending_queue_update = false;
                send_queue_update(sender, write_pool, feature_id).await;
            }
            if let Some(fields) = pending_feature_update.take() {
                send_feature_updated_envelope(sender, feature_id, &fields);
            }
        }
        SdkMessage::ToolUseSummary { ref data, .. } => {
            if let Some(tool_name) = data.get("tool_name").and_then(|v| v.as_str()) {
                if tool_name.contains("mark_agent_done") || tool_name.contains("mark_phase_done") {
                    *agent_done_called = true;
                }
                let changed: Option<&[&str]> = match tool_name {
                    t if t.contains("create_phase") || t.contains("finalize_phases") => {
                        send_queue_update(sender, write_pool, feature_id).await;
                        Some(&["phases", "progress"])
                    }
                    t if t.contains("finalize_plan") => {
                        send_queue_update(sender, write_pool, feature_id).await;
                        Some(&["plan", "phases", "progress", "status"])
                    }
                    t if t.contains("save_plan") || t.contains("create_plan") => {
                        Some(&["plan"])
                    }
                    t if t.contains("save_prd") || t.contains("create_prd") => {
                        Some(&["prd"])
                    }
                    _ => None,
                };
                if let Some(fields) = changed {
                    send_feature_updated_envelope(sender, feature_id, fields);
                }
            }
        }
        _ => {}
    }
}

/// Send a queue_update envelope to the frontend.
async fn send_queue_update(sender: &WsSender, write_pool: &SqlitePool, feature_id: i64) {
    if let Ok(items) = repo::get_queue_for_feature(write_pool, feature_id).await {
        let envelope = WsEnvelope::new(
            "workflow",
            "queue_update",
            to_value(WorkflowQueueUpdatePayload {
                feature_id,
                items,
                workflow_status: None,
            }),
        );
        let _ = sender.send(Message::Text(String::from(envelope).into()));
    }
}

/// Post-stream cleanup: remove query handle and dispatch engine callbacks.
async fn post_stream_cleanup(
    slot: AgentSlot,
    db_session_id: i64,
    feature_id: i64,
    completed_ok: bool,
    agent_done_called: bool,
    error_msg: Option<String>,
    write_pool: &SqlitePool,
    active_items: &Arc<DashMap<AgentSlot, i64>>,
    queries: &Arc<DashMap<AgentSlot, Arc<tokio::sync::Mutex<Query>>>>,
) {
    info!(slot = %slot, db_session_id, "workflow stream reader ended — cleaning up query handle");
    queries.remove(&slot);

    debug!(slot = %slot, completed_ok, agent_done_called, has_error = error_msg.is_some(), "stream reader post-loop: dispatching callbacks");
    if completed_ok && agent_done_called {
        if let Some(engine) = crate::domain::ws_session::handler::workflow::get_engine(feature_id) {
            engine.on_item_completed(slot, None).await;
        } else {
            warn!(slot = %slot, feature_id, "no engine found for on_item_completed");
            let legacy_id = slot.as_legacy_id();
            active_items.remove(&slot);
            if let Err(e) = repo::mark_item_completed(write_pool, legacy_id, None).await {
                error!(slot = %slot, error = %e, "failed to mark item completed (no engine)");
            }
        }
    } else if completed_ok && !agent_done_called {
        info!(slot = %slot, "agent turn ended without mark_agent_done — treating as paused");
        WsSessionPersistence::mark_paused_static(write_pool, db_session_id).await;
        if let Some(engine) = crate::domain::ws_session::handler::workflow::get_engine(feature_id) {
            engine.on_item_paused(slot).await;
        }
    } else if let Some(err) = error_msg {
        if let Some(engine) = crate::domain::ws_session::handler::workflow::get_engine(feature_id) {
            engine.on_item_error(slot, &err).await;
        } else {
            let legacy_id = slot.as_legacy_id();
            active_items.remove(&slot);
            if let Err(e) = repo::mark_item_error(write_pool, legacy_id, Some(&err)).await {
                error!(slot = %slot, error = %e, "failed to mark item error (no engine)");
            }
        }
    }
}

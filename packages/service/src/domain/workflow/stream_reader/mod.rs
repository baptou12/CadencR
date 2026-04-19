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
use tracing::{debug, error, info, warn};

use axum::extract::ws::Message;

use crate::domain::agents::adapter::{RuntimeMessageRx, RuntimeSessionHandle};
use crate::domain::features::repository as repo;
use crate::domain::runtime_stream::{
    capture_runtime_session_id, persist_usage, workflow_permission_request_payload,
    RuntimeUsageState,
};
use crate::domain::workflow::engine::{to_value, AgentSlot, WsSender};
use crate::domain::ws_session::persistence::WsSessionPersistence;
use crate::domain::ws_session::protocol::*;

use cleanup::{build_stream_envelope, check_mcp_server_connected, post_stream_cleanup};
use live_refresh::handle_live_refresh;

/// Spawn a background task that reads agent stream messages and forwards them
/// via the workflow domain, then triggers engine callbacks on completion/error.
pub fn spawn_workflow_stream_reader(
    slot: AgentSlot,
    db_session_id: i64,
    feature_id: i64,
    expected_mcp_server: String,
    runtime_provider: String,
    mut message_rx: RuntimeMessageRx,
    sender: WsSender,
    write_pool: SqlitePool,
    active_items: Arc<DashMap<AgentSlot, i64>>,
    queries: Arc<DashMap<AgentSlot, RuntimeSessionHandle>>,
    paused_sessions: Arc<DashMap<AgentSlot, String>>,
    _model: Option<&str>,
    turn_state_tx: crate::app_state::TurnStateBroadcaster,
) {
    tokio::spawn(async move {
        // Seed from the persisted row when resuming a session — otherwise
        // intermediate usage_update events published before the first
        // `result` have no context window to report.
        let initial_context_window: Option<u64> =
            WsSessionPersistence::get_session_row(&write_pool, db_session_id)
                .await
                .and_then(|row| row.context_window)
                .and_then(|cw| u64::try_from(cw).ok())
                .filter(|cw| *cw > 0);

        debug!(slot = %slot, db_session_id, "workflow stream reader started");
        let runtime_adapter = crate::domain::agents::runtime_adapter(&runtime_provider);

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
        let mut usage_state = RuntimeUsageState::new(initial_context_window);
        let mut pending_feature_update: Option<Vec<&'static str>> = None;
        let mut pending_queue_update = false;

        loop {
            // Block until the next runtime event. We intentionally do NOT
            // interrupt the agent when the WS sender detaches — the agent
            // keeps streaming so navigating away (or a brief disconnect)
            // doesn't pause the turn. `WsSender::send` drops messages
            // silently while detached, and `persist_runtime_event` writes
            // every event to `agent_messages` so REST + WS replay restores
            // the transcript on reconnect.
            let msg = message_rx.recv().await;

            match msg {
                Some(Ok(runtime_event)) => {
                    if let Some(request) = runtime_adapter.and_then(|adapter| {
                        adapter.parse_permission_request(runtime_event.raw_json())
                    }) {
                        if let Some(kind) = crate::domain::workflow::permission_router::
                            ApprovalKind::from_tool_name(&request.tool_name)
                        {
                            // OpenCode's MCP tool calls don't flow through
                            // `can_use_tool`; the `"ask"` rules we write in
                            // `opencode/mcp_config.rs` land here as
                            // `permission.asked`. Run the same approval-gate UI
                            // and let the normal permission response deliver
                            // the decision back to the runtime.
                            let tool_use_id = request
                                .tool_use_id
                                .clone()
                                .unwrap_or_else(|| request.request_id.clone());
                            crate::domain::workflow::permission_router::
                                emit_plan_approval_gate_events(
                                    feature_id,
                                    &slot,
                                    db_session_id,
                                    &tool_use_id,
                                    &request.tool_input,
                                    kind,
                                    &sender,
                                    &write_pool,
                                )
                                .await;
                            WsSessionPersistence::broadcast_turn_state(
                                &turn_state_tx,
                                feature_id,
                                "askUser",
                            );
                            continue;
                        }

                        let envelope = WsEnvelope::new(
                            "workflow",
                            "permission.request",
                            to_value(workflow_permission_request_payload(
                                feature_id,
                                slot.clone(),
                                request,
                            )),
                        );
                        let _ = sender.send(Message::Text(String::from(envelope).into()));
                        WsSessionPersistence::broadcast_turn_state(
                            &turn_state_tx,
                            feature_id,
                            "askUser",
                        );
                        continue;
                    }

                    if let Some(runtime_sid) =
                        capture_runtime_session_id(&runtime_event, &mut needs_session_id_capture)
                    {
                        debug!(slot = %slot, db_session_id, runtime_session_id = %runtime_sid, "persisting runtime session_id to DB");
                        WsSessionPersistence::persist_runtime_session_id_only(
                            &write_pool,
                            db_session_id,
                            &runtime_sid,
                        )
                        .await;
                        let sid_env = WsEnvelope::new(
                            "workflow",
                            "agent_session_id",
                            serde_json::json!({
                                "agent_slot": &slot,
                                "session_id": db_session_id,
                                "runtime_session_id": runtime_sid,
                            }),
                        );
                        let _ = sender.send(Message::Text(String::from(sid_env).into()));
                    }

                    let usage_update = usage_state.apply_event(runtime_adapter, &runtime_event);
                    if usage_update.context_window_changed {
                        WsSessionPersistence::update_context_window(
                            &write_pool,
                            db_session_id,
                            usage_update.snapshot.context_window,
                        )
                        .await;
                    }

                    if let Some(init) = runtime_event.init() {
                        if let Some(cw) = init.context_window {
                            debug!(slot = %slot, context_window = cw, "received runtime context window");
                        }
                        if !init.mcp_servers.is_empty() {
                            let model_label = init.model.as_deref().unwrap_or("unknown");
                            debug!(slot = %slot, model = %model_label, context_window = ?usage_update.snapshot.context_window, mcp_servers = ?init.mcp_servers, "received init message from runtime");
                        }
                        // Workflow agents always require an MCP server. If the runtime
                        // didn't report the expected server (or reported none at all),
                        // fail loud — the previous `!is_empty()` gate silently let
                        // tool-less agents run, stalling the workflow.
                        if !expected_mcp_server.is_empty()
                            && !check_mcp_server_connected(
                                &slot,
                                db_session_id,
                                &expected_mcp_server,
                                &init.mcp_servers,
                                &sender,
                                &write_pool,
                                &queries,
                            )
                            .await
                        {
                            error_msg = Some(format!(
                                "MCP server '{}' failed to connect. The agent cannot function without its tools.",
                                expected_mcp_server
                            ));
                            break;
                        }
                    }

                    persistence.persist_runtime_event(&runtime_event).await;
                    let _ = persist_usage(&runtime_event, db_session_id, &write_pool).await;
                    if usage_update.changed
                        && (usage_update.snapshot.input_tokens > 0
                            || usage_update.snapshot.output_tokens > 0)
                    {
                        let usage_env = WsEnvelope::new(
                            "workflow",
                            "usage_update",
                            to_value(serde_json::json!({
                                "agent_slot": slot,
                                "session_id": db_session_id,
                                "input_tokens": usage_update.snapshot.input_tokens,
                                "output_tokens": usage_update.snapshot.output_tokens,
                                "context_window": usage_update.snapshot.context_window,
                            })),
                        );
                        let _ = sender.send(Message::Text(String::from(usage_env).into()));
                    }

                    let envelope = build_stream_envelope(
                        &runtime_event,
                        &slot,
                        db_session_id,
                        &mut completed_ok,
                        &mut agent_done_called,
                        &write_pool,
                    )
                    .await;

                    if sender
                        .send(Message::Text(String::from(envelope).into()))
                        .is_err()
                    {
                        info!(slot = %slot, "WS sender channel error — interrupting agent for clean resume");
                        interrupt_and_pause(
                            &slot,
                            db_session_id,
                            &queries,
                            &paused_sessions,
                            &write_pool,
                        )
                        .await;
                        ws_detached = true;
                        break;
                    }

                    if completed_ok {
                        debug!(slot = %slot, "breaking out of stream loop after result event");
                        break;
                    }

                    handle_live_refresh(
                        &runtime_event,
                        feature_id,
                        phase_slug.as_deref(),
                        &sender,
                        &write_pool,
                        &mut agent_done_called,
                        &mut pending_feature_update,
                        &mut pending_queue_update,
                    )
                    .await;

                    // Shared-subprocess runtimes (OpenCode) don't reliably emit a
                    // Result event right after `mark_agent_done` — the session may
                    // stay "busy" because the tool-call message isn't terminal. Once
                    // the agent has signaled completion, interrupt and synthesize a
                    // Result so cleanup advances the workflow instead of stalling.
                    if agent_done_called && !completed_ok {
                        info!(slot = %slot, "agent signaled completion — interrupting session and finalizing turn");
                        finalize_agent_done(
                            &slot,
                            db_session_id,
                            &queries,
                            &sender,
                            &write_pool,
                        )
                        .await;
                        completed_ok = true;
                        break;
                    }
                }
                Some(Err(e)) => {
                    error_msg = Some(
                        handle_stream_error(&e, &slot, db_session_id, &sender, &write_pool).await,
                    );
                    break;
                }
                None => {
                    if !completed_ok {
                        warn!(slot = %slot, "workflow runtime stream closed unexpectedly without result");
                        error_msg =
                            Some("Agent stream closed unexpectedly without result".to_string());
                    }
                    break;
                }
            }
        }

        post_stream_cleanup(
            slot,
            db_session_id,
            feature_id,
            completed_ok,
            agent_done_called,
            error_msg,
            ws_detached,
            &write_pool,
            &active_items,
            &queries,
            &paused_sessions,
            &turn_state_tx,
        )
        .await;
    });
}

/// Interrupt the agent and persist paused state for clean resume on reconnect.
async fn interrupt_and_pause(
    slot: &AgentSlot,
    db_session_id: i64,
    queries: &Arc<DashMap<AgentSlot, RuntimeSessionHandle>>,
    paused_sessions: &Arc<DashMap<AgentSlot, String>>,
    write_pool: &SqlitePool,
) {
    if let Some(query_arc) = queries.get(slot) {
        let q = query_arc.lock().await;
        if let Some(runtime_session_id) = q.session_id().await {
            paused_sessions.insert(slot.clone(), runtime_session_id.clone());
            WsSessionPersistence::persist_runtime_session_id_only(
                write_pool,
                db_session_id,
                &runtime_session_id,
            )
            .await;
        }
        let _ = q.interrupt().await;
    }
    WsSessionPersistence::mark_paused_static(write_pool, db_session_id).await;
}

/// Finalize the turn when the agent has called `mark_agent_done` but the runtime
/// hasn't produced a Result event on its own. Interrupts the session so the
/// runtime stops generating, marks the DB session completed, and emits a
/// synthetic Result envelope so the frontend clears its streaming state.
async fn finalize_agent_done(
    slot: &AgentSlot,
    db_session_id: i64,
    queries: &Arc<DashMap<AgentSlot, RuntimeSessionHandle>>,
    sender: &WsSender,
    write_pool: &SqlitePool,
) {
    if let Some(query_arc) = queries.get(slot) {
        let q = query_arc.lock().await;
        if let Err(e) = q.interrupt().await {
            warn!(slot = %slot, error = %e, "interrupt after mark_agent_done failed");
        }
    }
    WsSessionPersistence::mark_completed_static(write_pool, db_session_id).await;
    let result_env = WsEnvelope::new(
        "workflow",
        "agent_stream",
        to_value(WorkflowAgentStreamResultPayload {
            agent_slot: slot.clone(),
            session_id: db_session_id,
            msg_type: "result".into(),
        }),
    );
    let _ = sender.send(Message::Text(String::from(result_env).into()));
}

/// Handle a runtime stream error: log, mark paused, and send error envelope.
async fn handle_stream_error(
    e: &crate::domain::agents::adapter::RuntimeError,
    slot: &AgentSlot,
    db_session_id: i64,
    sender: &WsSender,
    write_pool: &SqlitePool,
) -> String {
    error!(slot = %slot, error = %e, "workflow runtime stream error");
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

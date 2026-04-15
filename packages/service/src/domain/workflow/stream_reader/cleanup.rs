//! Post-stream cleanup: MCP checks, usage broadcasting, and engine callbacks.

use std::sync::Arc;

use axum::extract::ws::Message;
use dashmap::DashMap;
use sqlx::SqlitePool;
use tracing::{debug, error, info, warn};

use crate::domain::agents::adapter::{RuntimeEvent, RuntimeSessionHandle};
use crate::domain::features::repository as repo;
use crate::domain::workflow::engine::{to_value, AgentSlot, WsSender};
use crate::domain::ws_session::persistence::WsSessionPersistence;
use crate::domain::ws_session::protocol::*;

/// Check if the expected MCP server is connected. Returns false if not connected
/// (and sends error envelope + interrupts the agent).
pub async fn check_mcp_server_connected(
    slot: &AgentSlot,
    db_session_id: i64,
    expected_mcp_server: &str,
    mcp_servers: &[crate::domain::agents::adapter::RuntimeMcpServerStatus],
    sender: &WsSender,
    write_pool: &SqlitePool,
    queries: &Arc<DashMap<AgentSlot, RuntimeSessionHandle>>,
) -> bool {
    let server_status = mcp_servers.iter().find(|s| s.name == expected_mcp_server);
    let mcp_ok = server_status.map_or(false, |s| s.status == "connected");
    if !mcp_ok {
        let status_detail = server_status.map_or_else(
            || "server not found in init".to_string(),
            |s| format!("status: {}", s.status),
        );
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

/// Build the WsEnvelope for an SDK message (result or generic block).
pub async fn build_stream_envelope(
    runtime_event: &RuntimeEvent,
    slot: &AgentSlot,
    db_session_id: i64,
    completed_ok: &mut bool,
    agent_done_called: &mut bool,
    write_pool: &SqlitePool,
) -> WsEnvelope {
    if runtime_event.is_result() {
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
    } else {
        let block = runtime_event.raw_json().clone();
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

/// Post-stream cleanup: remove query handle, clean paused state, and dispatch engine callbacks.
pub async fn post_stream_cleanup(
    slot: AgentSlot,
    db_session_id: i64,
    feature_id: i64,
    completed_ok: bool,
    agent_done_called: bool,
    error_msg: Option<String>,
    ws_detached: bool,
    write_pool: &SqlitePool,
    active_items: &Arc<DashMap<AgentSlot, i64>>,
    queries: &Arc<DashMap<AgentSlot, RuntimeSessionHandle>>,
    paused_sessions: &Arc<DashMap<AgentSlot, String>>,
    turn_state_tx: &tokio::sync::broadcast::Sender<crate::app_state::TurnStateEvent>,
) {
    info!(slot = %slot, db_session_id, ws_detached, "workflow stream reader ended — cleaning up");
    queries.remove(&slot);

    // WS detach: agent was interrupted for clean resume. Session ID is already
    // in paused_sessions and DB. Keep it there so replay_state_to_client reports
    // the agent as paused and auto-resume can pick it up.
    if ws_detached {
        info!(slot = %slot, "stream reader exited due to WS detach — agent ready for resume on reconnect");
        WsSessionPersistence::broadcast_turn_state(turn_state_tx, feature_id, "none");
        return;
    }

    // Normal exit paths — clean up paused_sessions
    paused_sessions.remove(&slot);

    debug!(slot = %slot, completed_ok, agent_done_called, has_error = error_msg.is_some(), "dispatching callbacks");

    if completed_ok && agent_done_called {
        handle_completed(&slot, feature_id, write_pool, active_items).await;
    } else if completed_ok && !agent_done_called {
        handle_paused(&slot, feature_id, db_session_id, write_pool).await;
    } else if let Some(err) = error_msg {
        handle_error(
            &slot,
            feature_id,
            &err,
            write_pool,
            active_items,
            turn_state_tx,
        )
        .await;
    } else {
        info!(slot = %slot, "stream ended without result — treating as paused for reconnect");
        handle_paused(&slot, feature_id, db_session_id, write_pool).await;
    }
}

async fn handle_completed(
    slot: &AgentSlot,
    feature_id: i64,
    write_pool: &SqlitePool,
    active_items: &Arc<DashMap<AgentSlot, i64>>,
) {
    if let Some(engine) = crate::domain::ws_session::handler::workflow::get_engine(feature_id) {
        engine.on_item_completed(slot.clone(), None).await;
    } else {
        warn!(slot = %slot, feature_id, "no engine found for on_item_completed");
        let legacy_id = slot.as_legacy_id();
        active_items.remove(slot);
        if let Err(e) = repo::mark_item_completed(write_pool, legacy_id, None).await {
            error!(slot = %slot, error = %e, "failed to mark item completed (no engine)");
        }
    }
}

async fn handle_paused(
    slot: &AgentSlot,
    feature_id: i64,
    db_session_id: i64,
    write_pool: &SqlitePool,
) {
    info!(slot = %slot, "agent turn ended without mark_agent_done — treating as paused");
    WsSessionPersistence::mark_paused_static(write_pool, db_session_id).await;
    if let Some(engine) = crate::domain::ws_session::handler::workflow::get_engine(feature_id) {
        engine.on_item_paused(slot.clone()).await;
    }
}

async fn handle_error(
    slot: &AgentSlot,
    feature_id: i64,
    err: &str,
    write_pool: &SqlitePool,
    active_items: &Arc<DashMap<AgentSlot, i64>>,
    turn_state_tx: &tokio::sync::broadcast::Sender<crate::app_state::TurnStateEvent>,
) {
    if let Some(engine) = crate::domain::ws_session::handler::workflow::get_engine(feature_id) {
        engine.on_item_error(slot.clone(), err).await;
    } else {
        let legacy_id = slot.as_legacy_id();
        active_items.remove(slot);
        if let Err(e) = repo::mark_item_error(write_pool, legacy_id, Some(err)).await {
            error!(slot = %slot, error = %e, "failed to mark item error (no engine)");
        }
        WsSessionPersistence::broadcast_turn_state(turn_state_tx, feature_id, "none");
    }
}

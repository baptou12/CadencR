use std::sync::atomic::Ordering;
use std::sync::{Arc, LazyLock, Once};

use axum::extract::ws::Message;
use dashmap::DashMap;
use serde::de::DeserializeOwned;
use tracing::{debug, info, warn};

use super::workflow_complex;
use super::workflow_interact;
use super::{SdkSessions, WsSender};
use crate::app_state::AppState;
use crate::domain::workflow::engine::WorkflowEngine;
use crate::domain::ws_session::protocol::*;

// ── Engine registry ──────────────────────────────────────────────────────────

/// Global engine registry: one engine per feature_id at a time.
pub(super) static ENGINES: LazyLock<DashMap<i64, Arc<WorkflowEngine>>> =
    LazyLock::new(DashMap::new);
static BACKGROUND_INIT: Once = Once::new();

/// Spawn global background tasks (runs once): engine eviction + timeout checker.
pub(super) fn ensure_background_tasks(timeout_minutes: u64) {
    BACKGROUND_INIT.call_once(move || {
        tokio::spawn(eviction_loop());
        tokio::spawn(timeout_loop(timeout_minutes));
    });
}

async fn eviction_loop() {
    let interval = std::time::Duration::from_secs(5 * 60);
    let idle_threshold_secs: u64 = 30 * 60;
    let detached_idle_threshold_secs: u64 = 5 * 60;
    loop {
        tokio::time::sleep(interval).await;
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();

        let mut to_evict = Vec::new();
        for entry in ENGINES.iter() {
            let engine = entry.value();
            if engine.active_items().is_empty() {
                let last = engine.last_activity.load(Ordering::Relaxed);
                let age = now.saturating_sub(last);
                let threshold = if engine.has_sender() {
                    idle_threshold_secs
                } else {
                    detached_idle_threshold_secs
                };
                if age > threshold {
                    to_evict.push(*entry.key());
                }
            }
        }
        for feature_id in to_evict {
            if let Some((_, _engine)) = ENGINES.remove(&feature_id) {
                info!(
                    feature_id,
                    "evicted idle workflow engine from ENGINES registry"
                );
            }
        }
    }
}

async fn timeout_loop(timeout_minutes: u64) {
    let interval = std::time::Duration::from_secs(60);
    loop {
        tokio::time::sleep(interval).await;
        for entry in ENGINES.iter() {
            let engine = entry.value();
            let feature_id = engine.feature_id;
            check_stale_items(engine, feature_id, timeout_minutes).await;
        }
    }
}

async fn check_stale_items(engine: &WorkflowEngine, feature_id: i64, timeout_minutes: u64) {
    let stale: Vec<(i64,)> = match sqlx::query_as(
        "SELECT id FROM workflow_queue WHERE feature_id = ? AND status = 'running' AND started_at < datetime('now', ?)",
    )
    .bind(feature_id)
    .bind(format!("-{timeout_minutes} minutes"))
    .fetch_all(&engine.read_pool)
    .await {
        Ok(rows) => rows,
        Err(e) => {
            tracing::error!(feature_id, error = %e, "timeout checker query failed");
            return;
        }
    };

    for (item_id,) in stale {
        let slot = crate::domain::workflow::engine::AgentSlot::QueueItem(item_id);
        if engine.active_items().contains_key(&slot) {
            debug!(feature_id, item_id, "timeout checker: skipping active item");
            continue;
        }
        warn!(feature_id, item_id, "agent timed out (orphaned)");

        if let Err(e) = crate::domain::features::repository::mark_item_error(
            &engine.write_pool,
            item_id,
            Some("Agent timed out"),
        )
        .await
        {
            tracing::error!(item_id, error = %e, "failed to mark timed-out item");
            continue;
        }

        let envelope = WsEnvelope::new(
            "workflow",
            "item_error",
            serde_json::to_value(WorkflowItemErrorPayload {
                feature_id,
                agent_slot: crate::domain::workflow::engine::AgentSlot::QueueItem(item_id),
                error: "Agent timed out".into(),
            })
            .unwrap_or_default(),
        );
        let _ = engine
            .ws_sender
            .send(Message::Text(String::from(envelope).into()));
    }
}

/// Detach the WS sender from an engine (on disconnect), keeping the engine alive.
pub fn detach_engine_sender(feature_id: i64) {
    if let Some(engine) = ENGINES.get(&feature_id) {
        engine.detach_sender();
    }
}

/// Get all tracked feature_ids (for disconnect cleanup).
pub fn tracked_feature_ids() -> Vec<i64> {
    ENGINES.iter().map(|entry| *entry.key()).collect::<Vec<_>>()
}

/// Pause all agents across all engines (for graceful shutdown).
#[allow(dead_code)]
pub async fn pause_all_engines() {
    for feature_id in tracked_feature_ids() {
        if let Some(engine) = ENGINES.get(&feature_id) {
            info!(feature_id, "shutdown: pausing all agents");
            engine.pause_all().await;
        }
    }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

pub(super) fn send_workflow_error(sender: &WsSender, ref_id: &str, code: &str, message: &str) {
    let err = WsEnvelope::reply(
        ref_id,
        "workflow",
        "error",
        serde_json::to_value(SessionErrorPayload {
            code: code.into(),
            message: message.into(),
        })
        .unwrap(),
    );
    let _ = sender.send(Message::Text(String::from(err).into()));
}

pub fn get_engine(feature_id: i64) -> Option<Arc<WorkflowEngine>> {
    ENGINES.get(&feature_id).map(|e| Arc::clone(e.value()))
}

/// Parse a workflow payload and look up the engine in one step.
pub(super) fn parse_and_get_engine<T: DeserializeOwned + HasFeatureId>(
    envelope: &WsEnvelope,
    sender: &WsSender,
) -> Option<(T, Arc<WorkflowEngine>)> {
    let payload: T = match serde_json::from_value(envelope.payload.clone()) {
        Ok(p) => p,
        Err(e) => {
            send_workflow_error(
                sender,
                &envelope.id,
                "INVALID_PAYLOAD",
                &format!("Invalid payload: {e}"),
            );
            return None;
        }
    };
    let engine = match get_engine(payload.feature_id()) {
        Some(e) => e,
        None => {
            send_workflow_error(
                sender,
                &envelope.id,
                "NO_ENGINE",
                &format!("No workflow engine for feature {}", payload.feature_id()),
            );
            return None;
        }
    };
    Some((payload, engine))
}

/// Parse a workflow payload without requiring an engine.
pub(super) fn parse_payload<T: DeserializeOwned>(
    envelope: &WsEnvelope,
    sender: &WsSender,
) -> Option<T> {
    match serde_json::from_value(envelope.payload.clone()) {
        Ok(p) => Some(p),
        Err(e) => {
            send_workflow_error(
                sender,
                &envelope.id,
                "INVALID_PAYLOAD",
                &format!("Invalid payload: {e}"),
            );
            None
        }
    }
}

pub(super) use crate::domain::workflow::engine::to_value;

// ── Dispatch ─────────────────────────────────────────────────────────────────

/// Handle workflow domain actions.
pub async fn handle_workflow_action(
    envelope: WsEnvelope,
    sender: &WsSender,
    _sdk_sessions: &SdkSessions,
    app_state: &AppState,
) {
    match envelope.action.as_str() {
        "feature.start" => {
            workflow_complex::handle_feature_start(envelope, sender, app_state).await
        }
        "start_plan" => workflow_complex::handle_start_plan(envelope, sender, app_state).await,
        "start_prd" => workflow_complex::handle_start_prd(envelope, sender, app_state).await,
        "plan.approved" | "plan.rejected" => {
            workflow_complex::handle_plan_approval(envelope, sender).await
        }
        "prd.approved" | "prd.rejected" => {
            workflow_complex::handle_prd_approval(envelope, sender).await
        }
        "populate_queue" => {
            workflow_complex::handle_populate_queue(envelope, sender, app_state).await
        }
        "start_build" => workflow_complex::handle_start_build(envelope, sender, app_state).await,
        "continue" => workflow_complex::handle_continue(envelope, sender).await,
        "skip_item" => handle_skip_item(envelope, sender).await,
        "retry_item" => handle_retry_item(envelope, sender).await,
        "retry_worktree_setup" => {
            workflow_interact::handle_retry_worktree_setup(envelope, sender, app_state).await
        }
        "permission.respond" => {
            workflow_interact::handle_permission_respond(envelope, sender, app_state).await
        }
        "prompt.send" => workflow_interact::handle_prompt_send(envelope, sender, app_state).await,
        "interrupt" => workflow_interact::handle_interrupt(envelope, sender, app_state).await,
        "set_autonomy" => handle_set_autonomy(envelope, sender).await,
        "set_parallel" => handle_set_parallel(envelope, sender, app_state).await,
        "start_session" => handle_start_session(envelope, sender).await,
        "start_refine" => handle_start_refine(envelope, sender).await,
        "start_review_fixer" => handle_start_review_fixer(envelope, sender).await,
        "start_risk" => handle_start_risk(envelope, sender).await,
        "start_retro" => handle_start_retro(envelope, sender).await,
        "mark_done" => handle_mark_done(envelope, sender).await,
        unknown => {
            send_workflow_error(
                sender,
                &envelope.id,
                "UNKNOWN_ACTION",
                &format!("Unknown workflow action: {unknown}"),
            );
        }
    }
}

// ── Simple handlers ──────────────────────────────────────────────────────────

/// Macro for simple "parse + engine call + error" handlers (no ack on success).
macro_rules! engine_call {
    ($envelope:expr, $sender:expr, $payload_ty:ty, |$p:ident, $e:ident| $call:expr, $err_code:literal, $err_prefix:literal) => {{
        let Some(($p, $e)) = parse_and_get_engine::<$payload_ty>(&$envelope, $sender) else {
            return;
        };
        if let Err(e) = $call {
            send_workflow_error(
                $sender,
                &$envelope.id,
                $err_code,
                &format!(concat!($err_prefix, ": {e}"), e = e),
            );
        }
    }};
}

async fn handle_skip_item(envelope: WsEnvelope, sender: &WsSender) {
    engine_call!(
        envelope,
        sender,
        WorkflowSkipItemPayload,
        |p, engine| engine.skip_item(p.item_id).await,
        "SKIP_FAILED",
        "Failed to skip item"
    );
}

async fn handle_retry_item(envelope: WsEnvelope, sender: &WsSender) {
    engine_call!(
        envelope,
        sender,
        WorkflowRetryItemPayload,
        |p, engine| engine.retry_item(p.item_id).await,
        "RETRY_FAILED",
        "Failed to retry item"
    );
}

async fn handle_mark_done(envelope: WsEnvelope, sender: &WsSender) {
    let Some((payload, engine)) =
        parse_and_get_engine::<WorkflowMarkDonePayload>(&envelope, sender)
    else {
        return;
    };

    info!(feature_id = payload.feature_id, agent_slot = %payload.agent_slot, "marking agent done");
    match engine.mark_done(payload.agent_slot).await {
        Ok(()) => {
            let ack = WsEnvelope::reply(
                &envelope.id,
                "workflow",
                "acknowledged",
                to_value(WorkflowAcknowledgedPayload {
                    feature_id: payload.feature_id,
                    action: "mark_done".into(),
                }),
            );
            let _ = sender.send(Message::Text(String::from(ack).into()));
        }
        Err(e) => {
            send_workflow_error(
                sender,
                &envelope.id,
                "MARK_DONE_FAILED",
                &format!("Failed to mark done: {e}"),
            );
        }
    }
}

async fn handle_set_autonomy(envelope: WsEnvelope, sender: &WsSender) {
    let Some((payload, engine)) =
        parse_and_get_engine::<WorkflowSetAutonomyPayload>(&envelope, sender)
    else {
        return;
    };

    engine
        .autonomy_level()
        .store(payload.level, Ordering::Relaxed);
    info!(
        feature_id = payload.feature_id,
        level = payload.level,
        "autonomy level updated"
    );

    let ack = WsEnvelope::reply(
        &envelope.id,
        "workflow",
        "autonomy.updated",
        to_value(WorkflowAutonomyUpdatedPayload {
            feature_id: payload.feature_id,
            level: payload.level,
        }),
    );
    let _ = sender.send(Message::Text(String::from(ack).into()));
}

async fn handle_set_parallel(envelope: WsEnvelope, sender: &WsSender, app_state: &AppState) {
    let Some((payload, engine)) =
        parse_and_get_engine::<WorkflowSetParallelPayload>(&envelope, sender)
    else {
        return;
    };

    let max = if payload.enabled {
        app_state.max_parallel_agents
    } else {
        1
    };
    engine.set_max_parallel(max);
    info!(
        feature_id = payload.feature_id,
        enabled = payload.enabled,
        max_parallel = max,
        "parallel execution updated"
    );

    if payload.enabled {
        let _ = engine.advance().await;
    }

    let ack = WsEnvelope::reply(
        &envelope.id,
        "workflow",
        "parallel.updated",
        to_value(serde_json::json!({
            "feature_id": payload.feature_id,
            "enabled": payload.enabled,
            "max_parallel": max,
        })),
    );
    let _ = sender.send(Message::Text(String::from(ack).into()));
}

/// Generic handler for simple agent spawn actions (no worktree prep, no status transition).
async fn handle_start_agent<T, F, Fut>(
    envelope: WsEnvelope,
    sender: &WsSender,
    agent_name: &str,
    reply_action: &str,
    spawn_fn: F,
) where
    T: DeserializeOwned + HasFeatureId,
    F: FnOnce(T, Arc<WorkflowEngine>) -> Fut,
    Fut: std::future::Future<Output = Result<i64, String>>,
{
    let Some((payload, engine)) = parse_and_get_engine::<T>(&envelope, sender) else {
        return;
    };
    let feature_id = payload.feature_id();

    info!(feature_id, "spawning {agent_name} agent");
    match spawn_fn(payload, engine).await {
        Ok(session_id) => {
            let ack = WsEnvelope::reply(
                &envelope.id,
                "workflow",
                reply_action,
                to_value(WorkflowFeatureIdSessionPayload {
                    feature_id,
                    session_id,
                }),
            );
            let _ = sender.send(Message::Text(String::from(ack).into()));
        }
        Err(e) => {
            send_workflow_error(
                sender,
                &envelope.id,
                "SPAWN_FAILED",
                &format!("Failed to spawn {agent_name}: {e}"),
            );
        }
    }
}

async fn handle_start_session(envelope: WsEnvelope, sender: &WsSender) {
    handle_start_agent::<WorkflowStartSessionPayload, _, _>(
        envelope,
        sender,
        "session",
        "session.started",
        |p, engine| async move {
            engine
                .spawn_session_agent(&p.prompt, &p.images.unwrap_or_default())
                .await
        },
    )
    .await;
}

async fn handle_start_refine(envelope: WsEnvelope, sender: &WsSender) {
    handle_start_agent::<WorkflowStartRefinePayload, _, _>(
        envelope,
        sender,
        "refine",
        "refine.started",
        |p, engine| async move {
            engine
                .spawn_refine_agent(&p.description, &p.images.unwrap_or_default())
                .await
        },
    )
    .await;
}

async fn handle_start_review_fixer(envelope: WsEnvelope, sender: &WsSender) {
    handle_start_agent::<WorkflowStartReviewFixerPayload, _, _>(
        envelope,
        sender,
        "review fixer",
        "review_fixer.started",
        |p, engine| async move { engine.spawn_review_fixer_agent(&p.comments).await },
    )
    .await;
}

async fn handle_start_risk(envelope: WsEnvelope, sender: &WsSender) {
    handle_start_agent::<WorkflowStartRiskPayload, _, _>(
        envelope,
        sender,
        "risk",
        "risk.started",
        |_p, engine| async move { engine.spawn_risk_agent().await },
    )
    .await;
}

async fn handle_start_retro(envelope: WsEnvelope, sender: &WsSender) {
    handle_start_agent::<WorkflowStartRetroPayload, _, _>(
        envelope,
        sender,
        "retro",
        "retro.started",
        |_p, engine| async move { engine.spawn_retro_agent().await },
    )
    .await;
}

#[cfg(test)]
#[path = "workflow_tests.rs"]
mod tests;

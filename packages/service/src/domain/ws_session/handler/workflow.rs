use std::sync::{Arc, LazyLock};

use axum::extract::ws::Message;
use dashmap::DashMap;
use tracing::{info, warn};

use crate::app_state::AppState;
use crate::domain::features::models::WorkflowType;
use crate::domain::workflow::engine::WorkflowEngine;
use crate::domain::ws_session::persistence::WsSessionPersistence;
use crate::domain::ws_session::protocol::*;
use super::{SdkSessions, WsSender};

/// Global engine registry: one engine per feature_id at a time.
static ENGINES: LazyLock<DashMap<i64, Arc<WorkflowEngine>>> = LazyLock::new(DashMap::new);

/// Remove the engine for a feature (used on disconnect cleanup).
pub fn remove_engine(feature_id: i64) {
    if let Some((_, engine)) = ENGINES.remove(&feature_id) {
        engine.cancel();
    }
}

/// Get all tracked feature_ids (for disconnect cleanup).
pub fn tracked_feature_ids() -> Vec<i64> {
    ENGINES.iter().map(|entry| *entry.key()).collect::<Vec<_>>()
}

fn send_workflow_error(sender: &WsSender, ref_id: &str, code: &str, message: &str) {
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

/// Handle workflow domain actions.
pub async fn handle_workflow_action(
    envelope: WsEnvelope,
    sender: &WsSender,
    _sdk_sessions: &SdkSessions,
    app_state: &AppState,
) {
    match envelope.action.as_str() {
        "feature.start" => handle_feature_start(envelope, sender, app_state).await,
        "start_plan" => handle_start_plan(envelope, sender).await,
        "start_prd" => handle_start_prd(envelope, sender).await,
        "plan.approved" | "plan.rejected" => handle_plan_approval(envelope, sender).await,
        "prd.approved" | "prd.rejected" => handle_prd_approval(envelope, sender).await,
        "populate_queue" => handle_populate_queue(envelope, sender, app_state).await,
        "start_build" => handle_start_build(envelope, sender, app_state).await,
        "continue" => handle_continue(envelope, sender).await,
        "skip_item" => handle_skip_item(envelope, sender).await,
        "retry_item" => handle_retry_item(envelope, sender).await,
        "permission.respond" => handle_permission_respond(envelope, sender).await,
        "prompt.send" => handle_prompt_send(envelope, sender, app_state).await,
        "interrupt" => handle_interrupt(envelope, sender, app_state).await,
        "set_autonomy" => handle_set_autonomy(envelope, sender).await,
        unknown => {
            send_workflow_error(&sender, &envelope.id, "UNKNOWN_ACTION", &format!("Unknown workflow action: {unknown}"));
        }
    }
}

async fn handle_feature_start(
    envelope: WsEnvelope,
    sender: &WsSender,
    app_state: &AppState,
) {
    let payload: WorkflowFeatureStartPayload = match serde_json::from_value(envelope.payload.clone()) {
        Ok(p) => p,
        Err(e) => {
            send_workflow_error(sender, &envelope.id, "INVALID_PAYLOAD", &format!("Invalid feature.start payload: {e}"));
            return;
        }
    };

    let feature_id = payload.feature_id;

    // Verify the feature exists and get its type
    let feature_row: Result<Option<(String,)>, _> = sqlx::query_as(
        "SELECT type_ FROM features WHERE id = ?"
    )
    .bind(feature_id)
    .fetch_optional(&app_state.read_pool)
    .await;

    // Fallback: try without type_ column (legacy schema)
    let feature_type = match feature_row {
        Ok(Some((t,))) => t,
        _ => {
            // Try just checking existence
            let exists = sqlx::query("SELECT 1 FROM features WHERE id = ?")
                .bind(feature_id)
                .fetch_optional(&app_state.read_pool)
                .await;

            match exists {
                Ok(Some(_)) => {
                    // Use workflow_type from payload or default
                    payload.workflow_type.clone().unwrap_or_else(|| "feature_build".to_string())
                }
                Ok(None) => {
                    send_workflow_error(sender, &envelope.id, "NOT_FOUND", &format!("Feature {feature_id} not found"));
                    return;
                }
                Err(e) => {
                    send_workflow_error(sender, &envelope.id, "LOOKUP_FAILED", &format!("Failed to look up feature: {e}"));
                    return;
                }
            }
        }
    };

    // Determine workflow type
    let workflow_type_str = payload.workflow_type.unwrap_or(feature_type);
    let workflow_type = match WorkflowType::from_str(&workflow_type_str) {
        Ok(wt) => wt,
        Err(e) => {
            send_workflow_error(sender, &envelope.id, "INVALID_WORKFLOW_TYPE", &e);
            return;
        }
    };

    // Check if an engine already exists for this feature
    if let Some(existing) = ENGINES.get(&feature_id) {
        if existing.active_items.len() > 0 {
            send_workflow_error(
                sender,
                &envelope.id,
                "ALREADY_RUNNING",
                &format!("Workflow already running for feature {feature_id}"),
            );
            return;
        }
        info!(feature_id, "replacing idle engine on reconnect");
    }

    // Create engine and store in registry
    let engine = Arc::new(WorkflowEngine::new(
        feature_id,
        workflow_type.clone(),
        app_state.read_pool.clone(),
        app_state.write_pool.clone(),
        sender.clone(),
        app_state.max_parallel_agents,
    ));

    // Restore state on reconnect (mark stale running items, send queue update)
    if let Err(e) = engine.restore_on_reconnect().await {
        warn!(feature_id, error = %e, "failed to restore on reconnect");
    }

    // Start timeout checker (30 min default)
    engine.spawn_timeout_checker(30);

    ENGINES.insert(feature_id, engine);

    info!(feature_id, workflow_type = %workflow_type.as_str(), "workflow engine created");

    let resp = WsEnvelope::reply(
        &envelope.id,
        "workflow",
        "feature.started",
        serde_json::to_value(WorkflowFeatureStartResponse {
            feature_id,
            workflow_type: workflow_type.as_str().to_string(),
        })
        .unwrap(),
    );
    let _ = sender.send(Message::Text(String::from(resp).into()));
}

async fn handle_start_plan(envelope: WsEnvelope, sender: &WsSender) {
    let payload: WorkflowStartPlanPayload = match serde_json::from_value(envelope.payload.clone()) {
        Ok(p) => p,
        Err(e) => {
            send_workflow_error(sender, &envelope.id, "INVALID_PAYLOAD", &format!("Invalid start_plan payload: {e}"));
            return;
        }
    };

    let Some(engine) = get_engine(payload.feature_id) else {
        send_workflow_error(sender, &envelope.id, "NO_ENGINE", &format!("No workflow engine for feature {}", payload.feature_id));
        return;
    };

    info!(feature_id = payload.feature_id, "spawning plan agent");
    match engine.spawn_plan_agent(&payload.description).await {
        Ok(session_id) => {
            let ack = WsEnvelope::reply(&envelope.id, "workflow", "plan.started", serde_json::json!({
                "feature_id": payload.feature_id,
                "session_id": session_id,
            }));
            let _ = sender.send(Message::Text(String::from(ack).into()));
        }
        Err(e) => {
            send_workflow_error(sender, &envelope.id, "SPAWN_FAILED", &format!("Failed to spawn plan agent: {e}"));
        }
    }
}

async fn handle_start_prd(envelope: WsEnvelope, sender: &WsSender) {
    let payload: WorkflowStartPrdPayload = match serde_json::from_value(envelope.payload.clone()) {
        Ok(p) => p,
        Err(e) => {
            send_workflow_error(sender, &envelope.id, "INVALID_PAYLOAD", &format!("Invalid start_prd payload: {e}"));
            return;
        }
    };

    let Some(engine) = get_engine(payload.feature_id) else {
        send_workflow_error(sender, &envelope.id, "NO_ENGINE", &format!("No workflow engine for feature {}", payload.feature_id));
        return;
    };

    info!(feature_id = payload.feature_id, "spawning PRD agent");
    match engine.spawn_prd_agent(&payload.description).await {
        Ok(session_id) => {
            let ack = WsEnvelope::reply(&envelope.id, "workflow", "prd.started", serde_json::json!({
                "feature_id": payload.feature_id,
                "session_id": session_id,
            }));
            let _ = sender.send(Message::Text(String::from(ack).into()));
        }
        Err(e) => {
            send_workflow_error(sender, &envelope.id, "SPAWN_FAILED", &format!("Failed to spawn PRD agent: {e}"));
        }
    }
}

async fn handle_plan_approval(envelope: WsEnvelope, sender: &WsSender) {
    let payload: WorkflowApprovalPayload = match serde_json::from_value(envelope.payload.clone()) {
        Ok(p) => p,
        Err(e) => {
            send_workflow_error(sender, &envelope.id, "INVALID_PAYLOAD", &format!("Invalid approval payload: {e}"));
            return;
        }
    };

    let Some(engine) = get_engine(payload.feature_id) else {
        send_workflow_error(sender, &envelope.id, "NO_ENGINE", &format!("No workflow engine for feature {}", payload.feature_id));
        return;
    };

    let approved = payload.approved;
    let prefix = format!("plan-approval-");
    info!(feature_id = payload.feature_id, approved, "resolving plan approval");

    // Try to resolve via engine's McpContext (in-process path)
    match engine.resolve_approval(&prefix, approved, payload.feedback.clone()).await {
        Ok(resolved) => {
            if !resolved {
                // Fallback: try resolving by exact request_id from payload
                let _ = engine.resolve_approval(&payload.request_id, approved, payload.feedback).await;
            }
        }
        Err(e) => {
            warn!(feature_id = payload.feature_id, error = %e, "failed to resolve plan approval");
        }
    }

    let ack = WsEnvelope::reply(&envelope.id, "workflow", "plan.approval_resolved", serde_json::json!({
        "feature_id": payload.feature_id,
        "approved": approved,
    }));
    let _ = sender.send(Message::Text(String::from(ack).into()));
}

async fn handle_prd_approval(envelope: WsEnvelope, sender: &WsSender) {
    let payload: WorkflowApprovalPayload = match serde_json::from_value(envelope.payload.clone()) {
        Ok(p) => p,
        Err(e) => {
            send_workflow_error(sender, &envelope.id, "INVALID_PAYLOAD", &format!("Invalid approval payload: {e}"));
            return;
        }
    };

    let Some(engine) = get_engine(payload.feature_id) else {
        send_workflow_error(sender, &envelope.id, "NO_ENGINE", &format!("No workflow engine for feature {}", payload.feature_id));
        return;
    };

    let approved = payload.approved;
    let prefix = format!("prd-approval-");
    info!(feature_id = payload.feature_id, approved, "resolving PRD approval");

    match engine.resolve_approval(&prefix, approved, payload.feedback.clone()).await {
        Ok(resolved) => {
            if !resolved {
                let _ = engine.resolve_approval(&payload.request_id, approved, payload.feedback).await;
            }
        }
        Err(e) => {
            warn!(feature_id = payload.feature_id, error = %e, "failed to resolve PRD approval");
        }
    }

    let ack = WsEnvelope::reply(&envelope.id, "workflow", "prd.approval_resolved", serde_json::json!({
        "feature_id": payload.feature_id,
        "approved": approved,
    }));
    let _ = sender.send(Message::Text(String::from(ack).into()));
}

async fn handle_populate_queue(envelope: WsEnvelope, sender: &WsSender, app_state: &AppState) {
    let payload: WorkflowPopulateQueuePayload = match serde_json::from_value(envelope.payload.clone()) {
        Ok(p) => p,
        Err(e) => {
            send_workflow_error(sender, &envelope.id, "INVALID_PAYLOAD", &format!("Invalid populate_queue payload: {e}"));
            return;
        }
    };

    let feature_id = payload.feature_id;
    let Some(engine) = get_engine(feature_id) else {
        send_workflow_error(sender, &envelope.id, "NO_ENGINE", &format!("No workflow engine for feature {feature_id}"));
        return;
    };

    let strategy = crate::domain::workflow::strategies::get_strategy(&engine.workflow_type);
    info!(feature_id, "populating workflow queue");
    match strategy
        .populate_queue(&app_state.write_pool, &app_state.read_pool, feature_id, payload.plan_id)
        .await
    {
        Ok(items) => {
            let ack = WsEnvelope::reply(&envelope.id, "workflow", "queue.populated", serde_json::json!({
                "feature_id": feature_id,
                "item_count": items.len(),
            }));
            let _ = sender.send(Message::Text(String::from(ack).into()));
        }
        Err(e) => {
            send_workflow_error(sender, &envelope.id, "POPULATE_FAILED", &format!("Failed to populate queue: {e}"));
        }
    }
}

async fn handle_start_build(envelope: WsEnvelope, sender: &WsSender, app_state: &AppState) {
    let payload: WorkflowStartBuildPayload = match serde_json::from_value(envelope.payload.clone()) {
        Ok(p) => p,
        Err(e) => {
            send_workflow_error(sender, &envelope.id, "INVALID_PAYLOAD", &format!("Invalid start_build payload: {e}"));
            return;
        }
    };

    let Some(engine) = get_engine(payload.feature_id) else {
        send_workflow_error(sender, &envelope.id, "NO_ENGINE", &format!("No workflow engine for feature {}", payload.feature_id));
        return;
    };

    // Ensure queue is populated before advancing (idempotent — skips if already populated)
    let strategy = crate::domain::workflow::strategies::get_strategy(&engine.workflow_type);
    let items = crate::domain::features::repository::get_queue_for_feature(&app_state.read_pool, payload.feature_id)
        .await
        .unwrap_or_default();
    if items.is_empty() {
        info!(feature_id = payload.feature_id, "start_build: queue empty, populating first");
        // Try to find the plan_id for this feature
        let plan_id: Option<i64> = sqlx::query_scalar("SELECT id FROM plans WHERE feature_id = ? ORDER BY id DESC LIMIT 1")
            .bind(payload.feature_id)
            .fetch_optional(&app_state.read_pool)
            .await
            .ok()
            .flatten();
        if let Err(e) = strategy.populate_queue(&app_state.write_pool, &app_state.read_pool, payload.feature_id, plan_id).await {
            send_workflow_error(sender, &envelope.id, "POPULATE_FAILED", &format!("Failed to populate queue: {e}"));
            return;
        }
    }

    info!(feature_id = payload.feature_id, "start_build: advancing engine");
    if let Err(e) = engine.advance().await {
        send_workflow_error(sender, &envelope.id, "ADVANCE_FAILED", &format!("Failed to advance: {e}"));
    }
}

async fn handle_continue(envelope: WsEnvelope, sender: &WsSender) {
    let payload: WorkflowContinuePayload = match serde_json::from_value(envelope.payload.clone()) {
        Ok(p) => p,
        Err(e) => {
            send_workflow_error(sender, &envelope.id, "INVALID_PAYLOAD", &format!("Invalid continue payload: {e}"));
            return;
        }
    };

    let Some(engine) = get_engine(payload.feature_id) else {
        send_workflow_error(sender, &envelope.id, "NO_ENGINE", &format!("No workflow engine for feature {}", payload.feature_id));
        return;
    };

    info!(feature_id = payload.feature_id, "continue: advancing engine");
    if let Err(e) = engine.advance().await {
        send_workflow_error(sender, &envelope.id, "ADVANCE_FAILED", &format!("Failed to advance: {e}"));
    }
}

async fn handle_skip_item(envelope: WsEnvelope, sender: &WsSender) {
    let payload: WorkflowSkipItemPayload = match serde_json::from_value(envelope.payload.clone()) {
        Ok(p) => p,
        Err(e) => {
            send_workflow_error(sender, &envelope.id, "INVALID_PAYLOAD", &format!("Invalid skip_item payload: {e}"));
            return;
        }
    };

    let Some(engine) = get_engine(payload.feature_id) else {
        send_workflow_error(sender, &envelope.id, "NO_ENGINE", &format!("No workflow engine for feature {}", payload.feature_id));
        return;
    };

    if let Err(e) = engine.skip_item(payload.item_id).await {
        send_workflow_error(sender, &envelope.id, "SKIP_FAILED", &format!("Failed to skip item: {e}"));
    }
}

async fn handle_retry_item(envelope: WsEnvelope, sender: &WsSender) {
    let payload: WorkflowRetryItemPayload = match serde_json::from_value(envelope.payload.clone()) {
        Ok(p) => p,
        Err(e) => {
            send_workflow_error(sender, &envelope.id, "INVALID_PAYLOAD", &format!("Invalid retry_item payload: {e}"));
            return;
        }
    };

    let Some(engine) = get_engine(payload.feature_id) else {
        send_workflow_error(sender, &envelope.id, "NO_ENGINE", &format!("No workflow engine for feature {}", payload.feature_id));
        return;
    };

    if let Err(e) = engine.retry_item(payload.item_id).await {
        send_workflow_error(sender, &envelope.id, "RETRY_FAILED", &format!("Failed to retry item: {e}"));
    }
}

async fn handle_permission_respond(envelope: WsEnvelope, sender: &WsSender) {
    let payload: WorkflowPermissionRespondPayload = match serde_json::from_value(envelope.payload.clone()) {
        Ok(p) => p,
        Err(e) => {
            send_workflow_error(sender, &envelope.id, "INVALID_PAYLOAD", &format!("Invalid permission.respond payload: {e}"));
            return;
        }
    };

    let Some(engine) = get_engine(payload.feature_id) else {
        send_workflow_error(sender, &envelope.id, "NO_ENGINE", &format!("No workflow engine for feature {}", payload.feature_id));
        return;
    };

    // Parse decision string to PermissionDecision enum
    let decision = match payload.decision.as_str() {
        "allow_once" | "AllowOnce" => PermissionDecision::AllowOnce,
        "allow_future" | "AllowFuture" => PermissionDecision::AllowFuture,
        "deny" | "Deny" => PermissionDecision::Deny,
        other => {
            send_workflow_error(sender, &envelope.id, "INVALID_DECISION", &format!("Unknown decision: {other}"));
            return;
        }
    };

    let response = super::session_prompt::PermissionResponse {
        decision,
        feedback: payload.feedback,
        updated_input: payload.updated_input,
    };

    match engine.respond_permission(payload.queue_item_id, response).await {
        Ok(()) => {
            let ack = WsEnvelope::reply(&envelope.id, "workflow", "acknowledged", serde_json::json!({
                "feature_id": payload.feature_id,
                "action": "permission.respond",
            }));
            let _ = sender.send(Message::Text(String::from(ack).into()));
        }
        Err(e) => {
            warn!(feature_id = payload.feature_id, queue_item_id = payload.queue_item_id, error = %e, "permission.respond failed — agent may be orphaned");
            send_workflow_error(sender, &envelope.id, "AGENT_ORPHANED", &e);
        }
    }
}

async fn handle_prompt_send(envelope: WsEnvelope, sender: &WsSender, app_state: &AppState) {
    let payload: WorkflowPromptSendPayload = match serde_json::from_value(envelope.payload.clone()) {
        Ok(p) => p,
        Err(e) => {
            send_workflow_error(sender, &envelope.id, "INVALID_PAYLOAD", &format!("Invalid prompt.send payload: {e}"));
            return;
        }
    };

    let Some(engine) = get_engine(payload.feature_id) else {
        send_workflow_error(sender, &envelope.id, "NO_ENGINE", &format!("No workflow engine for feature {}", payload.feature_id));
        return;
    };

    // Persist user message if we can find the db_session_id
    if let Some(db_session_id_ref) = engine.active_items.get(&payload.queue_item_id) {
        let db_session_id = *db_session_id_ref;
        let p = WsSessionPersistence::with_session_id(
            app_state.write_pool.clone(),
            payload.feature_id,
            Some(db_session_id),
        );
        p.persist_user_message(&payload.text).await;
    }

    match engine.send_prompt(payload.queue_item_id, &payload.text, payload.images).await {
        Ok(()) => {
            let ack = WsEnvelope::reply(&envelope.id, "workflow", "acknowledged", serde_json::json!({
                "feature_id": payload.feature_id,
                "action": "prompt.send",
            }));
            let _ = sender.send(Message::Text(String::from(ack).into()));
        }
        Err(e) => {
            warn!(feature_id = payload.feature_id, queue_item_id = payload.queue_item_id, error = %e, "prompt.send failed — agent may be orphaned");
            send_workflow_error(sender, &envelope.id, "AGENT_ORPHANED", &e);
        }
    }
}

async fn handle_interrupt(envelope: WsEnvelope, sender: &WsSender, app_state: &AppState) {
    let payload: WorkflowInterruptPayload = match serde_json::from_value(envelope.payload.clone()) {
        Ok(p) => p,
        Err(e) => {
            send_workflow_error(sender, &envelope.id, "INVALID_PAYLOAD", &format!("Invalid interrupt payload: {e}"));
            return;
        }
    };

    let item_id = payload.queue_item_id;

    if let Some(engine) = get_engine(payload.feature_id) {
        match engine.interrupt_item(item_id).await {
            Ok(()) => {
                let ack = WsEnvelope::reply(&envelope.id, "workflow", "interrupted", serde_json::json!({
                    "feature_id": payload.feature_id,
                    "queue_item_id": item_id,
                    "status": "interrupted",
                }));
                let _ = sender.send(Message::Text(String::from(ack).into()));
            }
            Err(e) => {
                send_workflow_error(sender, &envelope.id, "INTERRUPT_FAILED", &format!("Failed to interrupt item {item_id}: {e}"));
            }
        }
    } else {
        // No engine (post-reconnect before engine re-created) — fall back to direct PID lookup
        info!(feature_id = payload.feature_id, item_id, "no engine, attempting PID-based interrupt");
        use crate::domain::features::repository as repo;

        match repo::get_queue_item(&app_state.read_pool, item_id).await {
            Ok(Some(item)) if item.pid.is_some() => {
                let pid = item.pid.unwrap();
                let result = unsafe { libc::kill(pid as libc::pid_t, libc::SIGINT) };
                if result == 0 {
                    info!(item_id, pid, "sent SIGINT via PID fallback (no engine)");
                    let ack = WsEnvelope::reply(&envelope.id, "workflow", "interrupted", serde_json::json!({
                        "feature_id": payload.feature_id,
                        "queue_item_id": item_id,
                        "status": "interrupted",
                    }));
                    let _ = sender.send(Message::Text(String::from(ack).into()));
                } else {
                    let err = std::io::Error::last_os_error();
                    if err.raw_os_error() == Some(libc::ESRCH) {
                        // Process already dead — mark as error
                        let _ = repo::mark_item_error(&app_state.write_pool, item_id, Some("Agent process no longer running")).await;
                        let err_env = WsEnvelope::new("workflow", "item_error", serde_json::json!({
                            "feature_id": payload.feature_id,
                            "queue_item_id": item_id,
                            "error": "Agent process no longer running",
                        }));
                        let _ = sender.send(Message::Text(String::from(err_env).into()));
                        send_workflow_error(sender, &envelope.id, "PROCESS_DEAD", "Agent process already exited");
                    } else {
                        send_workflow_error(sender, &envelope.id, "INTERRUPT_FAILED", &format!("kill({pid}, SIGINT) failed: {err}"));
                    }
                }
            }
            Ok(Some(_)) => {
                send_workflow_error(sender, &envelope.id, "NO_PID", &format!("No PID recorded for item {item_id}"));
            }
            Ok(None) => {
                send_workflow_error(sender, &envelope.id, "NOT_FOUND", &format!("Queue item {item_id} not found"));
            }
            Err(e) => {
                send_workflow_error(sender, &envelope.id, "DB_ERROR", &format!("Failed to look up item: {e}"));
            }
        }
    }
}

async fn handle_set_autonomy(envelope: WsEnvelope, sender: &WsSender) {
    let payload: WorkflowSetAutonomyPayload = match serde_json::from_value(envelope.payload.clone()) {
        Ok(p) => p,
        Err(e) => {
            send_workflow_error(sender, &envelope.id, "INVALID_PAYLOAD", &format!("Invalid set_autonomy payload: {e}"));
            return;
        }
    };

    let Some(engine) = get_engine(payload.feature_id) else {
        send_workflow_error(sender, &envelope.id, "NO_ENGINE", &format!("No workflow engine for feature {}", payload.feature_id));
        return;
    };

    engine.autonomy_level.store(payload.level, std::sync::atomic::Ordering::Relaxed);
    info!(
        feature_id = payload.feature_id,
        level = payload.level,
        "autonomy level updated"
    );

    let ack = WsEnvelope::reply(&envelope.id, "workflow", "autonomy.updated", serde_json::json!({
        "feature_id": payload.feature_id,
        "level": payload.level,
    }));
    let _ = sender.send(Message::Text(String::from(ack).into()));
}

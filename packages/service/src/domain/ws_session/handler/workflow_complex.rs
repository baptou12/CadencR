//! Complex workflow handler functions: feature_start, start_plan, start_prd,
//! approvals, populate_queue, start_build, continue.

use std::sync::Arc;

use axum::extract::ws::Message;
use serde::de::DeserializeOwned;
use tracing::{info, warn};

use crate::app_state::AppState;
use crate::domain::features::models::WorkflowType;
use crate::domain::workflow::engine::WorkflowEngine;
use crate::domain::workflow::status::WorkflowStatus;
use crate::domain::workflow::strategies;
use crate::domain::workflow::worktree;
use crate::domain::ws_session::protocol::*;
use super::WsSender;
use super::workflow::{
    ENGINES, ensure_background_tasks, parse_and_get_engine, parse_payload,
    send_workflow_error, to_value,
};
use super::workflow_interact::prepare_worktree;

pub(super) async fn handle_feature_start(
    envelope: WsEnvelope,
    sender: &WsSender,
    app_state: &AppState,
) {
    let Some(payload) = parse_payload::<WorkflowFeatureStartPayload>(&envelope, sender) else { return };
    let feature_id = payload.feature_id;
    let feature_row: Result<Option<(String,)>, _> = sqlx::query_as(
        "SELECT type FROM features WHERE id = ?"
    )
    .bind(feature_id)
    .fetch_optional(&app_state.read_pool)
    .await;

    let feature_type = match feature_row {
        Ok(Some((t,))) => t,
        Ok(None) => {
            send_workflow_error(sender, &envelope.id, "NOT_FOUND", &format!("Feature {feature_id} not found"));
            return;
        }
        Err(e) => {
            send_workflow_error(sender, &envelope.id, "LOOKUP_FAILED", &format!("Failed to look up feature: {e}"));
            return;
        }
    };
    let is_workflow_feature = feature_type == "ws-feature";
    let workflow_type_str = payload.workflow_type.unwrap_or_else(|| "feature_build".to_string());
    let workflow_type = WorkflowType::from_str(&workflow_type_str).unwrap_or(WorkflowType::FeatureBuild);
    handle_engine_create_or_reattach(feature_id, is_workflow_feature, &workflow_type, sender, app_state).await;
    // Read autonomy level from DB and apply to engine
    if let Some(engine) = ENGINES.get(&feature_id) {
        let project_id = match payload.project_id {
            Some(pid) => Some(pid),
            None => sqlx::query_scalar::<_, i64>("SELECT project_id FROM features WHERE id = ?")
                .bind(feature_id)
                .fetch_optional(&app_state.read_pool)
                .await
                .ok()
                .flatten(),
        };
        let autonomy_str = crate::domain::settings::resolve_setting(
            &app_state.read_pool,
            "agent_autonomy",
            Some(feature_id),
            project_id,
            Some("1"),
        ).await;
        let autonomy: u8 = autonomy_str
            .and_then(|s| s.parse().ok())
            .unwrap_or(1);

        engine.autonomy_level().store(autonomy, std::sync::atomic::Ordering::Relaxed);
        info!(feature_id, autonomy, "autonomy level loaded from DB");
    }
    info!(feature_id, workflow_type = %workflow_type.as_str(), "workflow engine created");
    let resp = WsEnvelope::reply(&envelope.id, "workflow", "feature.started", to_value(WorkflowFeatureStartResponse {
        feature_id,
        workflow_type: workflow_type.as_str().to_string(),
    }));
    let _ = sender.send(Message::Text(String::from(resp).into()));
}

async fn handle_engine_create_or_reattach(
    feature_id: i64,
    is_workflow_feature: bool,
    workflow_type: &WorkflowType,
    sender: &WsSender,
    app_state: &AppState,
) {
    if let Some(existing) = ENGINES.get(&feature_id) {
        info!(feature_id, "reattaching sender to existing engine on reconnect");
        existing.reattach_sender(sender.clone());
        if let Err(e) = existing.replay_state_to_client().await {
            warn!(feature_id, error = %e, "failed to replay state on reconnect");
        }
        drop(existing);
        ensure_background_tasks(app_state.agent_timeout_minutes);
    } else {
        let engine = match WorkflowEngine::new(
            feature_id,
            workflow_type.clone(),
            app_state.read_pool.clone(),
            app_state.write_pool.clone(),
            sender.clone(),
            app_state.max_parallel_agents,
            app_state.turn_state_tx.clone(),
        )
        .await
        {
            Ok(e) => Arc::new(e),
            Err(e) => {
                tracing::error!(feature_id, error = %e, "failed to create workflow engine");
                send_workflow_error(sender, "feature.start", "ENGINE_ERROR", &e);
                return;
            }
        };

        if is_workflow_feature {
            if let Err(e) = engine.restore_on_reconnect().await {
                warn!(feature_id, error = %e, "failed to restore on reconnect");
            }
        }

        ENGINES.insert(feature_id, engine);
        ensure_background_tasks(app_state.agent_timeout_minutes);
    }
}

/// Generic handler for agent spawns that require worktree prep and a status transition.
pub(super) async fn handle_start_agent_with_worktree<T, F, Fut>(
    envelope: WsEnvelope,
    sender: &WsSender,
    app_state: &AppState,
    active_status: WorkflowStatus,
    agent_name: &str,
    reply_action: &str,
    get_description: fn(&T) -> &str,
    spawn_fn: F,
) where
    T: DeserializeOwned + HasFeatureId,
    F: FnOnce(T, Arc<WorkflowEngine>) -> Fut,
    Fut: std::future::Future<Output = Result<i64, String>>,
{
    let Some((payload, engine)) = parse_and_get_engine::<T>(&envelope, sender) else { return };
    let feature_id = payload.feature_id();
    let description = get_description(&payload).to_string();

    engine.set_status(active_status).await;

    if let Err(e) = prepare_worktree(feature_id, &description, &engine.ws_sender, app_state).await {
        engine.set_status(WorkflowStatus::Idle).await;
        send_workflow_error(sender, &envelope.id, "WORKTREE_FAILED", &e);
        return;
    }

    info!(feature_id, "spawning {agent_name} agent");
    match spawn_fn(payload, engine.clone()).await {
        Ok(session_id) => {
            let ack = WsEnvelope::reply(&envelope.id, "workflow", reply_action, to_value(WorkflowFeatureIdSessionPayload {
                feature_id,
                session_id,
            }));
            let _ = sender.send(Message::Text(String::from(ack).into()));
        }
        Err(e) => {
            engine.set_status(WorkflowStatus::Idle).await;
            send_workflow_error(sender, &envelope.id, "SPAWN_FAILED", &format!("Failed to spawn {agent_name}: {e}"));
        }
    }
}

pub(super) async fn handle_start_plan(envelope: WsEnvelope, sender: &WsSender, app_state: &AppState) {
    handle_start_agent_with_worktree::<WorkflowStartPlanPayload, _, _>(
        envelope, sender, app_state,
        WorkflowStatus::Planning, "plan", "plan.started",
        |p| &p.description,
        |p, engine| async move { engine.spawn_plan_agent(&p.description, &p.images.unwrap_or_default()).await },
    ).await;
}

pub(super) async fn handle_start_prd(envelope: WsEnvelope, sender: &WsSender, app_state: &AppState) {
    handle_start_agent_with_worktree::<WorkflowStartPrdPayload, _, _>(
        envelope, sender, app_state,
        WorkflowStatus::Prd, "PRD", "prd.started",
        |p| &p.description,
        |p, engine| async move { engine.spawn_prd_agent(&p.description).await },
    ).await;
}

pub(super) async fn handle_plan_approval(envelope: WsEnvelope, sender: &WsSender) {
    use crate::domain::workflow::engine::AgentSlot;
    handle_approval(envelope, sender, "plan", AgentSlot::Plan).await;
}

pub(super) async fn handle_prd_approval(envelope: WsEnvelope, sender: &WsSender) {
    use crate::domain::workflow::engine::AgentSlot;
    handle_approval(envelope, sender, "prd", AgentSlot::Prd).await;
}

async fn handle_approval(envelope: WsEnvelope, sender: &WsSender, kind: &str, slot: crate::domain::workflow::engine::AgentSlot) {
    let Some((payload, engine)) = parse_and_get_engine::<WorkflowApprovalPayload>(&envelope, sender) else { return };

    let approved = payload.approved;
    let feature_id = payload.feature_id;
    info!(feature_id, approved, kind, "resolving approval via permission channel");

    let decision = if approved { PermissionDecision::AllowOnce } else { PermissionDecision::Deny };
    let response = super::session_prompt::PermissionResponse {
        decision,
        feedback: payload.feedback.clone(),
        updated_input: None,
    };

    update_approval_status(&engine, kind, approved).await;
    persist_approval_message(&engine, &payload, kind, approved, &slot).await;

    // Clear pending_plan_approval in DB (it was set for app-restart persistence)
    if let Err(e) = sqlx::query(
        "UPDATE agent_sessions SET pending_plan_approval = NULL WHERE feature_id = ? AND agent_type = ?"
    )
    .bind(feature_id)
    .bind(kind)
    .execute(&engine.write_pool)
    .await
    {
        warn!(feature_id, error = %e, "failed to clear pending_plan_approval");
    }

    match engine.respond_permission(slot.clone(), response).await {
        Ok(()) => info!(feature_id, kind, "approval routed through permission channel"),
        Err(e) => {
            // Agent is dead (e.g. after app restart). Mark session completed
            // and auto-advance the workflow to the next step.
            warn!(feature_id, error = %e, kind, "agent not waiting — marking completed and auto-advancing");
            if let Err(e) = sqlx::query(
                "UPDATE agent_sessions SET status = 'completed' WHERE feature_id = ? AND agent_type = ? AND status IN ('running', 'paused')"
            )
            .bind(feature_id)
            .bind(kind)
            .execute(&engine.write_pool)
            .await
            {
                warn!(feature_id, error = %e, "failed to mark agent session as completed");
            }

            resume_agent_after_approval(
                &engine, slot.clone(), kind, feature_id, approved,
                payload.feedback.as_deref(),
            ).await;
        }
    }

    let ack = WsEnvelope::reply(&envelope.id, "workflow", format!("{kind}.approval_resolved"), to_value(WorkflowApprovalResolvedPayload {
        feature_id: payload.feature_id,
        approved,
    }));
    let _ = sender.send(Message::Text(String::from(ack).into()));
}

/// After app restart, the agent is dead. Resume it via send_prompt so it
/// continues from where it left off (using --resume with its claude_session_id).
async fn resume_agent_after_approval(
    engine: &WorkflowEngine,
    slot: crate::domain::workflow::engine::AgentSlot,
    kind: &str,
    feature_id: i64,
    approved: bool,
    feedback: Option<&str>,
) {
    let label = if kind == "plan" { "Plan" } else { "PRD" };
    let prompt = if approved {
        format!("{label} approved by the user. Your work is done — call `mark_agent_done` now.")
    } else {
        match feedback {
            Some(fb) => format!("{label} rejected by the user. Feedback: {fb}\n\nPlease revise the {kind} based on this feedback, then call show_{kind} again for approval."),
            None => format!("{label} rejected by the user. Please revise and call show_{kind} again."),
        }
    };
    info!(feature_id, kind, "resuming dead agent after approval");
    if let Err(e) = engine.send_prompt(slot, &prompt, None).await {
        warn!(feature_id, error = %e, kind, "failed to resume agent after approval");
    }
}

async fn update_approval_status(engine: &WorkflowEngine, kind: &str, approved: bool) {
    if kind == "plan" {
        engine.set_status(if approved { WorkflowStatus::ReadyToBuild } else { WorkflowStatus::Planning }).await;
    } else if kind == "prd" {
        engine.set_status(if approved { WorkflowStatus::Planning } else { WorkflowStatus::Prd }).await;
    }
}

async fn persist_approval_message(
    engine: &WorkflowEngine,
    payload: &WorkflowApprovalPayload,
    kind: &str,
    approved: bool,
    slot: &crate::domain::workflow::engine::AgentSlot,
) {
    if let Some(db_session_id) = engine.active_items().get(slot).map(|r| *r) {
        let label = if kind == "plan" { "Plan" } else { "PRD" };
        let content = if approved {
            format!("✅ {label} approved")
        } else if let Some(ref fb) = payload.feedback {
            format!("**{label} feedback:**\n{fb}")
        } else {
            format!("❌ {label} rejected")
        };
        if let Err(e) = sqlx::query(
            "INSERT INTO agent_messages (session_id, role, content, message_type) VALUES (?, 'user', ?, 'user_message')"
        )
        .bind(db_session_id)
        .bind(&content)
        .execute(&engine.write_pool)
        .await {
            warn!(feature_id = payload.feature_id, error = %e, "failed to persist approval user message");
        }
    }
}

pub(super) async fn handle_populate_queue(envelope: WsEnvelope, sender: &WsSender, app_state: &AppState) {
    let Some((payload, engine)) = parse_and_get_engine::<WorkflowPopulateQueuePayload>(&envelope, sender) else { return };

    let feature_id = payload.feature_id;
    let strategy = match strategies::get_strategy(&engine.workflow_type) {
        Ok(s) => s,
        Err(e) => {
            send_workflow_error(sender, &envelope.id, "STRATEGY_ERROR", &e);
            return;
        }
    };
    info!(feature_id, "populating workflow queue");
    match strategy
        .populate_queue(&app_state.write_pool, &app_state.read_pool, feature_id, payload.plan_id)
        .await
    {
        Ok(items) => {
            let ack = WsEnvelope::reply(&envelope.id, "workflow", "queue.populated", to_value(WorkflowQueuePopulatedPayload {
                feature_id,
                item_count: items.len(),
            }));
            let _ = sender.send(Message::Text(String::from(ack).into()));
        }
        Err(e) => {
            send_workflow_error(sender, &envelope.id, "POPULATE_FAILED", &format!("Failed to populate queue: {e}"));
        }
    }
}

pub(super) async fn handle_start_build(envelope: WsEnvelope, sender: &WsSender, app_state: &AppState) {
    let Some((payload, engine)) = parse_and_get_engine::<WorkflowStartBuildPayload>(&envelope, sender) else { return };
    if let Err(e) = auto_populate_if_empty(&payload, &engine, app_state, sender, &envelope).await {
        send_workflow_error(sender, &envelope.id, "POPULATE_FAILED", &e);
        return;
    }

    send_queue_state(payload.feature_id, sender, &engine).await;
    ensure_worktree_for_build(payload.feature_id, &engine, app_state).await;
    engine.set_status(WorkflowStatus::Building).await;
    if sqlx::query("UPDATE features SET status = 'in-progress' WHERE id = ? AND status NOT IN ('in-progress', 'done', 'archived')")
        .bind(payload.feature_id)
        .execute(&app_state.write_pool)
        .await
        .map(|r| r.rows_affected() > 0)
        .unwrap_or(false)
    {
        crate::domain::workflow::engine::send_feature_updated_envelope(&engine.ws_sender, payload.feature_id, &["status"]);
    }

    info!(feature_id = payload.feature_id, "start_build: advancing engine");
    if let Err(e) = engine.advance().await {
        send_workflow_error(sender, &envelope.id, "ADVANCE_FAILED", &format!("Failed to advance: {e}"));
    }
}

async fn auto_populate_if_empty(
    payload: &WorkflowStartBuildPayload,
    engine: &Arc<WorkflowEngine>,
    app_state: &AppState,
    sender: &WsSender,
    envelope: &WsEnvelope,
) -> Result<(), String> {
    let item_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM workflow_queue WHERE feature_id = ?")
        .bind(payload.feature_id)
        .fetch_one(&app_state.read_pool)
        .await
        .unwrap_or(0);
    if item_count == 0 {
        info!(feature_id = payload.feature_id, "start_build: queue empty, populating first");
        let strategy = strategies::get_strategy(&engine.workflow_type)
            .inspect_err(|e| { send_workflow_error(sender, &envelope.id, "STRATEGY_ERROR", e); })?;
        let plan_id: Option<i64> = sqlx::query_scalar("SELECT id FROM plans WHERE feature_id = ? ORDER BY id DESC LIMIT 1")
            .bind(payload.feature_id)
            .fetch_optional(&app_state.read_pool)
            .await
            .ok()
            .flatten();
        strategy.populate_queue(&app_state.write_pool, &app_state.read_pool, payload.feature_id, plan_id).await
            .map_err(|e| format!("Failed to populate queue: {e}"))?;
    }
    Ok(())
}

async fn send_queue_state(feature_id: i64, sender: &WsSender, engine: &WorkflowEngine) {
    if let Ok(items) = crate::domain::features::repository::get_queue_for_feature(&engine.read_pool, feature_id).await {
        let queue_env = WsEnvelope::new(
            "workflow",
            "queue_update",
            to_value(WorkflowQueueUpdatePayload {
                feature_id,
                items,
                workflow_status: None,
            }),
        );
        let _ = sender.send(Message::Text(String::from(queue_env).into()));
    }
}

async fn ensure_worktree_for_build(feature_id: i64, engine: &WorkflowEngine, app_state: &AppState) {
    match worktree::get_project_id_for_feature(&app_state.read_pool, feature_id).await {
        Ok(project_id) => {
            if let Err(e) = worktree::ensure_worktree(
                &app_state.read_pool, &app_state.write_pool, feature_id, project_id, &engine.ws_sender,
            ).await {
                warn!(feature_id, error = %e, "ensure_worktree failed in start_build (continuing anyway)");
            }
        }
        Err(e) => {
            warn!(feature_id, error = %e, "could not look up project_id for worktree (continuing anyway)");
        }
    }
}

pub(super) async fn handle_continue(envelope: WsEnvelope, sender: &WsSender) {
    let Some((payload, engine)) = parse_and_get_engine::<WorkflowContinuePayload>(&envelope, sender) else { return };
    engine.set_status(WorkflowStatus::Building).await;
    if sqlx::query("UPDATE features SET status = 'in-progress' WHERE id = ? AND status NOT IN ('in-progress', 'done', 'archived')")
        .bind(payload.feature_id)
        .execute(&engine.write_pool)
        .await
        .map(|r| r.rows_affected() > 0)
        .unwrap_or(false)
    {
        crate::domain::workflow::engine::send_feature_updated_envelope(&engine.ws_sender, payload.feature_id, &["status"]);
    }
    send_queue_state(payload.feature_id, sender, &engine).await;
    info!(feature_id = payload.feature_id, "continue: advancing engine");
    if let Err(e) = engine.advance().await {
        send_workflow_error(sender, &envelope.id, "ADVANCE_FAILED", &format!("Failed to advance: {e}"));
    }
}

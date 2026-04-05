//! Custom workflow handler functions.
//!
//! Extracted from workflow.rs to keep that file under 400 lines.
//! Handles phase approval, phase trigger, and feature start for custom workflow features.

use std::sync::Arc;

use axum::extract::ws::Message;
use tracing::info;

use crate::app_state::AppState;
use crate::domain::features::models::WorkflowType;
use crate::domain::features::repository as features_repo;
use crate::domain::workflow::engine::WorkflowEngine;
use crate::domain::workflow::engine::WsSender as EngineWsSender;
use crate::domain::workflow::worktree;
use crate::domain::ws_session::auto_name;
use crate::domain::ws_session::protocol::*;
use super::WsSender;
use super::workflow::{ENGINES, ensure_background_tasks, send_workflow_error, parse_and_get_engine, parse_payload, to_value};

/// Check if a feature uses a custom workflow definition.
/// Returns true if the feature has a workflow_definition_id (i.e. is a custom workflow feature).
pub(super) async fn is_custom_workflow_feature(feature_id: i64, read_pool: &sqlx::SqlitePool) -> Result<bool, String> {
    let row: Option<(Option<i64>,)> = sqlx::query_as(
        "SELECT workflow_definition_id FROM features WHERE id = ?"
    )
    .bind(feature_id)
    .fetch_optional(read_pool)
    .await
    .map_err(|e| format!("Failed to check feature workflow type: {e}"))?;

    match row {
        Some((wd_id,)) => Ok(wd_id.is_some()),
        None => Err(format!("Feature {feature_id} not found")),
    }
}

/// Guard that rejects custom-only actions on legacy (non-custom) workflow features.
/// Returns true if the action should be blocked (i.e. feature is NOT a custom workflow).
pub(super) async fn guard_custom_action(
    envelope: &WsEnvelope,
    sender: &WsSender,
    read_pool: &sqlx::SqlitePool,
) -> bool {
    let feature_id = envelope.payload.get("feature_id").and_then(|v| v.as_i64());
    let Some(feature_id) = feature_id else {
        return false;
    };
    match is_custom_workflow_feature(feature_id, read_pool).await {
        Ok(false) => {
            send_workflow_error(
                sender,
                &envelope.id,
                "WRONG_WORKFLOW_TYPE",
                "This action is only available for custom workflow features",
            );
            true
        }
        Ok(true) => false,
        Err(e) => {
            send_workflow_error(sender, &envelope.id, "GUARD_ERROR", &e);
            true
        }
    }
}

/// Guard that rejects legacy actions on custom workflow features.
/// Returns true if the action should be blocked (i.e. feature is custom workflow).
pub(super) async fn guard_legacy_action(
    envelope: &WsEnvelope,
    sender: &WsSender,
    read_pool: &sqlx::SqlitePool,
) -> bool {
    let feature_id = envelope.payload.get("feature_id").and_then(|v| v.as_i64());
    let Some(feature_id) = feature_id else {
        return false;
    };
    match is_custom_workflow_feature(feature_id, read_pool).await {
        Ok(true) => {
            send_workflow_error(
                sender,
                &envelope.id,
                "WRONG_WORKFLOW_TYPE",
                "Use workflow.* actions for custom workflow features",
            );
            true
        }
        Ok(false) => false,
        Err(e) => {
            send_workflow_error(sender, &envelope.id, "GUARD_ERROR", &e);
            true
        }
    }
}

/// Resolve the correct workflow strategy for a feature.
pub(super) async fn resolve_strategy(
    workflow_type: &WorkflowType,
    feature_id: i64,
    read_pool: &sqlx::SqlitePool,
) -> Result<Box<dyn crate::domain::workflow::strategies::WorkflowStrategy>, String> {
    match workflow_type {
        WorkflowType::Custom => {
            let wd_id: Option<i64> = sqlx::query_scalar(
                "SELECT workflow_definition_id FROM features WHERE id = ?",
            )
            .bind(feature_id)
            .fetch_optional(read_pool)
            .await
            .map_err(|e| format!("Failed to resolve workflow definition: {e}"))?
            .flatten();
            match wd_id {
                Some(id) => Ok(crate::domain::workflow::strategies::get_custom_strategy(id)),
                None => Err("Custom workflow feature missing workflow_definition_id".into()),
            }
        }
        _ => crate::domain::workflow::strategies::get_strategy(workflow_type),
    }
}

pub(super) async fn handle_phase_approval(
    envelope: WsEnvelope,
    sender: &WsSender,
    _app_state: &AppState,
) {
    let Some((payload, engine)) = parse_and_get_engine::<WorkflowPhaseApprovalPayload>(&envelope, sender) else { return };

    info!(
        feature_id = payload.feature_id,
        phase_slug = %payload.phase_slug,
        approved = payload.approved,
        "phase approval received"
    );

    match engine.queue.approve_phase(
        &payload.phase_slug,
        payload.approved,
        payload.feedback.as_deref(),
        &engine.agent_manager,
        &engine.permissions,
        engine.as_ref(),
    ).await {
        Ok(()) => {
            let ack = WsEnvelope::reply(&envelope.id, "workflow", "acknowledged", to_value(WorkflowAcknowledgedPayload {
                feature_id: payload.feature_id,
                action: "phase_approval".into(),
            }));
            let _ = sender.send(Message::Text(String::from(ack).into()));
        }
        Err(e) => {
            send_workflow_error(sender, &envelope.id, "PHASE_APPROVAL_FAILED", &format!("Failed: {e}"));
        }
    }
}

pub(super) async fn handle_phase_trigger(
    envelope: WsEnvelope,
    sender: &WsSender,
    _app_state: &AppState,
) {
    let Some((payload, engine)) = parse_and_get_engine::<WorkflowPhaseTriggerPayload>(&envelope, sender) else { return };

    info!(feature_id = payload.feature_id, phase_slug = %payload.phase_slug, "manual phase trigger");

    match engine.queue.trigger_manual_phase(
        &payload.phase_slug,
        &engine.agent_manager,
        &engine.permissions,
    ).await {
        Ok(()) => {
            let ack = WsEnvelope::reply(&envelope.id, "workflow", "acknowledged", to_value(WorkflowAcknowledgedPayload {
                feature_id: payload.feature_id,
                action: "phase_trigger".into(),
            }));
            let _ = sender.send(Message::Text(String::from(ack).into()));
        }
        Err(e) => {
            send_workflow_error(sender, &envelope.id, "PHASE_TRIGGER_FAILED", &format!("Failed to trigger phase: {e}"));
        }
    }
}

pub(super) async fn handle_feature_start_custom(
    envelope: WsEnvelope,
    sender: &WsSender,
    app_state: &AppState,
) {
    let Some(payload) = parse_payload::<WorkflowFeatureStartCustomPayload>(&envelope, sender) else { return };

    let feature_id = payload.feature_id;
    let workflow_definition_id = payload.workflow_definition_id;

    // Verify the feature exists. If it already has this workflow definition, skip the set step.
    // If it has a *different* workflow definition, reject (can't change workflow once set).
    let existing_wd_id: Option<Option<i64>> = sqlx::query_as(
        "SELECT workflow_definition_id FROM features WHERE id = ?"
    )
    .bind(feature_id)
    .fetch_optional(&app_state.read_pool)
    .await
    .ok()
    .flatten()
    .map(|(v,): (Option<i64>,)| v);

    match existing_wd_id {
        None => {
            send_workflow_error(sender, &envelope.id, "NOT_FOUND", &format!("Feature {feature_id} not found"));
            return;
        }
        Some(Some(existing_id)) if existing_id != workflow_definition_id => {
            send_workflow_error(sender, &envelope.id, "ALREADY_CUSTOM", "Feature already has a different workflow definition");
            return;
        }
        Some(None) => {
            // Legacy feature — set the workflow definition
            if let Err(e) = features_repo::set_workflow_definition_id(&app_state.write_pool, feature_id, workflow_definition_id).await {
                send_workflow_error(sender, &envelope.id, "DB_ERROR", &format!("Failed to set workflow definition: {e}"));
                return;
            }
        }
        Some(Some(_)) => {} // Already has the same workflow_definition_id — proceed
    }

    // Store the user's description in the feature's prd field so templates can use {{feature_description}}
    if let Some(ref description) = payload.description {
        if !description.is_empty() {
            if let Err(e) = sqlx::query("UPDATE features SET prd = ? WHERE id = ?")
                .bind(description)
                .bind(feature_id)
                .execute(&app_state.write_pool)
                .await
            {
                tracing::warn!(feature_id, error = %e, "failed to store feature description");
            }
        }
    }

    // Store worktree preference (default true for backwards compatibility)
    let use_worktree = payload.use_worktree.unwrap_or(true);
    if !use_worktree {
        let _ = worktree::set_setting(
            &app_state.write_pool, feature_id, "skip_worktree", "true",
        ).await;
    }

    info!(feature_id, workflow_definition_id, "starting feature with custom workflow");

    // Resolve project info once (used by both auto-naming and worktree setup)
    let project_id_resolved = worktree::get_project_id_for_feature(&app_state.read_pool, feature_id).await.ok();

    // Auto-name the feature if it still has a default title (needed for worktree branch name)
    if auto_name::has_default_title(&app_state.read_pool, feature_id).await {
        let description_text = payload.description.as_deref().unwrap_or_default();
        if !description_text.is_empty() {
            info!(feature_id, "auto-naming feature before custom workflow start");
            let project_dir = match project_id_resolved {
                Some(pid) => worktree::get_project_directory(&app_state.read_pool, pid).await.unwrap_or_default(),
                None => String::new(),
            };
            let _ = auto_name::auto_name_feature(
                app_state.write_pool.clone(),
                feature_id,
                description_text.to_string(),
                project_dir,
                None,
                sender.clone(),
            ).await;
        }
    }

    // Prepare worktree if enabled (blocking — must complete before agents start)
    if use_worktree {
        if let Some(proj_id) = project_id_resolved {
            let engine_ws = EngineWsSender::new(sender.clone());
            match worktree::ensure_worktree(
                &app_state.read_pool,
                &app_state.write_pool,
                feature_id,
                proj_id,
                &engine_ws,
            ).await {
                Ok(wt_path) => {
                    info!(feature_id, path = %wt_path.display(), "worktree ready for custom workflow");
                    let setup_step = worktree::get_setting(&app_state.read_pool, feature_id, "worktree_setup_step").await;
                    if setup_step.as_deref() != Some("ready") {
                        let rp = app_state.read_pool.clone();
                        let wp = app_state.write_pool.clone();
                        let ws = engine_ws.clone();
                        tokio::spawn(async move {
                            worktree::run_setup_commands(rp, wp, feature_id, wt_path, ws).await;
                        });
                    }
                }
                Err(e) => {
                    tracing::warn!(feature_id, error = %e, "worktree creation failed for custom workflow (continuing anyway)");
                }
            }
        }
    }

    // Create engine with Custom workflow type
    let engine = match WorkflowEngine::new(
        feature_id,
        WorkflowType::Custom,
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
            tracing::error!(feature_id, error = %e, "failed to create custom workflow engine");
            send_workflow_error(sender, &envelope.id, "ENGINE_ERROR", &e);
            return;
        }
    };

    // Populate the queue using CustomWorkflowStrategy
    let strategy = crate::domain::workflow::strategies::get_custom_strategy(workflow_definition_id);
    match strategy
        .populate_queue(&app_state.write_pool, &app_state.read_pool, feature_id, None)
        .await
    {
        Ok(items) => {
            info!(feature_id, item_count = items.len(), "custom workflow queue populated");

            // Send queue_update so the frontend store has the queue items for rendering
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
        Err(e) => {
            send_workflow_error(sender, &envelope.id, "POPULATE_FAILED", &format!("Failed to populate custom workflow queue: {e}"));
            return;
        }
    }

    ENGINES.insert(feature_id, engine);
    ensure_background_tasks(app_state.agent_timeout_minutes);

    // Start the first ready phase(s)
    if let Some(engine) = ENGINES.get(&feature_id) {
        if let Err(e) = engine.queue.advance(&engine.agent_manager, &engine.permissions).await {
            tracing::error!(feature_id, error = %e, "failed to auto-advance after custom workflow start");
        }
    }

    let ack = WsEnvelope::reply(&envelope.id, "workflow", "acknowledged", to_value(WorkflowAcknowledgedPayload {
        feature_id,
        action: "feature_start_custom".into(),
    }));
    let _ = sender.send(Message::Text(String::from(ack).into()));
}

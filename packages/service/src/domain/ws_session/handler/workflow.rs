use std::sync::atomic::Ordering;
use std::sync::{Arc, LazyLock, Once};

use axum::extract::ws::Message;
use dashmap::DashMap;
use serde::de::DeserializeOwned;
use tracing::{info, warn};

use crate::app_state::AppState;
use crate::domain::features::models::WorkflowType;
use crate::domain::workflow::engine::WorkflowEngine;
use crate::domain::workflow::worktree;
use crate::domain::ws_session::auto_name;
use crate::domain::ws_session::persistence::WsSessionPersistence;
use crate::domain::ws_session::protocol::*;
use super::{SdkSessions, WsSender};

/// Global engine registry: one engine per feature_id at a time.
static ENGINES: LazyLock<DashMap<i64, Arc<WorkflowEngine>>> = LazyLock::new(DashMap::new);
static EVICTION_INIT: Once = Once::new();

/// Spawn the global ENGINES eviction task (runs once).
/// Evicts engines that have been idle for >30 minutes with no active items.
fn ensure_eviction_task() {
    EVICTION_INIT.call_once(|| {
        tokio::spawn(async {
            let interval = std::time::Duration::from_secs(5 * 60); // check every 5 min
            let idle_threshold_secs: u64 = 30 * 60; // 30 min idle
            loop {
                tokio::time::sleep(interval).await;
                let now = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_secs();

                let mut to_evict = Vec::new();
                for entry in ENGINES.iter() {
                    let engine = entry.value();
                    if engine.active_items.is_empty() {
                        let last = engine.last_activity.load(Ordering::Relaxed);
                        if now.saturating_sub(last) > idle_threshold_secs {
                            to_evict.push(*entry.key());
                        }
                    }
                }
                for feature_id in to_evict {
                    if let Some((_, engine)) = ENGINES.remove(&feature_id) {
                        engine.cancel();
                        info!(feature_id, "evicted idle workflow engine from ENGINES registry");
                    }
                }
            }
        });
    });
}

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

/// Parse a workflow payload and look up the engine in one step.
/// Sends an error envelope and returns `None` on failure.
fn parse_and_get_engine<T: DeserializeOwned + HasFeatureId>(
    envelope: &WsEnvelope,
    sender: &WsSender,
) -> Option<(T, Arc<WorkflowEngine>)> {
    let payload: T = match serde_json::from_value(envelope.payload.clone()) {
        Ok(p) => p,
        Err(e) => {
            send_workflow_error(sender, &envelope.id, "INVALID_PAYLOAD", &format!("Invalid payload: {e}"));
            return None;
        }
    };
    let engine = match get_engine(payload.feature_id()) {
        Some(e) => e,
        None => {
            send_workflow_error(sender, &envelope.id, "NO_ENGINE", &format!("No workflow engine for feature {}", payload.feature_id()));
            return None;
        }
    };
    Some((payload, engine))
}

/// Parse a workflow payload without requiring an engine.
/// Sends an error envelope and returns `None` on failure.
fn parse_payload<T: DeserializeOwned>(
    envelope: &WsEnvelope,
    sender: &WsSender,
) -> Option<T> {
    match serde_json::from_value(envelope.payload.clone()) {
        Ok(p) => Some(p),
        Err(e) => {
            send_workflow_error(sender, &envelope.id, "INVALID_PAYLOAD", &format!("Invalid payload: {e}"));
            None
        }
    }
}

/// Helper to serialize a typed payload to serde_json::Value.
fn to_value<T: serde::Serialize>(v: T) -> serde_json::Value {
    serde_json::to_value(v).unwrap()
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
        "start_plan" => handle_start_plan(envelope, sender, app_state).await,
        "start_prd" => handle_start_prd(envelope, sender, app_state).await,
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
        "start_session" => handle_start_session(envelope, sender).await,
        "start_refine" => handle_start_refine(envelope, sender).await,
        "start_review_fixer" => handle_start_review_fixer(envelope, sender).await,
        "mark_done" => handle_mark_done(envelope, sender).await,
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
    let Some(payload) = parse_payload::<WorkflowFeatureStartPayload>(&envelope, sender) else { return };

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

    // Start timeout checker (configurable via CADENCE_AGENT_TIMEOUT_MINUTES)
    engine.spawn_timeout_checker(app_state.agent_timeout_minutes);

    ENGINES.insert(feature_id, engine);
    ensure_eviction_task();

    info!(feature_id, workflow_type = %workflow_type.as_str(), "workflow engine created");

    let resp = WsEnvelope::reply(&envelope.id, "workflow", "feature.started", to_value(WorkflowFeatureStartResponse {
        feature_id,
        workflow_type: workflow_type.as_str().to_string(),
    }));
    let _ = sender.send(Message::Text(String::from(resp).into()));
}

async fn handle_start_plan(envelope: WsEnvelope, sender: &WsSender, app_state: &AppState) {
    let Some((payload, engine)) = parse_and_get_engine::<WorkflowStartPlanPayload>(&envelope, sender) else { return };
    let feature_id = payload.feature_id;

    // Auto-name if needed, ensure worktree exists
    if let Err(e) = prepare_worktree(feature_id, &payload.description, sender, app_state).await {
        send_workflow_error(sender, &envelope.id, "WORKTREE_FAILED", &e);
        return;
    }

    info!(feature_id, "spawning plan agent");
    match engine.spawn_plan_agent(&payload.description).await {
        Ok(session_id) => {
            let ack = WsEnvelope::reply(&envelope.id, "workflow", "plan.started", to_value(WorkflowFeatureIdSessionPayload {
                feature_id,
                session_id,
            }));
            let _ = sender.send(Message::Text(String::from(ack).into()));
        }
        Err(e) => {
            send_workflow_error(sender, &envelope.id, "SPAWN_FAILED", &format!("Failed to spawn plan agent: {e}"));
        }
    }
}

async fn handle_start_prd(envelope: WsEnvelope, sender: &WsSender, app_state: &AppState) {
    let Some((payload, engine)) = parse_and_get_engine::<WorkflowStartPrdPayload>(&envelope, sender) else { return };
    let feature_id = payload.feature_id;

    // Auto-name if needed, ensure worktree exists
    if let Err(e) = prepare_worktree(feature_id, &payload.description, sender, app_state).await {
        send_workflow_error(sender, &envelope.id, "WORKTREE_FAILED", &e);
        return;
    }

    info!(feature_id, "spawning PRD agent");
    match engine.spawn_prd_agent(&payload.description).await {
        Ok(session_id) => {
            let ack = WsEnvelope::reply(&envelope.id, "workflow", "prd.started", to_value(WorkflowFeatureIdSessionPayload {
                feature_id,
                session_id,
            }));
            let _ = sender.send(Message::Text(String::from(ack).into()));
        }
        Err(e) => {
            send_workflow_error(sender, &envelope.id, "SPAWN_FAILED", &format!("Failed to spawn PRD agent: {e}"));
        }
    }
}

async fn handle_plan_approval(envelope: WsEnvelope, sender: &WsSender) {
    handle_approval(envelope, sender, "plan").await;
}

async fn handle_prd_approval(envelope: WsEnvelope, sender: &WsSender) {
    handle_approval(envelope, sender, "prd").await;
}

async fn handle_approval(envelope: WsEnvelope, sender: &WsSender, kind: &str) {
    let Some((payload, engine)) = parse_and_get_engine::<WorkflowApprovalPayload>(&envelope, sender) else { return };

    let approved = payload.approved;
    let prefix = format!("{kind}-approval-");
    info!(feature_id = payload.feature_id, approved, kind, "resolving approval");

    match engine.resolve_approval(&prefix, approved, payload.feedback.clone()).await {
        Ok(resolved) => {
            if !resolved {
                let _ = engine.resolve_approval(&payload.request_id, approved, payload.feedback).await;
            }
        }
        Err(e) => {
            warn!(feature_id = payload.feature_id, error = %e, kind, "failed to resolve approval");
        }
    }

    let ack = WsEnvelope::reply(&envelope.id, "workflow", &format!("{kind}.approval_resolved"), to_value(WorkflowApprovalResolvedPayload {
        feature_id: payload.feature_id,
        approved,
    }));
    let _ = sender.send(Message::Text(String::from(ack).into()));
}

async fn handle_populate_queue(envelope: WsEnvelope, sender: &WsSender, app_state: &AppState) {
    let Some((payload, engine)) = parse_and_get_engine::<WorkflowPopulateQueuePayload>(&envelope, sender) else { return };

    let feature_id = payload.feature_id;
    let strategy = match crate::domain::workflow::strategies::get_strategy(&engine.workflow_type) {
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

async fn handle_start_build(envelope: WsEnvelope, sender: &WsSender, app_state: &AppState) {
    let Some((payload, engine)) = parse_and_get_engine::<WorkflowStartBuildPayload>(&envelope, sender) else { return };

    // Check if queue needs populating — use a COUNT query instead of fetching all items
    let item_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM workflow_queue WHERE feature_id = ?")
        .bind(payload.feature_id)
        .fetch_one(&app_state.read_pool)
        .await
        .unwrap_or(0);

    if item_count == 0 {
        info!(feature_id = payload.feature_id, "start_build: queue empty, populating first");
        let strategy = match crate::domain::workflow::strategies::get_strategy(&engine.workflow_type) {
            Ok(s) => s,
            Err(e) => {
                send_workflow_error(sender, &envelope.id, "STRATEGY_ERROR", &e);
                return;
            }
        };
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

    // Ensure worktree exists (idempotent)
    match worktree::get_project_id_for_feature(&app_state.read_pool, payload.feature_id).await {
        Ok(project_id) => {
            if let Err(e) = worktree::ensure_worktree(
                &app_state.read_pool,
                &app_state.write_pool,
                payload.feature_id,
                project_id,
                sender,
            ).await {
                warn!(feature_id = payload.feature_id, error = %e, "ensure_worktree failed in start_build (continuing anyway)");
            }
        }
        Err(e) => {
            warn!(feature_id = payload.feature_id, error = %e, "could not look up project_id for worktree (continuing anyway)");
        }
    }

    info!(feature_id = payload.feature_id, "start_build: advancing engine");
    if let Err(e) = engine.advance().await {
        send_workflow_error(sender, &envelope.id, "ADVANCE_FAILED", &format!("Failed to advance: {e}"));
    }
}

async fn handle_continue(envelope: WsEnvelope, sender: &WsSender) {
    let Some((payload, engine)) = parse_and_get_engine::<WorkflowContinuePayload>(&envelope, sender) else { return };

    info!(feature_id = payload.feature_id, "continue: advancing engine");
    if let Err(e) = engine.advance().await {
        send_workflow_error(sender, &envelope.id, "ADVANCE_FAILED", &format!("Failed to advance: {e}"));
    }
}

async fn handle_skip_item(envelope: WsEnvelope, sender: &WsSender) {
    let Some((payload, engine)) = parse_and_get_engine::<WorkflowSkipItemPayload>(&envelope, sender) else { return };

    if let Err(e) = engine.skip_item(payload.item_id).await {
        send_workflow_error(sender, &envelope.id, "SKIP_FAILED", &format!("Failed to skip item: {e}"));
    }
}

async fn handle_retry_item(envelope: WsEnvelope, sender: &WsSender) {
    let Some((payload, engine)) = parse_and_get_engine::<WorkflowRetryItemPayload>(&envelope, sender) else { return };

    if let Err(e) = engine.retry_item(payload.item_id).await {
        send_workflow_error(sender, &envelope.id, "RETRY_FAILED", &format!("Failed to retry item: {e}"));
    }
}

async fn handle_permission_respond(envelope: WsEnvelope, sender: &WsSender) {
    let Some((payload, engine)) = parse_and_get_engine::<WorkflowPermissionRespondPayload>(&envelope, sender) else { return };

    let response = super::session_prompt::PermissionResponse {
        decision: payload.decision,
        feedback: payload.feedback,
        updated_input: payload.updated_input,
    };

    match engine.respond_permission(payload.queue_item_id, response).await {
        Ok(()) => {
            let ack = WsEnvelope::reply(&envelope.id, "workflow", "acknowledged", to_value(WorkflowAcknowledgedPayload {
                feature_id: payload.feature_id,
                action: "permission.respond".into(),
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
    let Some((payload, engine)) = parse_and_get_engine::<WorkflowPromptSendPayload>(&envelope, sender) else { return };

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
            let ack = WsEnvelope::reply(&envelope.id, "workflow", "acknowledged", to_value(WorkflowAcknowledgedPayload {
                feature_id: payload.feature_id,
                action: "prompt.send".into(),
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
    let Some(payload) = parse_payload::<WorkflowInterruptPayload>(&envelope, sender) else { return };

    let item_id = payload.queue_item_id;
    let interrupted_payload = || to_value(WorkflowInterruptedPayload {
        feature_id: payload.feature_id,
        queue_item_id: item_id,
        status: "interrupted".into(),
    });

    if let Some(engine) = get_engine(payload.feature_id) {
        match engine.interrupt_item(item_id).await {
            Ok(()) => {
                let ack = WsEnvelope::reply(&envelope.id, "workflow", "interrupted", interrupted_payload());
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
                warn!(item_id, pid, "no-engine PID fallback interrupt (PID reuse risk — see engine.rs docs)");
                // SAFETY: libc::kill sends a signal to the given PID. We check the return
                // value and handle ESRCH. PID reuse risk is inherent but low (see engine.rs).
                let result = unsafe { libc::kill(pid as libc::pid_t, libc::SIGINT) };
                if result == 0 {
                    info!(item_id, pid, "sent SIGINT via PID fallback (no engine)");
                    let ack = WsEnvelope::reply(&envelope.id, "workflow", "interrupted", interrupted_payload());
                    let _ = sender.send(Message::Text(String::from(ack).into()));
                } else {
                    let err = std::io::Error::last_os_error();
                    if err.raw_os_error() == Some(libc::ESRCH) {
                        let _ = repo::mark_item_error(&app_state.write_pool, item_id, Some("Agent process no longer running")).await;
                        let err_env = WsEnvelope::new("workflow", "item_error", to_value(WorkflowItemErrorPayload {
                            feature_id: payload.feature_id,
                            queue_item_id: item_id,
                            error: "Agent process no longer running".into(),
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
    let Some((payload, engine)) = parse_and_get_engine::<WorkflowSetAutonomyPayload>(&envelope, sender) else { return };

    engine.autonomy_level.store(payload.level, std::sync::atomic::Ordering::Relaxed);
    info!(
        feature_id = payload.feature_id,
        level = payload.level,
        "autonomy level updated"
    );

    let ack = WsEnvelope::reply(&envelope.id, "workflow", "autonomy.updated", to_value(WorkflowAutonomyUpdatedPayload {
        feature_id: payload.feature_id,
        level: payload.level,
    }));
    let _ = sender.send(Message::Text(String::from(ack).into()));
}

async fn handle_start_session(envelope: WsEnvelope, sender: &WsSender) {
    let Some((payload, engine)) = parse_and_get_engine::<WorkflowStartSessionPayload>(&envelope, sender) else { return };

    info!(feature_id = payload.feature_id, "spawning session agent");
    match engine.spawn_session_agent(&payload.prompt).await {
        Ok(session_id) => {
            let ack = WsEnvelope::reply(&envelope.id, "workflow", "session.started", to_value(WorkflowFeatureIdSessionPayload {
                feature_id: payload.feature_id,
                session_id,
            }));
            let _ = sender.send(Message::Text(String::from(ack).into()));
        }
        Err(e) => {
            send_workflow_error(sender, &envelope.id, "SPAWN_FAILED", &format!("Failed to spawn session agent: {e}"));
        }
    }
}

async fn handle_start_refine(envelope: WsEnvelope, sender: &WsSender) {
    let Some((payload, engine)) = parse_and_get_engine::<WorkflowStartRefinePayload>(&envelope, sender) else { return };

    info!(feature_id = payload.feature_id, "spawning refine plan agent");
    match engine.spawn_refine_agent(&payload.description).await {
        Ok(session_id) => {
            let ack = WsEnvelope::reply(&envelope.id, "workflow", "refine.started", to_value(WorkflowFeatureIdSessionPayload {
                feature_id: payload.feature_id,
                session_id,
            }));
            let _ = sender.send(Message::Text(String::from(ack).into()));
        }
        Err(e) => {
            send_workflow_error(sender, &envelope.id, "SPAWN_FAILED", &format!("Failed to spawn refine agent: {e}"));
        }
    }
}

async fn handle_start_review_fixer(envelope: WsEnvelope, sender: &WsSender) {
    let Some((payload, engine)) = parse_and_get_engine::<WorkflowStartReviewFixerPayload>(&envelope, sender) else { return };

    info!(feature_id = payload.feature_id, "spawning review fixer agent");
    match engine.spawn_review_fixer_agent(&payload.comments).await {
        Ok(session_id) => {
            let ack = WsEnvelope::reply(&envelope.id, "workflow", "review_fixer.started", to_value(WorkflowFeatureIdSessionPayload {
                feature_id: payload.feature_id,
                session_id,
            }));
            let _ = sender.send(Message::Text(String::from(ack).into()));
        }
        Err(e) => {
            send_workflow_error(sender, &envelope.id, "SPAWN_FAILED", &format!("Failed to spawn review fixer: {e}"));
        }
    }
}

async fn handle_mark_done(envelope: WsEnvelope, sender: &WsSender) {
    let Some((payload, engine)) = parse_and_get_engine::<WorkflowMarkDonePayload>(&envelope, sender) else { return };

    info!(feature_id = payload.feature_id, queue_item_id = payload.queue_item_id, "marking agent done");
    match engine.mark_done(payload.queue_item_id).await {
        Ok(()) => {
            let ack = WsEnvelope::reply(&envelope.id, "workflow", "acknowledged", to_value(WorkflowAcknowledgedPayload {
                feature_id: payload.feature_id,
                action: "mark_done".into(),
            }));
            let _ = sender.send(Message::Text(String::from(ack).into()));
        }
        Err(e) => {
            send_workflow_error(sender, &envelope.id, "MARK_DONE_FAILED", &format!("Failed to mark done: {e}"));
        }
    }
}

/// Shared worktree preparation for plan/PRD handlers:
/// 1. Auto-name feature if it has a default title
/// 2. Ensure worktree exists (blocking)
/// 3. Spawn setup commands (non-blocking)
async fn prepare_worktree(
    feature_id: i64,
    description: &str,
    sender: &WsSender,
    app_state: &AppState,
) -> Result<(), String> {
    let project_id = worktree::get_project_id_for_feature(&app_state.read_pool, feature_id).await?;
    let project_dir = worktree::get_project_directory(&app_state.read_pool, project_id).await?;

    // Auto-name if feature still has default title
    if auto_name::has_default_title(&app_state.read_pool, feature_id).await {
        info!(feature_id, "auto-naming feature before worktree creation");
        let _ = auto_name::auto_name_feature(
            app_state.write_pool.clone(),
            feature_id,
            description.to_string(),
            project_dir.clone(),
            None,
            sender.clone(),
        ).await;
    }

    // Create worktree (blocking, idempotent)
    let worktree_path = worktree::ensure_worktree(
        &app_state.read_pool,
        &app_state.write_pool,
        feature_id,
        project_id,
        sender,
    ).await?;

    // Spawn setup commands (non-blocking)
    let read_pool = app_state.read_pool.clone();
    let write_pool = app_state.write_pool.clone();
    let ws = sender.clone();
    tokio::spawn(async move {
        worktree::run_setup_commands(read_pool, write_pool, feature_id, worktree_path, ws).await;
    });

    Ok(())
}

use std::sync::atomic::Ordering;
use std::sync::{Arc, LazyLock, Once};

use axum::extract::ws::Message;
use dashmap::DashMap;
use serde::de::DeserializeOwned;
use tracing::{debug, info, warn};

use crate::app_state::AppState;
use crate::domain::features::models::WorkflowType;
use crate::domain::workflow::engine::WorkflowEngine;
use crate::domain::workflow::status::WorkflowStatus;
use crate::domain::workflow::worktree;
use crate::domain::ws_session::auto_name;
use crate::domain::ws_session::persistence::WsSessionPersistence;
use crate::domain::ws_session::protocol::*;
use super::{SdkSessions, WsSender};

/// Global engine registry: one engine per feature_id at a time.
static ENGINES: LazyLock<DashMap<i64, Arc<WorkflowEngine>>> = LazyLock::new(DashMap::new);
static BACKGROUND_INIT: Once = Once::new();

/// Spawn global background tasks (runs once): engine eviction + timeout checker.
fn ensure_background_tasks(timeout_minutes: u64) {
    BACKGROUND_INIT.call_once(move || {
        // Eviction task: remove idle engines every 5 min
        tokio::spawn(async {
            let interval = std::time::Duration::from_secs(5 * 60);
            let idle_threshold_secs: u64 = 30 * 60;
            loop {
                tokio::time::sleep(interval).await;
                let now = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_secs();

                let detached_idle_threshold_secs: u64 = 5 * 60;
                let mut to_evict = Vec::new();
                for entry in ENGINES.iter() {
                    let engine = entry.value();
                    if engine.active_items().is_empty() {
                        let last = engine.last_activity.load(Ordering::Relaxed);
                        let age = now.saturating_sub(last);
                        // Detached engines (no WS client) get a shorter idle timeout
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
                        info!(feature_id, "evicted idle workflow engine from ENGINES registry");
                    }
                }
            }
        });

        // Global timeout checker: scan all engines every 60s for stale running items
        tokio::spawn(async move {
            let interval = std::time::Duration::from_secs(60);
            loop {
                tokio::time::sleep(interval).await;

                for entry in ENGINES.iter() {
                    let engine = entry.value();
                    let feature_id = engine.feature_id;

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
                            continue;
                        }
                    };

                    for (item_id,) in stale {
                        // Skip items that are still actively tracked — the agent
                        // process is alive and the stream reader is monitoring it.
                        // Only timeout truly orphaned items (status=running in DB
                        // but no active stream reader).
                        let slot = crate::domain::workflow::engine::AgentSlot::QueueItem(item_id);
                        if engine.active_items().contains_key(&slot) {
                            debug!(feature_id, item_id, "timeout checker: skipping active item");
                            continue;
                        }
                        warn!(feature_id, item_id, "agent timed out (orphaned)");

                        if let Err(e) = crate::domain::features::repository::mark_item_error(&engine.write_pool, item_id, Some("Agent timed out")).await {
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
                            }).unwrap_or_default(),
                        );
                        let _ = engine.ws_sender.send(Message::Text(String::from(envelope).into()));
                    }
                }
            }
        });
    });
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
/// Called from main.rs shutdown_signal — not detected by lib dead_code lint.
#[allow(dead_code)]
pub async fn pause_all_engines() {
    let feature_ids = tracked_feature_ids();
    for feature_id in feature_ids {
        if let Some(engine) = ENGINES.get(&feature_id) {
            info!(feature_id, "shutdown: pausing all agents");
            engine.pause_all().await;
        }
    }
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
        "permission.respond" => handle_permission_respond(envelope, sender, app_state).await,
        "prompt.send" => handle_prompt_send(envelope, sender, app_state).await,
        "interrupt" => handle_interrupt(envelope, sender, app_state).await,
        "set_autonomy" => handle_set_autonomy(envelope, sender).await,
        "set_parallel" => handle_set_parallel(envelope, sender, app_state).await,
        "start_session" => handle_start_session(envelope, sender).await,
        "start_refine" => handle_start_refine(envelope, sender).await,
        "start_review_fixer" => handle_start_review_fixer(envelope, sender).await,
        "start_risk" => handle_start_risk(envelope, sender).await,
        "start_retro" => handle_start_retro(envelope, sender).await,
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

    // ws-session features don't use the workflow engine for agent restoration
    let is_workflow_feature = feature_type == "ws-feature";

    let workflow_type_str = payload.workflow_type.unwrap_or_else(|| "feature_build".to_string());
    let workflow_type = WorkflowType::from_str(&workflow_type_str).unwrap_or(WorkflowType::FeatureBuild);

    // Check if an engine already exists for this feature
    if let Some(existing) = ENGINES.get(&feature_id) {
        let has_active = !existing.active_items().is_empty();
        // Reattach the new WS sender to the existing engine
        info!(feature_id, has_active, "reattaching sender to existing engine on reconnect");
        existing.reattach_sender(sender.clone());

        if has_active {
            // Replay current state to the reconnecting client
            info!(feature_id, "replaying active agent state to reconnected client");
            if let Err(e) = existing.replay_state_to_client().await {
                warn!(feature_id, error = %e, "failed to replay state on reconnect");
            }
        }

        drop(existing);
        ensure_background_tasks(app_state.agent_timeout_minutes);
    } else {
        // No existing engine — create fresh and restore from DB
        let engine = Arc::new(WorkflowEngine::new(
            feature_id,
            workflow_type.clone(),
            app_state.read_pool.clone(),
            app_state.write_pool.clone(),
            sender.clone(),
            app_state.max_parallel_agents,
            app_state.turn_state_tx.clone(),
        )
        .await);

        if is_workflow_feature {
            if let Err(e) = engine.restore_on_reconnect().await {
                warn!(feature_id, error = %e, "failed to restore on reconnect");
            }
        }

        ENGINES.insert(feature_id, engine);
        ensure_background_tasks(app_state.agent_timeout_minutes);
    }

    // Read autonomy level from DB (feature → project → global cascade) and apply to engine
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

async fn handle_start_plan(envelope: WsEnvelope, sender: &WsSender, app_state: &AppState) {
    let Some((payload, engine)) = parse_and_get_engine::<WorkflowStartPlanPayload>(&envelope, sender) else { return };
    let feature_id = payload.feature_id;

    // Immediately transition so the frontend leaves plan-input view
    engine.set_status(WorkflowStatus::Planning).await;

    // Auto-name if needed, ensure worktree exists
    if let Err(e) = prepare_worktree(feature_id, &payload.description, &engine.ws_sender, app_state).await {
        engine.set_status(WorkflowStatus::Idle).await;
        send_workflow_error(sender, &envelope.id, "WORKTREE_FAILED", &e);
        return;
    }

    info!(feature_id, "spawning plan agent");
    match engine.spawn_plan_agent(&payload.description, &payload.images.unwrap_or_default()).await {
        Ok(session_id) => {
            let ack = WsEnvelope::reply(&envelope.id, "workflow", "plan.started", to_value(WorkflowFeatureIdSessionPayload {
                feature_id,
                session_id,
            }));
            let _ = sender.send(Message::Text(String::from(ack).into()));
        }
        Err(e) => {
            engine.set_status(WorkflowStatus::Idle).await;
            send_workflow_error(sender, &envelope.id, "SPAWN_FAILED", &format!("Failed to spawn plan agent: {e}"));
        }
    }
}

async fn handle_start_prd(envelope: WsEnvelope, sender: &WsSender, app_state: &AppState) {
    let Some((payload, engine)) = parse_and_get_engine::<WorkflowStartPrdPayload>(&envelope, sender) else { return };
    let feature_id = payload.feature_id;

    // Immediately transition so the frontend leaves plan-input view
    engine.set_status(WorkflowStatus::Prd).await;

    // Auto-name if needed, ensure worktree exists
    if let Err(e) = prepare_worktree(feature_id, &payload.description, &engine.ws_sender, app_state).await {
        engine.set_status(WorkflowStatus::Idle).await;
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
            engine.set_status(WorkflowStatus::Idle).await;
            send_workflow_error(sender, &envelope.id, "SPAWN_FAILED", &format!("Failed to spawn PRD agent: {e}"));
        }
    }
}

async fn handle_plan_approval(envelope: WsEnvelope, sender: &WsSender) {
    use crate::domain::workflow::engine::AgentSlot;
    handle_approval(envelope, sender, "plan", AgentSlot::Plan).await;
}

async fn handle_prd_approval(envelope: WsEnvelope, sender: &WsSender) {
    use crate::domain::workflow::engine::AgentSlot;
    handle_approval(envelope, sender, "prd", AgentSlot::Prd).await;
}

/// Route plan/PRD approval through the permission channel.
///
/// The approval gate is implemented via `canUseTool` in WorkflowPermissionBridge:
/// when `show_plan`/`show_prd` tool calls are detected, the bridge emits a
/// `plan_ready`/`prd_ready` WS event and blocks on the permission channel.
/// This handler resolves that block by sending through the same channel.
async fn handle_approval(envelope: WsEnvelope, sender: &WsSender, kind: &str, slot: crate::domain::workflow::engine::AgentSlot) {
    let Some((payload, engine)) = parse_and_get_engine::<WorkflowApprovalPayload>(&envelope, sender) else { return };

    let approved = payload.approved;
    info!(feature_id = payload.feature_id, approved, kind, "resolving approval via permission channel");

    // Map approval decision to permission response
    let decision = if approved {
        PermissionDecision::AllowOnce
    } else {
        PermissionDecision::Deny
    };

    let response = super::session_prompt::PermissionResponse {
        decision,
        feedback: payload.feedback.clone(),
        updated_input: None,
    };

    // Update workflow status based on approval decision
    {
        if kind == "plan" {
            if approved {
                engine.set_status(WorkflowStatus::ReadyToBuild).await;
            } else {
                engine.set_status(WorkflowStatus::Planning).await;
            }
        } else if kind == "prd" {
            if approved {
                engine.set_status(WorkflowStatus::Planning).await;
            } else {
                engine.set_status(WorkflowStatus::Prd).await;
            }
        }
    }

    // Persist user message for the approval/rejection so it shows in the conversation history
    if let Some(db_session_id) = engine.active_items().get(&slot).map(|r| *r) {
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

    // Send through the permission channel for the agent slot
    // which the WorkflowPermissionBridge is blocking on.
    match engine.respond_permission(slot, response).await {
        Ok(()) => {
            info!(feature_id = payload.feature_id, kind, "approval routed through permission channel");
        }
        Err(e) => {
            warn!(feature_id = payload.feature_id, error = %e, kind, "failed to route approval — agent may not be waiting");
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

    // Always send queue state to the frontend before advancing, so that
    // item_started messages find matching queue items in the store.
    if let Ok(items) = crate::domain::features::repository::get_queue_for_feature(&app_state.read_pool, payload.feature_id).await {
        let queue_env = WsEnvelope::new(
            "workflow",
            "queue_update",
            to_value(WorkflowQueueUpdatePayload {
                feature_id: payload.feature_id,
                items,
                workflow_status: None,
            }),
        );
        let _ = sender.send(Message::Text(String::from(queue_env).into()));
    }

    // Ensure worktree exists (idempotent)
    match worktree::get_project_id_for_feature(&app_state.read_pool, payload.feature_id).await {
        Ok(project_id) => {
            if let Err(e) = worktree::ensure_worktree(
                &app_state.read_pool,
                &app_state.write_pool,
                payload.feature_id,
                project_id,
                &engine.ws_sender,
            ).await {
                warn!(feature_id = payload.feature_id, error = %e, "ensure_worktree failed in start_build (continuing anyway)");
            }
        }
        Err(e) => {
            warn!(feature_id = payload.feature_id, error = %e, "could not look up project_id for worktree (continuing anyway)");
        }
    }

    // Set status to Building before advancing
    engine.set_status(crate::domain::workflow::status::WorkflowStatus::Building).await;

    // Set the feature status to in-progress
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

async fn handle_continue(envelope: WsEnvelope, sender: &WsSender) {
    let Some((payload, engine)) = parse_and_get_engine::<WorkflowContinuePayload>(&envelope, sender) else { return };

    engine.set_status(crate::domain::workflow::status::WorkflowStatus::Building).await;

    // Set the feature status to in-progress
    if sqlx::query("UPDATE features SET status = 'in-progress' WHERE id = ? AND status NOT IN ('in-progress', 'done', 'archived')")
        .bind(payload.feature_id)
        .execute(&engine.write_pool)
        .await
        .map(|r| r.rows_affected() > 0)
        .unwrap_or(false)
    {
        crate::domain::workflow::engine::send_feature_updated_envelope(&engine.ws_sender, payload.feature_id, &["status"]);
    }

    // Send current queue state before advancing so the frontend has up-to-date
    // items (new items may have been added since the last queue_update).
    if let Ok(items) = crate::domain::features::repository::get_queue_for_feature(&engine.read_pool, payload.feature_id).await {
        let queue_env = WsEnvelope::new(
            "workflow",
            "queue_update",
            to_value(WorkflowQueueUpdatePayload {
                feature_id: payload.feature_id,
                items,
                workflow_status: None,
            }),
        );
        let _ = sender.send(Message::Text(String::from(queue_env).into()));
    }

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

async fn handle_permission_respond(envelope: WsEnvelope, sender: &WsSender, app_state: &AppState) {
    let Some((payload, engine)) = parse_and_get_engine::<WorkflowPermissionRespondPayload>(&envelope, sender) else { return };

    // Persist user answer for AskUserQuestion and notify the frontend so it
    // appears in the conversation (mirrors the ws-session behaviour).
    if let Some(ref updated_input) = payload.updated_input {
        if let Some(answers) = updated_input.get("answers") {
            if let Some(answer_text) = answers.get("0").and_then(|v| v.as_str()) {
                if let Some(db_session_id_ref) = engine.active_items().get(&payload.agent_slot) {
                    let db_session_id = *db_session_id_ref;
                    let p = WsSessionPersistence::with_session_id(
                        app_state.write_pool.clone(),
                        payload.feature_id,
                        Some(db_session_id),
                    );
                    p.persist_user_message(answer_text).await;

                    let formatted = format_qa_answer(answer_text);

                    // Send agent_user_message so the frontend adds the answer to the conversation.
                    let user_msg = WsEnvelope::new(
                        "workflow",
                        "agent_user_message",
                        serde_json::json!({
                            "agent_slot": payload.agent_slot,
                            "session_id": db_session_id,
                            "content": formatted,
                        }),
                    );
                    let _ = sender.send(Message::Text(String::from(user_msg).into()));
                }
            }
        }
    }

    let response = super::session_prompt::PermissionResponse {
        decision: payload.decision,
        feedback: payload.feedback,
        updated_input: payload.updated_input,
    };

    match engine.respond_permission(payload.agent_slot.clone(), response).await {
        Ok(()) => {
            let ack = WsEnvelope::reply(&envelope.id, "workflow", "acknowledged", to_value(WorkflowAcknowledgedPayload {
                feature_id: payload.feature_id,
                action: "permission.respond".into(),
            }));
            let _ = sender.send(Message::Text(String::from(ack).into()));
        }
        Err(e) => {
            warn!(feature_id = payload.feature_id, agent_slot = %payload.agent_slot, error = %e, "permission.respond failed — agent may be orphaned");
            send_workflow_error(sender, &envelope.id, "AGENT_ORPHANED", &e);
        }
    }
}

async fn handle_prompt_send(envelope: WsEnvelope, sender: &WsSender, app_state: &AppState) {
    let Some((payload, engine)) = parse_and_get_engine::<WorkflowPromptSendPayload>(&envelope, sender) else { return };

    // Persist user message if we can find the db_session_id
    let images = payload.images.unwrap_or_default();
    if let Some(db_session_id_ref) = engine.active_items().get(&payload.agent_slot) {
        let db_session_id = *db_session_id_ref;
        let p = WsSessionPersistence::with_session_id(
            app_state.write_pool.clone(),
            payload.feature_id,
            Some(db_session_id),
        );
        let persist_content = super::session_prompt::build_persist_content(&payload.text, &images);
        p.persist_user_message(&persist_content).await;
    }

    match engine.send_prompt(payload.agent_slot.clone(), &payload.text, Some(images)).await {
        Ok(()) => {
            let ack = WsEnvelope::reply(&envelope.id, "workflow", "acknowledged", to_value(WorkflowAcknowledgedPayload {
                feature_id: payload.feature_id,
                action: "prompt.send".into(),
            }));
            let _ = sender.send(Message::Text(String::from(ack).into()));
        }
        Err(e) => {
            warn!(feature_id = payload.feature_id, agent_slot = %payload.agent_slot, error = %e, "prompt.send failed — agent may be orphaned");
            send_workflow_error(sender, &envelope.id, "AGENT_ORPHANED", &e);
        }
    }
}

async fn handle_interrupt(envelope: WsEnvelope, sender: &WsSender, app_state: &AppState) {
    let Some(payload) = parse_payload::<WorkflowInterruptPayload>(&envelope, sender) else { return };

    let slot = payload.agent_slot.clone();
    let interrupted_payload = || to_value(WorkflowInterruptedPayload {
        feature_id: payload.feature_id,
        agent_slot: slot.clone(),
        status: "interrupted".into(),
    });

    if let Some(engine) = get_engine(payload.feature_id) {
        match engine.interrupt_item(slot.clone()).await {
            Ok(()) => {
                let ack = WsEnvelope::reply(&envelope.id, "workflow", "interrupted", interrupted_payload());
                let _ = sender.send(Message::Text(String::from(ack).into()));
            }
            Err(e) => {
                send_workflow_error(sender, &envelope.id, "INTERRUPT_FAILED", &format!("Failed to interrupt slot {slot}: {e}"));
            }
        }
    } else {
        // No engine (post-reconnect before engine re-created) — fall back to direct PID lookup
        // Only possible for real queue items
        use crate::domain::workflow::engine::AgentSlot;
        if let AgentSlot::QueueItem(item_id) = &slot {
            info!(feature_id = payload.feature_id, item_id, "no engine, attempting PID-based interrupt");
            use crate::domain::features::repository as repo;

            match repo::get_queue_item(&app_state.read_pool, *item_id).await {
                Ok(Some(item)) if item.pid.is_some() => {
                    let pid = item.pid.unwrap();
                    warn!(item_id, pid, "no-engine PID fallback interrupt (PID reuse risk — see engine.rs docs)");
                    let result = unsafe { libc::kill(pid as libc::pid_t, libc::SIGINT) };
                    if result == 0 {
                        info!(item_id, pid, "sent SIGINT via PID fallback (no engine)");
                        let ack = WsEnvelope::reply(&envelope.id, "workflow", "interrupted", interrupted_payload());
                        let _ = sender.send(Message::Text(String::from(ack).into()));
                    } else {
                        let err = std::io::Error::last_os_error();
                        if err.raw_os_error() == Some(libc::ESRCH) {
                            let _ = repo::mark_item_error(&app_state.write_pool, *item_id, Some("Agent process no longer running")).await;
                            let err_env = WsEnvelope::new("workflow", "item_error", to_value(WorkflowItemErrorPayload {
                                feature_id: payload.feature_id,
                                agent_slot: slot.clone(),
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
        } else {
            send_workflow_error(sender, &envelope.id, "NO_ENGINE", &format!("No workflow engine for feature {} and no PID fallback for non-queue slot", payload.feature_id));
        }
    }
}

async fn handle_set_autonomy(envelope: WsEnvelope, sender: &WsSender) {
    let Some((payload, engine)) = parse_and_get_engine::<WorkflowSetAutonomyPayload>(&envelope, sender) else { return };

    engine.autonomy_level().store(payload.level, std::sync::atomic::Ordering::Relaxed);
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

async fn handle_set_parallel(envelope: WsEnvelope, sender: &WsSender, app_state: &AppState) {
    let Some((payload, engine)) = parse_and_get_engine::<WorkflowSetParallelPayload>(&envelope, sender) else { return };

    let max = if payload.enabled { app_state.max_parallel_agents } else { 1 };
    engine.set_max_parallel(max);
    info!(
        feature_id = payload.feature_id,
        enabled = payload.enabled,
        max_parallel = max,
        "parallel execution updated"
    );

    // If enabling parallelism, trigger advance to pick up waiting items immediately
    if payload.enabled {
        let _ = engine.advance().await;
    }

    let ack = WsEnvelope::reply(&envelope.id, "workflow", "parallel.updated", to_value(serde_json::json!({
        "feature_id": payload.feature_id,
        "enabled": payload.enabled,
        "max_parallel": max,
    })));
    let _ = sender.send(Message::Text(String::from(ack).into()));
}

async fn handle_start_session(envelope: WsEnvelope, sender: &WsSender) {
    let Some((payload, engine)) = parse_and_get_engine::<WorkflowStartSessionPayload>(&envelope, sender) else { return };

    info!(feature_id = payload.feature_id, "spawning session agent");
    match engine.spawn_session_agent(&payload.prompt, &payload.images.unwrap_or_default()).await {
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
    match engine.spawn_refine_agent(&payload.description, &payload.images.unwrap_or_default()).await {
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

async fn handle_start_risk(envelope: WsEnvelope, sender: &WsSender) {
    let Some((payload, engine)) = parse_and_get_engine::<WorkflowStartRiskPayload>(&envelope, sender) else { return };

    info!(feature_id = payload.feature_id, "spawning risk agent");
    match engine.spawn_risk_agent().await {
        Ok(session_id) => {
            let ack = WsEnvelope::reply(&envelope.id, "workflow", "risk.started", to_value(WorkflowFeatureIdSessionPayload {
                feature_id: payload.feature_id,
                session_id,
            }));
            let _ = sender.send(Message::Text(String::from(ack).into()));
        }
        Err(e) => {
            send_workflow_error(sender, &envelope.id, "SPAWN_FAILED", &format!("Failed to spawn risk agent: {e}"));
        }
    }
}

async fn handle_start_retro(envelope: WsEnvelope, sender: &WsSender) {
    let Some((payload, engine)) = parse_and_get_engine::<WorkflowStartRetroPayload>(&envelope, sender) else { return };

    info!(feature_id = payload.feature_id, "spawning retro agent");
    match engine.spawn_retro_agent().await {
        Ok(session_id) => {
            let ack = WsEnvelope::reply(&envelope.id, "workflow", "retro.started", to_value(WorkflowFeatureIdSessionPayload {
                feature_id: payload.feature_id,
                session_id,
            }));
            let _ = sender.send(Message::Text(String::from(ack).into()));
        }
        Err(e) => {
            send_workflow_error(sender, &envelope.id, "SPAWN_FAILED", &format!("Failed to spawn retro agent: {e}"));
        }
    }
}

async fn handle_mark_done(envelope: WsEnvelope, sender: &WsSender) {
    let Some((payload, engine)) = parse_and_get_engine::<WorkflowMarkDonePayload>(&envelope, sender) else { return };

    info!(feature_id = payload.feature_id, agent_slot = %payload.agent_slot, "marking agent done");
    match engine.mark_done(payload.agent_slot).await {
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
    engine_sender: &crate::domain::workflow::engine::WsSender,
    app_state: &AppState,
) -> Result<(), String> {
    let project_id = worktree::get_project_id_for_feature(&app_state.read_pool, feature_id).await?;
    let project_dir = worktree::get_project_directory(&app_state.read_pool, project_id).await?;

    // Auto-name if feature still has default title
    if auto_name::has_default_title(&app_state.read_pool, feature_id).await {
        info!(feature_id, "auto-naming feature before worktree creation");
        if let Some(raw) = engine_sender.raw_clone() {
            let _ = auto_name::auto_name_feature(
                app_state.write_pool.clone(),
                feature_id,
                description.to_string(),
                project_dir.clone(),
                None,
                raw,
            ).await;
        }
    }

    // Create worktree (blocking, idempotent)
    let worktree_path = worktree::ensure_worktree(
        &app_state.read_pool,
        &app_state.write_pool,
        feature_id,
        project_id,
        engine_sender,
    ).await?;

    // Spawn setup commands (non-blocking)
    let read_pool = app_state.read_pool.clone();
    let write_pool = app_state.write_pool.clone();
    let ws = engine_sender.clone();
    tokio::spawn(async move {
        worktree::run_setup_commands(read_pool, write_pool, feature_id, worktree_path, ws).await;
    });

    Ok(())
}

/// Format a raw Q&A response string into markdown with italic questions and bold answers.
fn format_qa_answer(raw: &str) -> String {
    raw.split("\n\n")
        .map(|qa| {
            let mut lines = qa.lines();
            let question = lines.next().unwrap_or("");
            let answer: String = lines
                .map(|l| l.strip_prefix("Answer: ").unwrap_or(l))
                .collect::<Vec<_>>()
                .join("\n");
            format!("*{question}*\n\n**{answer}**")
        })
        .collect::<Vec<_>>()
        .join("\n\n\n\n")
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::sync::mpsc;

    fn make_sender() -> (WsSender, mpsc::UnboundedReceiver<Message>) {
        mpsc::unbounded_channel()
    }

    fn recv_envelope(rx: &mut mpsc::UnboundedReceiver<Message>) -> WsEnvelope {
        match rx.try_recv().unwrap() {
            Message::Text(text) => serde_json::from_str::<WsEnvelope>(&text).unwrap(),
            _ => panic!("expected text message"),
        }
    }

    fn make_envelope(action: &str, payload: serde_json::Value) -> WsEnvelope {
        WsEnvelope {
            id: "test-id-123".to_string(),
            domain: "workflow".to_string(),
            action: action.to_string(),
            r#ref: None,
            payload,
        }
    }

    // --- send_workflow_error tests ---

    #[test]
    fn test_send_workflow_error_produces_correct_envelope() {
        let (tx, mut rx) = make_sender();
        send_workflow_error(&tx, "ref-42", "NO_ENGINE", "Engine not found");

        let env = recv_envelope(&mut rx);
        assert_eq!(env.domain, "workflow");
        assert_eq!(env.action, "error");
        assert_eq!(env.r#ref.as_deref(), Some("ref-42"));

        let payload: SessionErrorPayload = serde_json::from_value(env.payload).unwrap();
        assert_eq!(payload.code, "NO_ENGINE");
        assert_eq!(payload.message, "Engine not found");
    }

    // --- parse_payload tests ---

    #[test]
    fn test_parse_payload_valid() {
        let (tx, mut _rx) = make_sender();
        let envelope = make_envelope("skip_item", serde_json::json!({"feature_id": 1, "item_id": 5}));
        let result = parse_payload::<WorkflowSkipItemPayload>(&envelope, &tx);
        assert!(result.is_some());
        let p = result.unwrap();
        assert_eq!(p.feature_id, 1);
        assert_eq!(p.item_id, 5);
    }

    #[test]
    fn test_parse_payload_invalid_sends_error() {
        let (tx, mut rx) = make_sender();
        let envelope = make_envelope("skip_item", serde_json::json!({"wrong_field": true}));
        let result = parse_payload::<WorkflowSkipItemPayload>(&envelope, &tx);
        assert!(result.is_none());

        let env = recv_envelope(&mut rx);
        assert_eq!(env.action, "error");
        let payload: SessionErrorPayload = serde_json::from_value(env.payload).unwrap();
        assert_eq!(payload.code, "INVALID_PAYLOAD");
    }

    // --- parse_and_get_engine tests ---

    #[test]
    fn test_parse_and_get_engine_invalid_payload() {
        let (tx, mut rx) = make_sender();
        let envelope = make_envelope("continue", serde_json::json!({}));
        let result = parse_and_get_engine::<WorkflowContinuePayload>(&envelope, &tx);
        assert!(result.is_none());

        let env = recv_envelope(&mut rx);
        let payload: SessionErrorPayload = serde_json::from_value(env.payload).unwrap();
        assert_eq!(payload.code, "INVALID_PAYLOAD");
    }

    #[test]
    fn test_parse_and_get_engine_no_engine() {
        let (tx, mut rx) = make_sender();
        // Valid payload but no engine registered for feature 99999
        let envelope = make_envelope("continue", serde_json::json!({"feature_id": 99999}));
        let result = parse_and_get_engine::<WorkflowContinuePayload>(&envelope, &tx);
        assert!(result.is_none());

        let env = recv_envelope(&mut rx);
        let payload: SessionErrorPayload = serde_json::from_value(env.payload).unwrap();
        assert_eq!(payload.code, "NO_ENGINE");
        assert!(payload.message.contains("99999"));
    }

    // --- handle_workflow_action unknown action test ---

    #[tokio::test]
    async fn test_unknown_workflow_action_returns_error() {
        let (tx, mut rx) = make_sender();
        let sdk_sessions: SdkSessions = Arc::new(tokio::sync::Mutex::new(std::collections::HashMap::new()));
        let pool = sqlx::SqlitePool::connect("sqlite::memory:").await.unwrap();
        let app_state = AppState::with_pool(pool);

        let envelope = make_envelope("totally_bogus_action", serde_json::json!({}));
        handle_workflow_action(envelope, &tx, &sdk_sessions, &app_state).await;

        let env = recv_envelope(&mut rx);
        assert_eq!(env.action, "error");
        let payload: SessionErrorPayload = serde_json::from_value(env.payload).unwrap();
        assert_eq!(payload.code, "UNKNOWN_ACTION");
        assert!(payload.message.contains("totally_bogus_action"));
    }

    // --- Action routing sends appropriate errors for missing engines ---

    #[tokio::test]
    async fn test_continue_without_engine_returns_no_engine() {
        let (tx, mut rx) = make_sender();
        let sdk_sessions: SdkSessions = Arc::new(tokio::sync::Mutex::new(std::collections::HashMap::new()));
        let pool = sqlx::SqlitePool::connect("sqlite::memory:").await.unwrap();
        let app_state = AppState::with_pool(pool);

        let envelope = make_envelope("continue", serde_json::json!({"feature_id": 12345}));
        handle_workflow_action(envelope, &tx, &sdk_sessions, &app_state).await;

        let env = recv_envelope(&mut rx);
        assert_eq!(env.action, "error");
        let payload: SessionErrorPayload = serde_json::from_value(env.payload).unwrap();
        assert_eq!(payload.code, "NO_ENGINE");
    }

    #[tokio::test]
    async fn test_skip_item_without_engine_returns_no_engine() {
        let (tx, mut rx) = make_sender();
        let sdk_sessions: SdkSessions = Arc::new(tokio::sync::Mutex::new(std::collections::HashMap::new()));
        let pool = sqlx::SqlitePool::connect("sqlite::memory:").await.unwrap();
        let app_state = AppState::with_pool(pool);

        let envelope = make_envelope("skip_item", serde_json::json!({"feature_id": 12345, "item_id": 1}));
        handle_workflow_action(envelope, &tx, &sdk_sessions, &app_state).await;

        let env = recv_envelope(&mut rx);
        let payload: SessionErrorPayload = serde_json::from_value(env.payload).unwrap();
        assert_eq!(payload.code, "NO_ENGINE");
    }

    #[tokio::test]
    async fn test_retry_item_without_engine_returns_no_engine() {
        let (tx, mut rx) = make_sender();
        let sdk_sessions: SdkSessions = Arc::new(tokio::sync::Mutex::new(std::collections::HashMap::new()));
        let pool = sqlx::SqlitePool::connect("sqlite::memory:").await.unwrap();
        let app_state = AppState::with_pool(pool);

        let envelope = make_envelope("retry_item", serde_json::json!({"feature_id": 12345, "item_id": 1}));
        handle_workflow_action(envelope, &tx, &sdk_sessions, &app_state).await;

        let env = recv_envelope(&mut rx);
        let payload: SessionErrorPayload = serde_json::from_value(env.payload).unwrap();
        assert_eq!(payload.code, "NO_ENGINE");
    }

    #[tokio::test]
    async fn test_set_parallel_without_engine_returns_no_engine() {
        let (tx, mut rx) = make_sender();
        let sdk_sessions: SdkSessions = Arc::new(tokio::sync::Mutex::new(std::collections::HashMap::new()));
        let pool = sqlx::SqlitePool::connect("sqlite::memory:").await.unwrap();
        let app_state = AppState::with_pool(pool);

        let envelope = make_envelope("set_parallel", serde_json::json!({"feature_id": 12345, "enabled": false}));
        handle_workflow_action(envelope, &tx, &sdk_sessions, &app_state).await;

        let env = recv_envelope(&mut rx);
        let payload: SessionErrorPayload = serde_json::from_value(env.payload).unwrap();
        assert_eq!(payload.code, "NO_ENGINE");
    }

    #[tokio::test]
    async fn test_set_autonomy_without_engine_returns_no_engine() {
        let (tx, mut rx) = make_sender();
        let sdk_sessions: SdkSessions = Arc::new(tokio::sync::Mutex::new(std::collections::HashMap::new()));
        let pool = sqlx::SqlitePool::connect("sqlite::memory:").await.unwrap();
        let app_state = AppState::with_pool(pool);

        let envelope = make_envelope("set_autonomy", serde_json::json!({"feature_id": 12345, "level": 2}));
        handle_workflow_action(envelope, &tx, &sdk_sessions, &app_state).await;

        let env = recv_envelope(&mut rx);
        let payload: SessionErrorPayload = serde_json::from_value(env.payload).unwrap();
        assert_eq!(payload.code, "NO_ENGINE");
    }

    #[tokio::test]
    async fn test_permission_respond_without_engine_returns_no_engine() {
        let (tx, mut rx) = make_sender();
        let sdk_sessions: SdkSessions = Arc::new(tokio::sync::Mutex::new(std::collections::HashMap::new()));
        let pool = sqlx::SqlitePool::connect("sqlite::memory:").await.unwrap();
        let app_state = AppState::with_pool(pool);

        let envelope = make_envelope("permission.respond", serde_json::json!({
            "feature_id": 12345,
            "agent_slot": {"type": "queue_item", "id": 1},
            "request_id": "r1",
            "decision": "allow_once"
        }));
        handle_workflow_action(envelope, &tx, &sdk_sessions, &app_state).await;

        let env = recv_envelope(&mut rx);
        let payload: SessionErrorPayload = serde_json::from_value(env.payload).unwrap();
        assert_eq!(payload.code, "NO_ENGINE");
    }

    #[tokio::test]
    async fn test_prompt_send_without_engine_returns_no_engine() {
        let (tx, mut rx) = make_sender();
        let sdk_sessions: SdkSessions = Arc::new(tokio::sync::Mutex::new(std::collections::HashMap::new()));
        let pool = sqlx::SqlitePool::connect("sqlite::memory:").await.unwrap();
        let app_state = AppState::with_pool(pool);

        let envelope = make_envelope("prompt.send", serde_json::json!({
            "feature_id": 12345,
            "agent_slot": {"type": "queue_item", "id": 1},
            "text": "hello"
        }));
        handle_workflow_action(envelope, &tx, &sdk_sessions, &app_state).await;

        let env = recv_envelope(&mut rx);
        let payload: SessionErrorPayload = serde_json::from_value(env.payload).unwrap();
        assert_eq!(payload.code, "NO_ENGINE");
    }

    #[tokio::test]
    async fn test_mark_done_without_engine_returns_no_engine() {
        let (tx, mut rx) = make_sender();
        let sdk_sessions: SdkSessions = Arc::new(tokio::sync::Mutex::new(std::collections::HashMap::new()));
        let pool = sqlx::SqlitePool::connect("sqlite::memory:").await.unwrap();
        let app_state = AppState::with_pool(pool);

        let envelope = make_envelope("mark_done", serde_json::json!({"feature_id": 12345, "agent_slot": {"type": "queue_item", "id": 1}}));
        handle_workflow_action(envelope, &tx, &sdk_sessions, &app_state).await;

        let env = recv_envelope(&mut rx);
        let payload: SessionErrorPayload = serde_json::from_value(env.payload).unwrap();
        assert_eq!(payload.code, "NO_ENGINE");
    }

    // --- Invalid payload routing tests ---

    #[tokio::test]
    async fn test_continue_with_invalid_payload_returns_invalid_payload() {
        let (tx, mut rx) = make_sender();
        let sdk_sessions: SdkSessions = Arc::new(tokio::sync::Mutex::new(std::collections::HashMap::new()));
        let pool = sqlx::SqlitePool::connect("sqlite::memory:").await.unwrap();
        let app_state = AppState::with_pool(pool);

        let envelope = make_envelope("continue", serde_json::json!({"wrong": true}));
        handle_workflow_action(envelope, &tx, &sdk_sessions, &app_state).await;

        let env = recv_envelope(&mut rx);
        let payload: SessionErrorPayload = serde_json::from_value(env.payload).unwrap();
        assert_eq!(payload.code, "INVALID_PAYLOAD");
    }

    #[tokio::test]
    async fn test_skip_item_with_invalid_payload_returns_invalid_payload() {
        let (tx, mut rx) = make_sender();
        let sdk_sessions: SdkSessions = Arc::new(tokio::sync::Mutex::new(std::collections::HashMap::new()));
        let pool = sqlx::SqlitePool::connect("sqlite::memory:").await.unwrap();
        let app_state = AppState::with_pool(pool);

        let envelope = make_envelope("skip_item", serde_json::json!({}));
        handle_workflow_action(envelope, &tx, &sdk_sessions, &app_state).await;

        let env = recv_envelope(&mut rx);
        let payload: SessionErrorPayload = serde_json::from_value(env.payload).unwrap();
        assert_eq!(payload.code, "INVALID_PAYLOAD");
    }

    // --- to_value helper test ---

    #[test]
    fn test_to_value_helper() {
        let val = to_value(WorkflowAcknowledgedPayload {
            feature_id: 1,
            action: "test".into(),
        });
        assert_eq!(val["feature_id"], 1);
        assert_eq!(val["action"], "test");
    }

    // --- Engine registry tests ---

    #[test]
    fn test_get_engine_returns_none_for_unknown_feature() {
        assert!(get_engine(999888777).is_none());
    }

    #[test]
    fn test_detach_engine_sender_no_panic_for_unknown_feature() {
        // Should not panic when detaching a non-existent engine
        detach_engine_sender(999888776);
    }

    #[test]
    fn test_tracked_feature_ids_type() {
        // Just verify it returns a Vec<i64> without panicking
        let _ids: Vec<i64> = tracked_feature_ids();
    }

    // --- format_qa_answer tests ---

    #[test]
    fn test_format_qa_single_pair() {
        let raw = "What is the goal?\nAnswer: Build a widget";
        let result = format_qa_answer(raw);
        assert_eq!(result, "*What is the goal?*\n\n**Build a widget**");
    }

    #[test]
    fn test_format_qa_multiple_pairs() {
        let raw = "First question?\nAnswer: First answer\n\nSecond question?\nAnswer: Second answer";
        let result = format_qa_answer(raw);
        assert_eq!(
            result,
            "*First question?*\n\n**First answer**\n\n\n\n*Second question?*\n\n**Second answer**"
        );
    }

    #[test]
    fn test_format_qa_no_answer_prefix() {
        let raw = "Question?\nJust a plain answer";
        let result = format_qa_answer(raw);
        assert_eq!(result, "*Question?*\n\n**Just a plain answer**");
    }

    #[test]
    fn test_format_qa_multiline_answer() {
        let raw = "Question?\nAnswer: Line one\nLine two";
        let result = format_qa_answer(raw);
        assert_eq!(result, "*Question?*\n\n**Line one\nLine two**");
    }

    #[test]
    fn test_format_qa_question_only() {
        let raw = "Just a question?";
        let result = format_qa_answer(raw);
        assert_eq!(result, "*Just a question?*\n\n****");
    }
}

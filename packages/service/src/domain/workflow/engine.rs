//! Workflow engine: thin orchestrator that delegates to focused collaborators.
//!
//! - `AgentManager`: agent lifecycle (spawn, interrupt, resume, stream reading)
//! - `QueueAdvancer`: queue state management (advance, complete, error, skip, retry)
//! - `PermissionRouter`: permission channel management and approval gate bridge

use serde::{Deserialize, Serialize};

/// Discriminated union replacing synthetic negative queue_item_id constants.
/// Pre-queue agents get named variants; real queue items carry their DB id.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(tag = "type", content = "id")]
pub enum AgentSlot {
    #[serde(rename = "queue_item")]
    QueueItem(i64),
    #[serde(rename = "plan")]
    Plan,
    #[serde(rename = "prd")]
    Prd,
    #[serde(rename = "session")]
    Session,
    #[serde(rename = "refine")]
    Refine,
    #[serde(rename = "review_fixer")]
    ReviewFixer,
}

impl AgentSlot {
    /// Backward-compat: map to the legacy synthetic negative IDs.
    pub fn as_legacy_id(&self) -> i64 {
        match self {
            AgentSlot::Plan => -1,
            AgentSlot::Prd => -2,
            AgentSlot::Session => -3,
            AgentSlot::Refine => -4,
            AgentSlot::ReviewFixer => -5,
            AgentSlot::QueueItem(id) => *id,
        }
    }

    pub fn is_queue_item(&self) -> bool {
        matches!(self, AgentSlot::QueueItem(_))
    }

    pub fn agent_type_str(&self) -> Option<&'static str> {
        match self {
            AgentSlot::Plan => Some("plan"),
            AgentSlot::Prd => Some("prd"),
            AgentSlot::Session => Some("session"),
            AgentSlot::Refine => Some("refine"),
            AgentSlot::ReviewFixer => Some("review-fixer"),
            AgentSlot::QueueItem(_) => None,
        }
    }

    pub fn sdk_agent_type(&self) -> Option<AgentType> {
        match self {
            AgentSlot::Plan | AgentSlot::Refine => Some(AgentType::Plan),
            AgentSlot::Prd => Some(AgentType::Prd),
            AgentSlot::Session => Some(AgentType::Session),
            AgentSlot::ReviewFixer => Some(AgentType::Execute),
            AgentSlot::QueueItem(_) => None,
        }
    }

    pub fn system_prompt(&self) -> Option<&'static str> {
        match self {
            AgentSlot::Plan | AgentSlot::Refine => Some(Prompts::plan()),
            AgentSlot::Prd => Some(Prompts::prd()),
            AgentSlot::Session => Some(Prompts::session()),
            _ => None,
        }
    }
}

impl From<i64> for AgentSlot {
    fn from(id: i64) -> Self {
        match id {
            -1 => AgentSlot::Plan,
            -2 => AgentSlot::Prd,
            -3 => AgentSlot::Session,
            -4 => AgentSlot::Refine,
            -5 => AgentSlot::ReviewFixer,
            other => AgentSlot::QueueItem(other),
        }
    }
}

impl std::fmt::Display for AgentSlot {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            AgentSlot::Plan => write!(f, "plan"),
            AgentSlot::Prd => write!(f, "prd"),
            AgentSlot::Session => write!(f, "session"),
            AgentSlot::Refine => write!(f, "refine"),
            AgentSlot::ReviewFixer => write!(f, "review_fixer"),
            AgentSlot::QueueItem(id) => write!(f, "queue_item({})", id),
        }
    }
}

/// Synthetic queue_item_id constants — DEPRECATED, use AgentSlot variants instead.
pub const PLAN_ITEM_ID: i64 = -1;
pub const PRD_ITEM_ID: i64 = -2;
pub const SESSION_ITEM_ID: i64 = -3;
pub const REFINE_ITEM_ID: i64 = -4;

use std::sync::atomic::{AtomicU64, Ordering};

use sqlx::SqlitePool;
use tokio::sync::mpsc;
use tracing::{info, warn};

use axum::extract::ws::Message;

use crate::domain::features::models::WorkflowType;
use crate::domain::features::repository as repo;
use crate::domain::mcp::servers::AgentType;
use crate::domain::workflow::agent_manager::AgentManager;
use crate::domain::workflow::permission_router::PermissionRouter;
use crate::domain::workflow::prompts::Prompts;
use crate::domain::workflow::queue_advancer::{QueueAdvancer, StatusSetter};
use crate::domain::workflow::status::WorkflowStatus;
use crate::domain::ws_session::handler::session_prompt::PermissionResponse;
use crate::domain::ws_session::protocol::*;

pub type WsSender = mpsc::UnboundedSender<Message>;

/// Map an agent type string to an AgentSlot.
pub fn agent_type_str_to_slot(agent_type: &str) -> Option<AgentSlot> {
    match agent_type {
        "plan" => Some(AgentSlot::Plan),
        "prd" => Some(AgentSlot::Prd),
        "session" => Some(AgentSlot::Session),
        "refine" => Some(AgentSlot::Refine),
        "review-fixer" | "review_fixer" => Some(AgentSlot::ReviewFixer),
        _ => None,
    }
}

/// Helper to serialize a typed payload to serde_json::Value.
pub fn to_value<T: serde::Serialize>(v: T) -> serde_json::Value {
    serde_json::to_value(v).unwrap()
}

/// Send a `feature.updated` envelope over the given WebSocket sender.
pub fn send_feature_updated_envelope(sender: &WsSender, feature_id: i64, changed: &[&str]) {
    let payload = FeatureUpdatedPayload {
        feature_id,
        changed: changed.iter().map(|s| s.to_string()).collect(),
    };
    let envelope = WsEnvelope::new("feature", "updated", to_value(payload));
    let _ = sender.send(Message::Text(String::from(envelope).into()));
}

/// Thin orchestrator that composes AgentManager, QueueAdvancer, and PermissionRouter.
pub struct WorkflowEngine {
    pub feature_id: i64,
    pub workflow_type: WorkflowType,
    pub agent_manager: AgentManager,
    pub queue: QueueAdvancer,
    pub permissions: PermissionRouter,
    /// Unix timestamp (seconds) of last activity — updated on advance/completion/error.
    pub last_activity: AtomicU64,
    /// Cancellation signal for background tasks (e.g. timeout checker).
    cancel_tx: tokio::sync::watch::Sender<bool>,
    cancel_rx: tokio::sync::watch::Receiver<bool>,
    // DB pools kept for orchestration-level queries (status, timeout checker)
    pub read_pool: SqlitePool,
    pub write_pool: SqlitePool,
    pub ws_sender: WsSender,
}

impl WorkflowEngine {
    pub fn new(
        feature_id: i64,
        workflow_type: WorkflowType,
        read_pool: SqlitePool,
        write_pool: SqlitePool,
        ws_sender: WsSender,
        max_parallel: usize,
    ) -> Self {
        let now_secs = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        let (cancel_tx, cancel_rx) = tokio::sync::watch::channel(false);

        let agent_manager = AgentManager::new(
            feature_id,
            read_pool.clone(),
            write_pool.clone(),
            ws_sender.clone(),
        );
        let queue = QueueAdvancer::new(
            feature_id,
            workflow_type.clone(),
            max_parallel,
            read_pool.clone(),
            write_pool.clone(),
            ws_sender.clone(),
        );
        let permissions = PermissionRouter::new();

        Self {
            feature_id,
            workflow_type,
            agent_manager,
            queue,
            permissions,
            last_activity: AtomicU64::new(now_secs),
            cancel_tx,
            cancel_rx,
            read_pool,
            write_pool,
            ws_sender,
        }
    }

    // ── Backward-compatible accessors for workflow handler ──

    /// Access to active_items (for handler/eviction checks).
    pub fn active_items(&self) -> &dashmap::DashMap<AgentSlot, i64> {
        &self.agent_manager.active_items
    }

    /// Access to autonomy_level (for set_autonomy handler).
    pub fn autonomy_level(&self) -> &std::sync::atomic::AtomicU8 {
        &self.queue.autonomy_level
    }

    // ── Status management ──

    /// Transition the workflow to a new status, persisting to DB and notifying the frontend.
    pub async fn set_status(&self, new_status: WorkflowStatus) {
        let current = repo::get_workflow_status(&self.read_pool, self.feature_id)
            .await
            .unwrap_or(WorkflowStatus::Idle);

        if current == new_status {
            return;
        }

        match repo::set_workflow_status(&self.write_pool, self.feature_id, new_status).await {
            Ok(_) => {
                info!(feature_id = self.feature_id, from = %current, to = %new_status, "workflow status changed");
            }
            Err(e) => {
                warn!(feature_id = self.feature_id, from = %current, to = %new_status, error = %e, "invalid transition, force-setting");
                let _ = repo::force_workflow_status(&self.write_pool, self.feature_id, new_status).await;
            }
        }

        let envelope = WsEnvelope::new(
            "workflow",
            "status_changed",
            to_value(WorkflowStatusChangedPayload {
                feature_id: self.feature_id,
                status: new_status.to_string(),
                previous_status: current.to_string(),
            }),
        );
        let _ = self.ws_sender.send(Message::Text(String::from(envelope).into()));
    }

    // ── Agent spawning (delegates to AgentManager) ──

    pub async fn spawn_plan_agent(&self, description: &str) -> Result<i64, String> {
        self.set_status(WorkflowStatus::Planning).await;
        let prd: Option<String> = sqlx::query_scalar::<_, Option<String>>(
            "SELECT prd FROM features WHERE id = ?",
        )
        .bind(self.feature_id)
        .fetch_optional(&self.read_pool)
        .await
        .map_err(|e| format!("Failed to read feature PRD: {e}"))?
        .flatten();

        let (preamble, desc) = if let Some(ref prd_content) = prd {
            if !prd_content.is_empty() {
                (
                    "Please create a detailed implementation plan based on the following Product Requirements Document (PRD):\n\n",
                    prd_content.as_str(),
                )
            } else {
                ("Please create a detailed implementation plan for the following feature:\n\n", description)
            }
        } else {
            ("Please create a detailed implementation plan for the following feature:\n\n", description)
        };

        let plan_instructions = "Start by exploring the codebase to understand the project structure and existing patterns. \
            Then ask me clarifying questions. Finally, build the phased plan using the tools, call show_plan, and ask for my approval.";

        let enriched_prompt = format!("{preamble}{desc}\n\n{plan_instructions}");

        self.agent_manager.spawn_pre_queue_agent(
            AgentType::Plan,
            "plan",
            Prompts::plan(),
            &enriched_prompt,
            AgentSlot::Plan,
            &self.permissions,
        ).await
    }

    pub async fn spawn_prd_agent(&self, description: &str) -> Result<i64, String> {
        self.set_status(WorkflowStatus::Prd).await;
        let prd_instructions = "Use the MCP tools to build the PRD. Call create_prd to store the initial PRD content, \
            then call show_prd to present it for approval. If rejected, use edit_prd for targeted changes \
            (or create_prd for full rewrites), then call show_prd again. Once approved, call mark_agent_done.";

        let enriched_prompt = format!(
            "Please create a comprehensive PRD for the following feature:\n\n{description}\n\n{prd_instructions}"
        );

        self.agent_manager.spawn_pre_queue_agent(
            AgentType::Prd,
            "prd",
            Prompts::prd(),
            &enriched_prompt,
            AgentSlot::Prd,
            &self.permissions,
        ).await
    }

    pub async fn spawn_session_agent(&self, prompt: &str) -> Result<i64, String> {
        self.agent_manager.spawn_pre_queue_agent(
            AgentType::Session,
            "session",
            Prompts::session(),
            prompt,
            AgentSlot::Session,
            &self.permissions,
        ).await
    }

    pub async fn spawn_refine_agent(&self, description: &str) -> Result<i64, String> {
        let refinement_prompt = match self.build_refine_context(description).await {
            Ok(prompt) => prompt,
            Err(e) => {
                warn!(feature_id = self.feature_id, error = %e, "failed to build refine context, using simple prompt");
                format!(
                    "The user wants to refine the existing plan.\n\n\
                     User's refinement request:\n{description}\n\n\
                     Please update the plan accordingly — add, modify, or remove phases as needed."
                )
            }
        };

        self.agent_manager.spawn_pre_queue_agent(
            AgentType::Plan,
            "plan",
            Prompts::plan(),
            &refinement_prompt,
            AgentSlot::Refine,
            &self.permissions,
        ).await
    }

    pub async fn spawn_review_fixer_agent(&self, comments: &str) -> Result<i64, String> {
        let system_prompt = "You are a code review fixer. The user has reviewed a diff and provided comments. \
            Fix the issues described in the comments. Make minimal, focused changes.";

        self.agent_manager.spawn_pre_queue_agent(
            AgentType::Execute,
            "review-fixer",
            system_prompt,
            comments,
            AgentSlot::ReviewFixer,
            &self.permissions,
        ).await
    }

    /// Build a rich refinement context matching the legacy `buildRefineContext()`.
    async fn build_refine_context(&self, description: &str) -> Result<String, String> {
        let plan: Option<(i64, Option<String>, Option<String>)> = sqlx::query_as(
            "SELECT id, summary, context FROM plans WHERE feature_id = ? ORDER BY id DESC LIMIT 1",
        )
        .bind(self.feature_id)
        .fetch_optional(&self.read_pool)
        .await
        .map_err(|e| format!("Failed to fetch plan: {e}"))?;

        let (plan_id, summary, context) = plan.ok_or("No plan found for this feature — cannot refine without an existing plan.")?;

        let phases: Vec<(i64, String, String, Option<String>, Option<String>)> = sqlx::query_as(
            "SELECT step_number, title, status, implementation_notes, phase_type FROM phases \
             WHERE plan_id = ? ORDER BY step_number, order_index",
        )
        .bind(plan_id)
        .fetch_all(&self.read_pool)
        .await
        .map_err(|e| format!("Failed to fetch phases: {e}"))?;

        let max_step = phases.iter().map(|(s, _, _, _, _)| *s).max().unwrap_or(0);

        let mut parts: Vec<String> = Vec::new();
        if let Some(ref s) = summary {
            if !s.is_empty() {
                parts.push(format!("**Plan Summary:** {s}"));
            }
        }
        if let Some(ref c) = context {
            if !c.is_empty() {
                parts.push(format!("**Codebase Context:** {c}"));
            }
        }

        if !phases.is_empty() {
            parts.push("\n## Existing Phases:".to_string());
            for (step, title, status, notes, phase_type) in &phases {
                let mut line = format!("Step {step}. [{}] {title}", status.to_uppercase());
                if let Some(pt) = phase_type {
                    line.push_str(&format!(" ({pt})"));
                }
                if let Some(n) = notes {
                    if !n.is_empty() {
                        line.push_str(&format!("\n   Notes: {n}"));
                    }
                }
                parts.push(line);
            }
        }

        let refine_instructions = format!(
            "\n## Refinement Instructions\n\
             This is a REFINEMENT of an existing plan (Plan ID: {plan_id}). The phases listed above already exist.\n\
             - Do NOT recreate or duplicate completed phases.\n\
             - Add NEW phases to extend the plan based on the user's request below.\n\
             - Use step numbers starting from {}.\n\
             - You may also update or remove existing DRAFT or PENDING phases if needed.\n\
             - After building the new phases, call show_plan for approval, then finalize_plan.",
            max_step + 1,
        );

        Ok(format!(
            "{}\n{refine_instructions}\n\n## User's Refinement Request\n{description}",
            parts.join("\n"),
        ))
    }

    // ── Queue operations (delegates to QueueAdvancer) ──

    /// Update the last_activity timestamp to now.
    fn touch_activity(&self) {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        self.last_activity.store(now, Ordering::Relaxed);
    }

    pub async fn advance(&self) -> Result<(), String> {
        self.touch_activity();
        self.queue.advance(&self.agent_manager, &self.permissions).await
    }

    pub async fn on_item_completed(&self, slot: AgentSlot, result: Option<&str>) {
        self.touch_activity();
        self.queue.on_item_completed(slot, result, &self.agent_manager, &self.permissions, self).await;
    }

    pub async fn on_item_error(&self, slot: AgentSlot, error: &str) {
        self.touch_activity();
        self.queue.on_item_error(slot, error, &self.agent_manager, &self.permissions, self).await;
    }

    pub async fn skip_item(&self, item_id: i64) -> Result<(), String> {
        self.queue.skip_item(item_id, &self.agent_manager, &self.permissions).await
    }

    pub async fn retry_item(&self, item_id: i64) -> Result<(), String> {
        self.queue.retry_item(item_id, &self.agent_manager, &self.permissions).await
    }

    // ── Permission routing (delegates to PermissionRouter) ──

    pub async fn respond_permission(&self, slot: AgentSlot, response: PermissionResponse) -> Result<(), String> {
        self.permissions.respond(slot, response).await
    }

    // ── Agent operations (delegates to AgentManager) ──

    pub async fn interrupt_item(&self, slot: AgentSlot) -> Result<(), String> {
        self.agent_manager.interrupt_item(slot).await
    }

    pub async fn send_prompt(&self, slot: AgentSlot, text: &str, images: Option<Vec<String>>) -> Result<(), String> {
        self.agent_manager.send_prompt(slot, text, images, &self.permissions).await
    }

    pub async fn mark_done(&self, slot: AgentSlot) -> Result<(), String> {
        self.permissions.cleanup(&slot);
        self.agent_manager.mark_done(slot).await
    }

    /// Broadcast a `feature.updated` event to the frontend.
    pub fn send_feature_updated(&self, changed: &[&str]) {
        send_feature_updated_envelope(&self.ws_sender, self.feature_id, changed);
    }

    // ── Restore + lifecycle ──

    pub async fn restore_on_reconnect(&self) -> Result<(), String> {
        self.queue.restore_on_reconnect(&self.agent_manager).await
    }

    pub fn cancel(&self) {
        let _ = self.cancel_tx.send(true);
    }

    pub fn spawn_timeout_checker(&self, timeout_minutes: u64) {
        let read_pool = self.read_pool.clone();
        let write_pool = self.write_pool.clone();
        let feature_id = self.feature_id;
        let sender = self.ws_sender.clone();
        let active_items = self.agent_manager.active_items.clone();
        let mut cancel_rx = self.cancel_rx.clone();

        tokio::spawn(async move {
            let interval = std::time::Duration::from_secs(60);
            loop {
                tokio::select! {
                    _ = tokio::time::sleep(interval) => {}
                    _ = cancel_rx.changed() => {
                        info!(feature_id, "timeout checker cancelled");
                        break;
                    }
                }

                let stale: Vec<(i64,)> = match sqlx::query_as(
                    "SELECT id FROM workflow_queue WHERE feature_id = ? AND status = 'running' AND started_at < datetime('now', ?)",
                )
                .bind(feature_id)
                .bind(format!("-{timeout_minutes} minutes"))
                .fetch_all(&read_pool)
                .await {
                    Ok(rows) => rows,
                    Err(e) => {
                        tracing::error!(feature_id, error = %e, "timeout checker query failed");
                        continue;
                    }
                };

                for (item_id,) in stale {
                    warn!(feature_id, item_id, "agent timed out");
                    active_items.remove(&AgentSlot::QueueItem(item_id));

                    if let Err(e) = repo::mark_item_error(&write_pool, item_id, Some("Agent timed out")).await {
                        tracing::error!(item_id, error = %e, "failed to mark timed-out item");
                        continue;
                    }

                    let envelope = WsEnvelope::new(
                        "workflow",
                        "item_error",
                        to_value(WorkflowItemErrorPayload {
                            feature_id,
                            agent_slot: AgentSlot::QueueItem(item_id),
                            error: "Agent timed out".into(),
                        }),
                    );
                    let _ = sender.send(Message::Text(String::from(envelope).into()));
                }
            }
        });
    }
}

#[async_trait::async_trait]
impl StatusSetter for WorkflowEngine {
    async fn set_status(&self, status: WorkflowStatus) {
        self.set_status(status).await;
    }
}

impl Drop for WorkflowEngine {
    fn drop(&mut self) {
        let _ = self.cancel_tx.send(true);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::Ordering;

    /// Helper: create in-memory SQLite pool for tests.
    async fn test_pool() -> SqlitePool {
        SqlitePool::connect("sqlite::memory:").await.unwrap()
    }

    /// Helper: create a WorkflowEngine with in-memory pools and a dummy WsSender.
    async fn test_engine() -> (WorkflowEngine, mpsc::UnboundedReceiver<Message>) {
        let pool = test_pool().await;
        let (tx, rx) = mpsc::unbounded_channel();
        let engine = WorkflowEngine::new(
            1,
            WorkflowType::FeatureBuild,
            pool.clone(),
            pool,
            tx,
            2,
        );
        (engine, rx)
    }

    // ── 1. Constants ──

    #[test]
    fn test_synthetic_item_ids_are_negative() {
        assert!(PLAN_ITEM_ID < 0);
        assert!(PRD_ITEM_ID < 0);
        assert!(SESSION_ITEM_ID < 0);
        assert!(REFINE_ITEM_ID < 0);
    }

    #[test]
    fn test_synthetic_item_ids_are_distinct() {
        let ids = [PLAN_ITEM_ID, PRD_ITEM_ID, SESSION_ITEM_ID, REFINE_ITEM_ID];
        let unique: std::collections::HashSet<i64> = ids.iter().copied().collect();
        assert_eq!(unique.len(), ids.len(), "Synthetic IDs must be unique");
    }

    // ── 2. WorkflowEngine creation and initialization ──

    #[tokio::test]
    async fn test_engine_creation_defaults() {
        let (engine, _rx) = test_engine().await;

        assert_eq!(engine.feature_id, 1);
        assert_eq!(engine.workflow_type, WorkflowType::FeatureBuild);
        assert_eq!(engine.queue.max_parallel, 2);
        assert_eq!(engine.autonomy_level().load(Ordering::Relaxed), 3);
        assert!(engine.active_items().is_empty());
        assert!(engine.agent_manager.queries.is_empty());
        assert!(engine.permissions.permission_txs.is_empty());
        assert!(engine.agent_manager.interrupted_items.is_empty());
        assert!(engine.agent_manager.paused_sessions.is_empty());
    }

    #[tokio::test]
    async fn test_engine_last_activity_initialized() {
        let (engine, _rx) = test_engine().await;
        let activity = engine.last_activity.load(Ordering::Relaxed);
        assert!(activity > 1_577_836_800, "last_activity should be a recent Unix timestamp");
    }

    #[tokio::test]
    async fn test_engine_touch_activity_updates_timestamp() {
        let (engine, _rx) = test_engine().await;
        let before = engine.last_activity.load(Ordering::Relaxed);
        engine.touch_activity();
        let after = engine.last_activity.load(Ordering::Relaxed);
        assert!(after >= before);
    }

    // ── 3. Strategy registry ──

    #[test]
    fn test_strategy_feature_build() {
        use crate::domain::workflow::strategies;
        let strategy = strategies::get_strategy(&WorkflowType::FeatureBuild);
        assert!(strategy.is_ok());
        assert_eq!(strategy.unwrap().workflow_type(), WorkflowType::FeatureBuild);
    }

    // ── 4. DashMap-based state tracking (queue ordering, active items) ──

    #[tokio::test]
    async fn test_active_items_tracking() {
        let (engine, _rx) = test_engine().await;

        engine.agent_manager.active_items.insert(AgentSlot::QueueItem(10), 100);
        engine.agent_manager.active_items.insert(AgentSlot::QueueItem(20), 200);

        assert_eq!(engine.active_items().len(), 2);
        assert_eq!(*engine.active_items().get(&AgentSlot::QueueItem(10)).unwrap(), 100);
        assert_eq!(*engine.active_items().get(&AgentSlot::QueueItem(20)).unwrap(), 200);

        engine.agent_manager.active_items.remove(&AgentSlot::QueueItem(10));
        assert_eq!(engine.active_items().len(), 1);
        assert!(engine.active_items().get(&AgentSlot::QueueItem(10)).is_none());
    }

    #[tokio::test]
    async fn test_interrupted_items_tracking() {
        let (engine, _rx) = test_engine().await;

        engine.agent_manager.interrupted_items.insert(AgentSlot::QueueItem(42));
        assert!(engine.agent_manager.interrupted_items.contains(&AgentSlot::QueueItem(42)));

        let removed = engine.agent_manager.interrupted_items.remove(&AgentSlot::QueueItem(42));
        assert!(removed.is_some());

        let removed_again = engine.agent_manager.interrupted_items.remove(&AgentSlot::QueueItem(42));
        assert!(removed_again.is_none());
    }

    #[tokio::test]
    async fn test_paused_sessions_tracking() {
        let (engine, _rx) = test_engine().await;

        engine.agent_manager.paused_sessions.insert(AgentSlot::QueueItem(5), "session-abc".to_string());
        assert_eq!(*engine.agent_manager.paused_sessions.get(&AgentSlot::QueueItem(5)).unwrap(), "session-abc");

        let removed = engine.agent_manager.paused_sessions.remove(&AgentSlot::QueueItem(5));
        assert!(removed.is_some());
        assert_eq!(removed.unwrap().1, "session-abc");
    }

    // ── 5. Permission channel routing ──

    #[tokio::test]
    async fn test_respond_permission_no_channel() {
        let (engine, _rx) = test_engine().await;

        let response = PermissionResponse {
            decision: PermissionDecision::AllowOnce,
            feedback: None,
            updated_input: None,
        };
        let result = engine.respond_permission(AgentSlot::QueueItem(999), response).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("No permission channel"));
    }

    #[tokio::test]
    async fn test_respond_permission_with_channel() {
        let (engine, _rx) = test_engine().await;

        let (tx, mut perm_rx) = mpsc::channel::<PermissionResponse>(16);
        engine.permissions.permission_txs.insert(AgentSlot::QueueItem(42), tx);

        let response = PermissionResponse {
            decision: PermissionDecision::AllowOnce,
            feedback: None,
            updated_input: None,
        };
        let result = engine.respond_permission(AgentSlot::QueueItem(42), response).await;
        assert!(result.is_ok());

        let received = perm_rx.recv().await.unwrap();
        assert!(matches!(received.decision, PermissionDecision::AllowOnce));
    }

    // ── 6. Capacity check (advance logic) ──

    #[tokio::test]
    async fn test_advance_at_capacity_is_noop() {
        let (engine, _rx) = test_engine().await;
        engine.agent_manager.active_items.insert(AgentSlot::QueueItem(1), 100);
        engine.agent_manager.active_items.insert(AgentSlot::QueueItem(2), 200);

        let result = engine.advance().await;
        assert!(result.is_ok());
    }

    // ── 7. to_value helper ──

    #[test]
    fn test_to_value_string() {
        let v = to_value("hello");
        assert_eq!(v, serde_json::Value::String("hello".to_string()));
    }

    #[test]
    fn test_to_value_struct() {
        let v = to_value(serde_json::json!({"key": 42}));
        assert_eq!(v["key"], 42);
    }

    // ── 8. WorkflowType round-trip ──

    #[test]
    fn test_workflow_type_as_str() {
        assert_eq!(WorkflowType::FeatureBuild.as_str(), "feature_build");
    }

    #[test]
    fn test_workflow_type_from_str() {
        assert_eq!(
            WorkflowType::from_str("feature_build").unwrap(),
            WorkflowType::FeatureBuild
        );
        assert!(WorkflowType::from_str("unknown").is_err());
    }

    // ── 9. Cancel signal ──

    #[tokio::test]
    async fn test_cancel_signal() {
        let (engine, _rx) = test_engine().await;
        let mut cancel_rx = engine.cancel_rx.clone();

        assert!(!*cancel_rx.borrow());
        engine.cancel();
        cancel_rx.changed().await.unwrap();
        assert!(*cancel_rx.borrow());
    }

    // ── 10. Drop triggers cancel ──

    #[tokio::test]
    async fn test_drop_triggers_cancel() {
        let pool = test_pool().await;
        let (tx, _rx) = mpsc::unbounded_channel();
        let engine = WorkflowEngine::new(1, WorkflowType::FeatureBuild, pool.clone(), pool, tx, 1);
        let mut cancel_rx = engine.cancel_rx.clone();

        drop(engine);
        cancel_rx.changed().await.unwrap();
        assert!(*cancel_rx.borrow());
    }

    // ── 11. Agent type mapping via strategy ──

    #[tokio::test]
    async fn test_strategy_agent_type_mapping() {
        let (engine, _rx) = test_engine().await;

        assert!(matches!(engine.queue.strategy.agent_type_for_item("execute"), Ok(AgentType::Execute)));
        assert!(matches!(engine.queue.strategy.agent_type_for_item("qa"), Ok(AgentType::Qa)));
        assert!(matches!(engine.queue.strategy.agent_type_for_item("review"), Ok(AgentType::Review)));
        assert!(engine.queue.strategy.agent_type_for_item("bogus").is_err());
    }

    // ── 12. Autonomy level atomic updates ──

    #[tokio::test]
    async fn test_autonomy_level_update() {
        let (engine, _rx) = test_engine().await;

        assert_eq!(engine.autonomy_level().load(Ordering::Relaxed), 3);
        engine.autonomy_level().store(1, Ordering::Relaxed);
        assert_eq!(engine.autonomy_level().load(Ordering::Relaxed), 1);
        engine.autonomy_level().store(2, Ordering::Relaxed);
        assert_eq!(engine.autonomy_level().load(Ordering::Relaxed), 2);
    }

    // ── 13. QueueItem construction helper for testing ──

    fn make_queue_item(id: i64, item_type: &str, status: &str, order: i64, group: Option<i64>) -> crate::domain::features::models::QueueItem {
        crate::domain::features::models::QueueItem {
            id,
            feature_id: 1,
            workflow_type: "feature_build".to_string(),
            item_type: item_type.to_string(),
            phase_id: Some(id * 10),
            status: status.to_string(),
            order_index: order,
            group_index: group,
            config: None,
            agent_session_id: None,
            result: None,
            created_at: None,
            started_at: None,
            ended_at: None,
            pid: None,
        }
    }

    #[test]
    fn test_queue_item_ordering() {
        let items = vec![
            make_queue_item(3, "execute", "ready", 2, Some(1)),
            make_queue_item(1, "execute", "ready", 0, Some(0)),
            make_queue_item(2, "execute", "blocked", 1, Some(0)),
            make_queue_item(4, "review", "blocked", 3, Some(2)),
        ];

        let mut sorted = items.clone();
        sorted.sort_by_key(|i| i.order_index);
        assert_eq!(sorted[0].id, 1);
        assert_eq!(sorted[1].id, 2);
        assert_eq!(sorted[2].id, 3);
        assert_eq!(sorted[3].id, 4);
    }

    #[test]
    fn test_queue_item_group_index_parallel_identification() {
        let items = vec![
            make_queue_item(1, "execute", "ready", 0, Some(0)),
            make_queue_item(2, "execute", "ready", 1, Some(0)),
            make_queue_item(3, "execute", "blocked", 2, Some(1)),
        ];

        let group_0: Vec<_> = items.iter().filter(|i| i.group_index == Some(0)).collect();
        assert_eq!(group_0.len(), 2);

        let group_1: Vec<_> = items.iter().filter(|i| i.group_index == Some(1)).collect();
        assert_eq!(group_1.len(), 1);
    }

    #[test]
    fn test_queue_item_status_transitions() {
        let valid_statuses = ["ready", "blocked", "running", "completed", "error", "skipped", "paused"];
        for status in &valid_statuses {
            let item = make_queue_item(1, "execute", status, 0, Some(0));
            assert_eq!(item.status, *status);
        }
    }

    // ── 14. Topological sort integration (re-exported from populate) ──

    #[test]
    fn test_topological_sort_with_workflow_phases() {
        use crate::domain::workflow::populate::topological_sort;

        let nodes = vec![1, 2, 3];
        let edges = vec![(1, 2), (1, 3), (2, 3)];
        let result = topological_sort(&nodes, &edges).unwrap();

        let groups: std::collections::HashMap<i64, usize> = result.iter().copied().collect();
        assert_eq!(groups[&1], 0);
        assert_eq!(groups[&2], 1);
        assert_eq!(groups[&3], 2);

        let pos: std::collections::HashMap<i64, usize> = result
            .iter()
            .enumerate()
            .map(|(i, &(id, _))| (id, i))
            .collect();
        assert!(pos[&1] < pos[&2]);
        assert!(pos[&1] < pos[&3]);
        assert!(pos[&2] < pos[&3]);
    }

    #[test]
    fn test_topological_sort_cycle_detection() {
        use crate::domain::workflow::populate::topological_sort;

        let nodes = vec![1, 2];
        let edges = vec![(1, 2), (2, 1)];
        assert!(topological_sort(&nodes, &edges).is_err());
    }

    #[test]
    fn test_topological_sort_independent_phases() {
        use crate::domain::workflow::populate::topological_sort;

        let nodes = vec![10, 20, 30];
        let edges = vec![];
        let result = topological_sort(&nodes, &edges).unwrap();
        for &(_, group) in &result {
            assert_eq!(group, 0);
        }
    }

    // ── AgentSlot tests ──

    #[test]
    fn test_agent_slot_agent_type_str() {
        assert_eq!(AgentSlot::Plan.agent_type_str(), Some("plan"));
        assert_eq!(AgentSlot::Prd.agent_type_str(), Some("prd"));
        assert_eq!(AgentSlot::Session.agent_type_str(), Some("session"));
        assert_eq!(AgentSlot::Refine.agent_type_str(), Some("refine"));
        assert_eq!(AgentSlot::ReviewFixer.agent_type_str(), Some("review-fixer"));
        assert_eq!(AgentSlot::QueueItem(42).agent_type_str(), None);
    }

    #[test]
    fn test_agent_type_str_to_slot_mapping() {
        assert_eq!(agent_type_str_to_slot("plan"), Some(AgentSlot::Plan));
        assert_eq!(agent_type_str_to_slot("prd"), Some(AgentSlot::Prd));
        assert_eq!(agent_type_str_to_slot("session"), Some(AgentSlot::Session));
        assert_eq!(agent_type_str_to_slot("refine"), Some(AgentSlot::Refine));
        assert_eq!(agent_type_str_to_slot("review-fixer"), Some(AgentSlot::ReviewFixer));
        assert_eq!(agent_type_str_to_slot("review_fixer"), Some(AgentSlot::ReviewFixer));
        assert_eq!(agent_type_str_to_slot("execute"), None);
        assert_eq!(agent_type_str_to_slot(""), None);
    }

    #[test]
    fn test_agent_slot_roundtrip_via_legacy_id() {
        for slot in &[AgentSlot::Plan, AgentSlot::Prd, AgentSlot::Session, AgentSlot::Refine, AgentSlot::ReviewFixer] {
            let id = slot.as_legacy_id();
            let back = AgentSlot::from(id);
            assert_eq!(&back, slot);
        }
        assert_eq!(AgentSlot::from(42), AgentSlot::QueueItem(42));
    }

    #[test]
    fn test_agent_slot_sdk_agent_type() {
        assert!(matches!(AgentSlot::Plan.sdk_agent_type(), Some(AgentType::Plan)));
        assert!(matches!(AgentSlot::Refine.sdk_agent_type(), Some(AgentType::Plan)));
        assert!(matches!(AgentSlot::Prd.sdk_agent_type(), Some(AgentType::Prd)));
        assert!(matches!(AgentSlot::Session.sdk_agent_type(), Some(AgentType::Session)));
        assert!(matches!(AgentSlot::ReviewFixer.sdk_agent_type(), Some(AgentType::Execute)));
        assert!(AgentSlot::QueueItem(42).sdk_agent_type().is_none());
    }

    #[test]
    fn test_agent_slot_system_prompt() {
        assert!(AgentSlot::Plan.system_prompt().is_some());
        assert!(AgentSlot::Prd.system_prompt().is_some());
        assert!(AgentSlot::Session.system_prompt().is_some());
        assert!(AgentSlot::Refine.system_prompt().is_some());
        assert!(AgentSlot::ReviewFixer.system_prompt().is_none());
        assert!(AgentSlot::QueueItem(42).system_prompt().is_none());
    }

    #[test]
    fn test_agent_slot_is_queue_item() {
        assert!(!AgentSlot::Plan.is_queue_item());
        assert!(AgentSlot::QueueItem(1).is_queue_item());
    }

    #[test]
    fn test_agent_slot_display() {
        assert_eq!(format!("{}", AgentSlot::Plan), "plan");
        assert_eq!(format!("{}", AgentSlot::QueueItem(42)), "queue_item(42)");
    }

    // ── restore_on_reconnect ──

    async fn test_engine_with_schema() -> (WorkflowEngine, mpsc::UnboundedReceiver<Message>) {
        let pool = test_pool().await;
        sqlx::query(
            r#"CREATE TABLE features (
                id INTEGER PRIMARY KEY, project_id INTEGER, title TEXT,
                status TEXT DEFAULT 'draft', type TEXT DEFAULT 'feature'
            )"#,
        ).execute(&pool).await.unwrap();
        sqlx::query(
            r#"CREATE TABLE agent_sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                feature_id INTEGER NOT NULL,
                agent_type TEXT NOT NULL DEFAULT 'session',
                status TEXT NOT NULL DEFAULT 'idle',
                claude_session_id TEXT,
                model TEXT, permission_mode TEXT,
                has_file_changes INTEGER NOT NULL DEFAULT 0,
                input_tokens INTEGER NOT NULL DEFAULT 0,
                output_tokens INTEGER NOT NULL DEFAULT 0,
                context_window INTEGER NOT NULL DEFAULT 200000,
                started_at TEXT, ended_at TEXT
            )"#,
        ).execute(&pool).await.unwrap();
        sqlx::query(
            r#"CREATE TABLE workflow_queue (
                id INTEGER PRIMARY KEY,
                feature_id INTEGER NOT NULL,
                workflow_type TEXT NOT NULL DEFAULT 'feature_build',
                item_type TEXT NOT NULL,
                phase_id INTEGER,
                status TEXT NOT NULL DEFAULT 'pending',
                order_index INTEGER NOT NULL,
                group_index INTEGER,
                config JSON,
                agent_session_id INTEGER,
                result JSON,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                started_at DATETIME, ended_at DATETIME, pid INTEGER
            )"#,
        ).execute(&pool).await.unwrap();
        sqlx::query(
            r#"CREATE TABLE workflow_dependencies (
                item_id INTEGER NOT NULL,
                depends_on_id INTEGER NOT NULL,
                PRIMARY KEY (item_id, depends_on_id)
            )"#,
        ).execute(&pool).await.unwrap();

        let (tx, rx) = mpsc::unbounded_channel();
        let engine = WorkflowEngine::new(
            1,
            WorkflowType::FeatureBuild,
            pool.clone(),
            pool,
            tx,
            2,
        );
        (engine, rx)
    }

    #[tokio::test]
    async fn test_restore_on_reconnect_populates_paused_sessions() {
        let (engine, mut rx) = test_engine_with_schema().await;

        sqlx::query(
            "INSERT INTO agent_sessions (feature_id, agent_type, status, claude_session_id) VALUES (1, 'plan', 'paused', 'cc-resume-123')"
        ).execute(&engine.write_pool).await.unwrap();

        engine.restore_on_reconnect().await.unwrap();

        assert!(engine.agent_manager.paused_sessions.contains_key(&AgentSlot::Plan));
        assert_eq!(*engine.agent_manager.paused_sessions.get(&AgentSlot::Plan).unwrap(), "cc-resume-123");

        assert!(engine.active_items().contains_key(&AgentSlot::Plan));

        let mut got_queue_update = false;
        let mut got_agent_paused = false;
        while let Ok(msg) = rx.try_recv() {
            if let Message::Text(text) = msg {
                let text_str: &str = &text;
                if text_str.contains("queue_update") { got_queue_update = true; }
                if text_str.contains("agent_paused") && text_str.contains("cc-resume-123") {
                    got_agent_paused = true;
                }
            }
        }
        assert!(got_queue_update, "should have sent queue_update");
        assert!(got_agent_paused, "should have sent agent_paused with claude_session_id");
    }

    #[tokio::test]
    async fn test_restore_on_reconnect_ignores_sessions_without_claude_session_id() {
        let (engine, _rx) = test_engine_with_schema().await;

        sqlx::query(
            "INSERT INTO agent_sessions (feature_id, agent_type, status) VALUES (1, 'plan', 'running')"
        ).execute(&engine.write_pool).await.unwrap();

        engine.restore_on_reconnect().await.unwrap();

        assert!(engine.agent_manager.paused_sessions.is_empty());
        assert!(engine.active_items().is_empty());
    }

    #[tokio::test]
    async fn test_restore_on_reconnect_marks_stale_queue_items_as_error() {
        let (engine, _rx) = test_engine_with_schema().await;

        sqlx::query(
            "INSERT INTO workflow_queue (feature_id, item_type, status, order_index) VALUES (1, 'execute', 'running', 0)"
        ).execute(&engine.write_pool).await.unwrap();

        engine.restore_on_reconnect().await.unwrap();

        let row: (String,) = sqlx::query_as(
            "SELECT status FROM workflow_queue WHERE feature_id = 1"
        ).fetch_one(&engine.read_pool).await.unwrap();
        assert_eq!(row.0, "error");
    }

    #[tokio::test]
    async fn test_restore_on_reconnect_ignores_other_features() {
        let (engine, _rx) = test_engine_with_schema().await;

        sqlx::query(
            "INSERT INTO agent_sessions (feature_id, agent_type, status, claude_session_id) VALUES (999, 'plan', 'paused', 'other-feature')"
        ).execute(&engine.write_pool).await.unwrap();

        engine.restore_on_reconnect().await.unwrap();

        assert!(engine.agent_manager.paused_sessions.is_empty());
    }

    #[tokio::test]
    async fn test_send_prompt_returns_error_for_unknown_positive_item() {
        let (engine, _rx) = test_engine().await;

        let result = engine.send_prompt(AgentSlot::QueueItem(999), "hello", None).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("No query handle"));
    }

    #[tokio::test]
    async fn test_send_prompt_uses_paused_session_for_resume() {
        let (engine, _rx) = test_engine_with_schema().await;

        let db_id: i64 = sqlx::query_scalar(
            "INSERT INTO agent_sessions (feature_id, agent_type, status, claude_session_id) VALUES (1, 'plan', 'paused', 'cc-resume-456') RETURNING id"
        ).fetch_one(&engine.write_pool).await.unwrap();

        engine.agent_manager.paused_sessions.insert(AgentSlot::Plan, "cc-resume-456".to_string());
        engine.agent_manager.active_items.insert(AgentSlot::Plan, db_id);

        let _ = engine.send_prompt(AgentSlot::Plan, "continue", None).await;

        assert!(!engine.agent_manager.paused_sessions.contains_key(&AgentSlot::Plan));
    }

    // ── on_item_completed sends feature.updated for pre-queue agents ──

    #[tokio::test]
    async fn test_on_item_completed_plan_sends_feature_updated() {
        let (engine, mut rx) = test_engine_with_schema().await;

        sqlx::query("INSERT INTO features (id, project_id, title) VALUES (1, 1, 'test')")
            .execute(&engine.write_pool).await.unwrap();

        engine.on_item_completed(AgentSlot::Plan, Some("done")).await;

        let mut got_item_completed = false;
        let mut got_feature_updated = false;
        let mut updated_fields: Vec<String> = Vec::new();
        while let Ok(msg) = rx.try_recv() {
            if let Message::Text(text) = msg {
                let text_str: &str = &text;
                if text_str.contains("item_completed") {
                    got_item_completed = true;
                }
                if text_str.contains("\"updated\"") && text_str.contains("\"feature\"") {
                    got_feature_updated = true;
                    if let Ok(v) = serde_json::from_str::<serde_json::Value>(text_str) {
                        if let Some(changed) = v["payload"]["changed"].as_array() {
                            updated_fields = changed.iter().filter_map(|v| v.as_str().map(String::from)).collect();
                        }
                    }
                }
            }
        }
        assert!(got_item_completed, "should send item_completed");
        assert!(got_feature_updated, "should send feature.updated for plan agent");
        assert!(updated_fields.contains(&"plan".to_string()));
        assert!(updated_fields.contains(&"phases".to_string()));
        assert!(updated_fields.contains(&"progress".to_string()));
    }

    #[tokio::test]
    async fn test_on_item_completed_prd_sends_feature_updated() {
        let (engine, mut rx) = test_engine_with_schema().await;

        sqlx::query("INSERT INTO features (id, project_id, title) VALUES (1, 1, 'test')")
            .execute(&engine.write_pool).await.unwrap();

        engine.on_item_completed(AgentSlot::Prd, None).await;

        let mut got_feature_updated = false;
        let mut updated_fields: Vec<String> = Vec::new();
        while let Ok(msg) = rx.try_recv() {
            if let Message::Text(text) = msg {
                let text_str: &str = &text;
                if text_str.contains("\"updated\"") && text_str.contains("\"feature\"") {
                    got_feature_updated = true;
                    if let Ok(v) = serde_json::from_str::<serde_json::Value>(text_str) {
                        if let Some(changed) = v["payload"]["changed"].as_array() {
                            updated_fields = changed.iter().filter_map(|v| v.as_str().map(String::from)).collect();
                        }
                    }
                }
            }
        }
        assert!(got_feature_updated, "should send feature.updated for prd agent");
        assert_eq!(updated_fields, vec!["prd"]);
    }

    #[tokio::test]
    async fn test_on_item_completed_regular_item_no_feature_updated() {
        let (engine, mut rx) = test_engine_with_schema().await;

        sqlx::query("INSERT INTO features (id, project_id, title) VALUES (1, 1, 'test')")
            .execute(&engine.write_pool).await.unwrap();

        engine.on_item_completed(AgentSlot::QueueItem(42), Some("done")).await;

        let mut got_feature_updated = false;
        while let Ok(msg) = rx.try_recv() {
            if let Message::Text(text) = msg {
                let text_str: &str = &text;
                if text_str.contains("\"updated\"") && text_str.contains("\"feature\"") {
                    got_feature_updated = true;
                }
            }
        }
        assert!(!got_feature_updated, "regular items should NOT send feature.updated");
    }

    // ── send_feature_updated_envelope helper ──

    #[test]
    fn test_send_feature_updated_envelope_format() {
        let (tx, mut rx) = mpsc::unbounded_channel();
        send_feature_updated_envelope(&tx, 123, &["plan", "phases"]);

        let msg = rx.try_recv().unwrap();
        if let Message::Text(text) = msg {
            let v: serde_json::Value = serde_json::from_str(&text).unwrap();
            assert_eq!(v["domain"], "feature");
            assert_eq!(v["action"], "updated");
            assert_eq!(v["payload"]["feature_id"], 123);
            let changed: Vec<String> = v["payload"]["changed"].as_array().unwrap()
                .iter().filter_map(|v| v.as_str().map(String::from)).collect();
            assert_eq!(changed, vec!["plan", "phases"]);
        } else {
            panic!("expected Text message");
        }
    }
}

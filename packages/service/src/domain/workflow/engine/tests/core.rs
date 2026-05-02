use std::sync::atomic::Ordering;

use tokio::sync::mpsc;

use crate::domain::features::models::WorkflowType;
use crate::domain::mcp::servers::AgentType;
use crate::domain::workflow::engine::*;
use crate::domain::ws_session::handler::session_prompt::PermissionResponse;
use crate::domain::ws_session::protocol::PermissionDecision;

use super::helpers::*;

// ── WorkflowEngine creation and initialization ──

#[tokio::test]
async fn test_engine_creation_defaults() {
    let (engine, _rx) = test_engine().await;

    assert_eq!(engine.feature_id, 1);
    assert_eq!(engine.workflow_type, WorkflowType::FeatureBuild);
    assert_eq!(engine.queue.max_parallel.load(Ordering::Relaxed), 2);
    assert_eq!(engine.autonomy_level().load(Ordering::Relaxed), 1);
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
    assert!(
        activity > 1_577_836_800,
        "last_activity should be a recent Unix timestamp"
    );
}

#[tokio::test]
async fn test_engine_touch_activity_updates_timestamp() {
    let (engine, _rx) = test_engine().await;
    let before = engine.last_activity.load(Ordering::Relaxed);
    engine.touch_activity();
    let after = engine.last_activity.load(Ordering::Relaxed);
    assert!(after >= before);
}

#[tokio::test]
async fn test_set_max_parallel() {
    let (engine, _rx) = test_engine().await;
    assert_eq!(engine.queue.max_parallel.load(Ordering::Relaxed), 2);

    engine.set_max_parallel(1);
    assert_eq!(engine.queue.max_parallel.load(Ordering::Relaxed), 1);

    engine.set_max_parallel(5);
    assert_eq!(engine.queue.max_parallel.load(Ordering::Relaxed), 5);
}

// ── Strategy registry ──

#[test]
fn test_strategy_feature_build() {
    use crate::domain::workflow::strategies;
    let strategy = strategies::get_strategy(&WorkflowType::FeatureBuild);
    assert!(strategy.is_ok());
    assert_eq!(
        strategy.unwrap().workflow_type(),
        WorkflowType::FeatureBuild
    );
}

// ── DashMap-based state tracking ──

#[tokio::test]
async fn test_active_items_tracking() {
    let (engine, _rx) = test_engine().await;

    engine
        .agent_manager
        .active_items
        .insert(AgentSlot::QueueItem(10), 100);
    engine
        .agent_manager
        .active_items
        .insert(AgentSlot::QueueItem(20), 200);

    assert_eq!(engine.active_items().len(), 2);
    assert_eq!(
        *engine
            .active_items()
            .get(&AgentSlot::QueueItem(10))
            .unwrap(),
        100
    );
    assert_eq!(
        *engine
            .active_items()
            .get(&AgentSlot::QueueItem(20))
            .unwrap(),
        200
    );

    engine
        .agent_manager
        .active_items
        .remove(&AgentSlot::QueueItem(10));
    assert_eq!(engine.active_items().len(), 1);
    assert!(engine
        .active_items()
        .get(&AgentSlot::QueueItem(10))
        .is_none());
}

#[tokio::test]
async fn test_interrupted_items_tracking() {
    let (engine, _rx) = test_engine().await;

    engine
        .agent_manager
        .interrupted_items
        .insert(AgentSlot::QueueItem(42));
    assert!(engine
        .agent_manager
        .interrupted_items
        .contains(&AgentSlot::QueueItem(42)));

    let removed = engine
        .agent_manager
        .interrupted_items
        .remove(&AgentSlot::QueueItem(42));
    assert!(removed.is_some());

    let removed_again = engine
        .agent_manager
        .interrupted_items
        .remove(&AgentSlot::QueueItem(42));
    assert!(removed_again.is_none());
}

#[tokio::test]
async fn test_interrupted_flag_cleared_before_resume() {
    let (engine, _rx) = test_engine().await;
    let slot = AgentSlot::QueueItem(99);

    engine.agent_manager.interrupted_items.insert(slot.clone());
    assert!(engine.agent_manager.interrupted_items.contains(&slot));

    engine.agent_manager.interrupted_items.remove(&slot);
    assert!(!engine.agent_manager.interrupted_items.contains(&slot));
}

#[tokio::test]
async fn test_paused_sessions_tracking() {
    let (engine, _rx) = test_engine().await;

    engine
        .agent_manager
        .paused_sessions
        .insert(AgentSlot::QueueItem(5), "session-abc".to_string());
    assert_eq!(
        *engine
            .agent_manager
            .paused_sessions
            .get(&AgentSlot::QueueItem(5))
            .unwrap(),
        "session-abc"
    );

    let removed = engine
        .agent_manager
        .paused_sessions
        .remove(&AgentSlot::QueueItem(5));
    assert!(removed.is_some());
    assert_eq!(removed.unwrap().1, "session-abc");
}

// ── Permission channel routing ──

#[tokio::test]
async fn test_respond_permission_no_channel() {
    let (engine, _rx) = test_engine().await;

    let response = PermissionResponse {
        request_id: "req-1".to_string(),
        decision: PermissionDecision::AllowOnce,
        option_id: None,
        feedback: None,
        updated_input: None,
        is_approval_gate: false,
    };
    let result = engine
        .respond_permission(AgentSlot::QueueItem(999), response)
        .await;
    assert!(result.is_err());
    assert!(result.unwrap_err().contains("No permission channel"));
}

#[tokio::test]
async fn test_respond_permission_with_channel() {
    let (engine, _rx) = test_engine().await;

    let (tx, mut perm_rx) = mpsc::channel::<PermissionResponse>(16);
    engine
        .permissions
        .permission_txs
        .insert(AgentSlot::QueueItem(42), tx);

    let response = PermissionResponse {
        request_id: "req-2".to_string(),
        decision: PermissionDecision::AllowOnce,
        option_id: None,
        feedback: None,
        updated_input: None,
        is_approval_gate: false,
    };
    let result = engine
        .respond_permission(AgentSlot::QueueItem(42), response)
        .await;
    assert!(result.is_ok());

    let received = perm_rx.recv().await.unwrap();
    assert!(matches!(received.decision, PermissionDecision::AllowOnce));
}

// ── Capacity check ──

#[tokio::test]
async fn test_advance_at_capacity_is_noop() {
    let (engine, _rx) = test_engine().await;
    engine
        .agent_manager
        .active_items
        .insert(AgentSlot::QueueItem(1), 100);
    engine
        .agent_manager
        .active_items
        .insert(AgentSlot::QueueItem(2), 200);

    let result = engine.advance().await;
    assert!(result.is_ok());
}

// ── to_value helper ──

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

// ── WorkflowType round-trip ──

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

// ── Agent type mapping via strategy ──

#[tokio::test]
async fn test_strategy_agent_type_mapping() {
    let (engine, _rx) = test_engine().await;

    assert!(matches!(
        engine.queue.strategy.agent_type_for_item("execute", None),
        Ok(AgentType::Execute)
    ));
    assert!(matches!(
        engine.queue.strategy.agent_type_for_item("qa", None),
        Ok(AgentType::Qa)
    ));
    assert!(matches!(
        engine.queue.strategy.agent_type_for_item("review", None),
        Ok(AgentType::Review)
    ));
    assert!(engine
        .queue
        .strategy
        .agent_type_for_item("bogus", None)
        .is_err());
}

// ── Autonomy level ──

#[tokio::test]
async fn test_autonomy_level_update() {
    let (engine, _rx) = test_engine().await;

    assert_eq!(engine.autonomy_level().load(Ordering::Relaxed), 1);
    engine.autonomy_level().store(1, Ordering::Relaxed);
    assert_eq!(engine.autonomy_level().load(Ordering::Relaxed), 1);
    engine.autonomy_level().store(2, Ordering::Relaxed);
    assert_eq!(engine.autonomy_level().load(Ordering::Relaxed), 2);
}

#[tokio::test]
async fn test_autonomy_level_from_db_global_setting() {
    let pool = test_pool().await;
    sqlx::query("CREATE TABLE IF NOT EXISTS features (id INTEGER PRIMARY KEY, project_id INTEGER, agent_autonomy TEXT)")
        .execute(&pool).await.unwrap();
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS projects (id INTEGER PRIMARY KEY, agent_autonomy TEXT)",
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query("CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO projects (id) VALUES (1)")
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO features (id, project_id) VALUES (1, 1)")
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO settings (key, value) VALUES ('agent_autonomy', '3')")
        .execute(&pool)
        .await
        .unwrap();

    let (tx, _rx) = mpsc::unbounded_channel();
    let (session_status_tx, _) = tokio::sync::broadcast::channel(64);
    let broadcaster = crate::domain::session_status::SessionStatusBroadcaster::new(
        session_status_tx,
        std::sync::Arc::new(std::sync::atomic::AtomicU64::new(0)),
    );
    let engine = WorkflowEngine::new(
        1,
        WorkflowType::FeatureBuild,
        pool.clone(),
        pool,
        tx,
        2,
        broadcaster,
    )
    .await
    .expect("test engine creation failed");

    assert_eq!(engine.autonomy_level().load(Ordering::Relaxed), 3);
}

#[tokio::test]
async fn test_autonomy_level_feature_overrides_global() {
    let pool = test_pool().await;
    sqlx::query("CREATE TABLE IF NOT EXISTS features (id INTEGER PRIMARY KEY, project_id INTEGER, agent_autonomy TEXT)")
        .execute(&pool).await.unwrap();
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS projects (id INTEGER PRIMARY KEY, agent_autonomy TEXT)",
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query("CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO projects (id) VALUES (1)")
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO features (id, project_id, agent_autonomy) VALUES (1, 1, '2')")
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO settings (key, value) VALUES ('agent_autonomy', '3')")
        .execute(&pool)
        .await
        .unwrap();

    let (tx, _rx) = mpsc::unbounded_channel();
    let (session_status_tx, _) = tokio::sync::broadcast::channel(64);
    let broadcaster = crate::domain::session_status::SessionStatusBroadcaster::new(
        session_status_tx,
        std::sync::Arc::new(std::sync::atomic::AtomicU64::new(0)),
    );
    let engine = WorkflowEngine::new(
        1,
        WorkflowType::FeatureBuild,
        pool.clone(),
        pool,
        tx,
        2,
        broadcaster,
    )
    .await
    .expect("test engine creation failed");

    assert_eq!(engine.autonomy_level().load(Ordering::Relaxed), 2);
}

// ── Queue item ordering and grouping ──

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
    let valid_statuses = [
        "ready",
        "blocked",
        "running",
        "completed",
        "error",
        "skipped",
        "paused",
    ];
    for status in &valid_statuses {
        let item = make_queue_item(1, "execute", status, 0, Some(0));
        assert_eq!(item.status, *status);
    }
}

// ── Topological sort ──

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

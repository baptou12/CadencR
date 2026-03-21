use sqlx::SqlitePool;

use crate::error::AppError;
use super::super::models::*;
use super::plan_repository::get_plan_with_phases;
use super::settings_repository::get_feature_settings;
use super::feature_repository::get_workflow_status;

pub async fn get_feature_snapshot(
    pool: &SqlitePool,
    feature_id: i64,
) -> Result<FeatureSnapshotResponse, AppError> {
    // 1. Queue items with phase_title via LEFT JOIN
    let queue: Vec<SnapshotQueueItem> = sqlx::query_as::<_, SnapshotQueueItem>(
        r#"SELECT q.id, q.item_type, q.phase_id,
                  p.title as phase_title,
                  q.status, q.order_index, q.group_index,
                  q.agent_session_id, q.result
           FROM workflow_queue q
           LEFT JOIN phases p ON q.phase_id = p.id
           WHERE q.feature_id = ?
           ORDER BY q.order_index"#,
    )
    .bind(feature_id)
    .fetch_all(pool)
    .await?;

    // 2. Agent sessions (lightweight summary)
    let agent_sessions: Vec<AgentSessionSummary> = sqlx::query_as::<_, AgentSessionSummary>(
        r#"SELECT s.id, COALESCE(s.agent_type, 'unknown') as agent_type, COALESCE(s.status, 'idle') as status,
                  wq.id as queue_item_id,
                  COALESCE(s.started_at, '') as created_at,
                  NULL as updated_at,
                  s.claude_session_id
           FROM agent_sessions s
           LEFT JOIN workflow_queue wq ON wq.agent_session_id = s.id AND wq.feature_id = ?
           WHERE s.feature_id = ?"#,
    )
    .bind(feature_id)
    .bind(feature_id)
    .fetch_all(pool)
    .await?;

    // 3. Plan + phases
    let plan_snapshot = match get_plan_with_phases(pool, feature_id).await? {
        Some((plan, phases)) => Some(PlanSnapshot {
            id: plan.id,
            status: plan.status.unwrap_or_else(|| "draft".to_string()),
            phases,
        }),
        None => None,
    };

    // 4. Feature settings for worktree + autonomy
    let settings = get_feature_settings(pool, feature_id).await?;
    let worktree_path = settings.iter().find(|s| s.key == "worktree_path").map(|s| s.value.clone());
    let worktree_branch = settings.iter().find(|s| s.key == "worktree_branch").map(|s| s.value.clone());
    let worktree_status_val = settings.iter().find(|s| s.key == "worktree_setup_step").map(|s| s.value.as_str());

    let worktree = if worktree_path.is_some() || worktree_branch.is_some() || worktree_status_val.is_some() {
        Some(WorktreeSnapshot {
            path: worktree_path,
            branch: worktree_branch,
            status: worktree_status_val.unwrap_or("none").to_string(),
        })
    } else {
        None
    };

    let autonomy_level: u8 = settings
        .iter()
        .find(|s| s.key == "agent_autonomy")
        .and_then(|s| s.value.parse().ok())
        .unwrap_or(3);

    // 5. Read workflow status from DB (explicit state machine)
    let workflow_status = get_workflow_status(pool, feature_id)
        .await
        .unwrap_or(crate::domain::workflow::status::WorkflowStatus::Idle)
        .to_string();

    Ok(FeatureSnapshotResponse {
        workflow_status,
        queue,
        agent_sessions,
        plan: plan_snapshot,
        worktree,
        autonomy_level,
    })
}

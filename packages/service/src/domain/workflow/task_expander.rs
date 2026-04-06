//! Expands a decomposable execute phase into individual task queue items.
//!
//! When a "tasks" phase completes and produces workflow_tasks via MCP,
//! this module replaces the downstream execute placeholder with per-task items.

use std::collections::HashMap;

use sqlx::SqlitePool;
use tracing::{info, warn};

use crate::domain::features::repository as repo;
use crate::domain::ws_workflow::task_repository;
use super::populate::topological_sort;

/// Check if a completed phase triggers expansion of a downstream decomposable phase.
/// Called after a phase completes (auto-gate or approval).
pub async fn maybe_expand_downstream(
    write_pool: &SqlitePool,
    read_pool: &SqlitePool,
    feature_id: i64,
    completed_phase_slug: &str,
) -> Result<bool, String> {
    // Find any queue item whose config has decompose_from matching the completed slug
    let items = repo::get_queue_for_feature(read_pool, feature_id)
        .await
        .map_err(|e| e.to_string())?;

    let placeholder = items.iter().find(|item| {
        if let Some(ref config_str) = item.config {
            if let Ok(config) = serde_json::from_str::<serde_json::Value>(config_str) {
                return config
                    .get("decompose_from")
                    .and_then(|v| v.as_str())
                    .is_some_and(|s| s == completed_phase_slug);
            }
        }
        false
    });

    let placeholder = match placeholder {
        Some(p) => p.clone(),
        None => return Ok(false),
    };

    let tasks = task_repository::list_tasks(read_pool, feature_id, completed_phase_slug)
        .await
        .map_err(|e| e.to_string())?;

    if tasks.is_empty() {
        warn!(
            feature_id,
            phase = completed_phase_slug,
            "Decomposable phase completed but no tasks were created"
        );
        return Ok(false);
    }

    info!(
        feature_id,
        phase = completed_phase_slug,
        task_count = tasks.len(),
        "Expanding execute phase into individual tasks"
    );

    expand_phase(write_pool, feature_id, &placeholder, &tasks).await?;
    Ok(true)
}

async fn expand_phase(
    pool: &SqlitePool,
    feature_id: i64,
    placeholder: &crate::domain::features::models::QueueItem,
    tasks: &[crate::domain::ws_workflow::models::WorkflowTask],
) -> Result<(), String> {
    let placeholder_id = placeholder.id;
    let parent_slug = &placeholder.item_type;

    // Get config from placeholder for inheriting agent_type, model_override, etc.
    let parent_config: serde_json::Value = placeholder
        .config
        .as_deref()
        .and_then(|s| serde_json::from_str(s).ok())
        .unwrap_or_else(|| serde_json::json!({}));

    // Find items that the placeholder depends on (upstream deps)
    let upstream_deps = get_upstream_deps(pool, placeholder_id).await?;
    // Find items that depend on the placeholder (downstream deps)
    let downstream_deps = get_downstream_deps(pool, placeholder_id).await?;

    // Create synthetic plan + phases for execute agents
    let plan_id = get_or_create_synthetic_plan(pool, feature_id).await?;

    // Build task dependency graph for topological sort
    let task_ids: Vec<i64> = tasks.iter().map(|t| t.id).collect();
    let title_to_id: HashMap<&str, i64> = tasks.iter().map(|t| (t.title.as_str(), t.id)).collect();

    let mut edges: Vec<(i64, i64)> = Vec::new();
    for task in tasks {
        for dep_title in &task.depends_on {
            if let Some(&dep_id) = title_to_id.get(dep_title.as_str()) {
                edges.push((dep_id, task.id));
            }
        }
    }

    let sorted = topological_sort(&task_ids, &edges)
        .unwrap_or_else(|_| task_ids.iter().copied().enumerate().map(|(i, id)| (id, i)).collect());

    let id_to_group: HashMap<i64, usize> = sorted.iter().copied().collect();
    let id_to_order: HashMap<i64, usize> = sorted
        .iter()
        .enumerate()
        .map(|(i, &(id, _))| (id, i))
        .collect();

    // Base order_index: use placeholder's order, offset sub-tasks within
    let base_order = placeholder.order_index;

    // Delete placeholder and its dependency edges
    delete_placeholder(pool, placeholder_id).await?;

    // Insert queue items + phases for each task
    let mut task_to_queue_id: HashMap<i64, i64> = HashMap::new();

    for task in tasks {
        let order = *id_to_order.get(&task.id).unwrap_or(&0);
        let group = *id_to_group.get(&task.id).unwrap_or(&0) as i64;

        // Create synthetic phase row for cadence-execute MCP compatibility
        let phase_id = create_synthetic_phase(
            pool,
            plan_id,
            &task.title,
            &task.description,
            &task.commit_message,
            order as i32,
            &task.depends_on,
        )
        .await?;

        let config = serde_json::json!({
            "agent_type": parent_config.get("agent_type").and_then(|v| v.as_str()).unwrap_or("execute"),
            "gate_type": "auto",
            "decomposed": true,
            "parent_phase_slug": parent_slug,
            "task_id": task.id,
            "task_title": task.title,
            "model_override": parent_config.get("model_override").and_then(|v| v.as_str()).unwrap_or(""),
        });

        let queue_id = repo::insert_queue_item_with_config(
            pool,
            feature_id,
            "custom",
            &format!("{}:{:03}", parent_slug, order),
            "blocked",
            base_order + order as i64,
            Some(group),
            Some(&config.to_string()),
        )
        .await
        .map_err(|e| e.to_string())?;

        // Link queue item to synthetic phase
        repo::set_item_phase(pool, queue_id, phase_id)
            .await
            .map_err(|e| e.to_string())?;

        task_to_queue_id.insert(task.id, queue_id);
    }

    // Wire upstream dependencies: each task item depends on what placeholder depended on
    for &upstream_id in &upstream_deps {
        for &queue_id in task_to_queue_id.values() {
            repo::insert_dependency(pool, queue_id, upstream_id)
                .await
                .map_err(|e| e.to_string())?;
        }
    }

    // Wire task-to-task dependencies
    for task in tasks {
        let &queue_id = task_to_queue_id.get(&task.id).unwrap();
        for dep_title in &task.depends_on {
            if let Some(&dep_task_id) = title_to_id.get(dep_title.as_str()) {
                if let Some(&dep_queue_id) = task_to_queue_id.get(&dep_task_id) {
                    repo::insert_dependency(pool, queue_id, dep_queue_id)
                        .await
                        .map_err(|e| e.to_string())?;
                }
            }
        }
    }

    // Wire downstream dependencies: items that depended on placeholder now depend on all task items
    for &downstream_id in &downstream_deps {
        for &queue_id in task_to_queue_id.values() {
            repo::insert_dependency(pool, downstream_id, queue_id)
                .await
                .map_err(|e| e.to_string())?;
        }
    }

    Ok(())
}

async fn get_upstream_deps(pool: &SqlitePool, item_id: i64) -> Result<Vec<i64>, String> {
    let rows = sqlx::query_as::<_, (i64,)>(
        "SELECT depends_on_item_id FROM workflow_dependencies WHERE queue_item_id = ?",
    )
    .bind(item_id)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;
    Ok(rows.into_iter().map(|r| r.0).collect())
}

async fn get_downstream_deps(pool: &SqlitePool, item_id: i64) -> Result<Vec<i64>, String> {
    let rows = sqlx::query_as::<_, (i64,)>(
        "SELECT queue_item_id FROM workflow_dependencies WHERE depends_on_item_id = ?",
    )
    .bind(item_id)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;
    Ok(rows.into_iter().map(|r| r.0).collect())
}

async fn delete_placeholder(pool: &SqlitePool, item_id: i64) -> Result<(), String> {
    sqlx::query("DELETE FROM workflow_dependencies WHERE queue_item_id = ? OR depends_on_item_id = ?")
        .bind(item_id)
        .bind(item_id)
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;

    repo::delete_item(pool, item_id)
        .await
        .map_err(|e| e.to_string())?;

    Ok(())
}

async fn get_or_create_synthetic_plan(
    pool: &SqlitePool,
    feature_id: i64,
) -> Result<i64, String> {
    // Check for existing plan
    let existing = sqlx::query_as::<_, (i64,)>(
        "SELECT id FROM plans WHERE feature_id = ? ORDER BY id DESC LIMIT 1",
    )
    .bind(feature_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| e.to_string())?;

    if let Some((id,)) = existing {
        return Ok(id);
    }

    let (id,) = sqlx::query_as::<_, (i64,)>(
        "INSERT INTO plans (feature_id, title, status) VALUES (?, 'Workflow Tasks', 'active') RETURNING id",
    )
    .bind(feature_id)
    .fetch_one(pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(id)
}

async fn create_synthetic_phase(
    pool: &SqlitePool,
    plan_id: i64,
    title: &str,
    description: &str,
    commit_message: &str,
    order: i32,
    depends_on: &[String],
) -> Result<i64, String> {
    let depends_json = serde_json::to_string(depends_on).unwrap_or_else(|_| "[]".to_string());

    let (id,) = sqlx::query_as::<_, (i64,)>(
        "INSERT INTO phases (plan_id, step_number, title, prompt, commit_message, \
         order_index, phase_type, depends_on, status) \
         VALUES (?, ?, ?, ?, ?, ?, 'value', ?, 'pending') RETURNING id",
    )
    .bind(plan_id)
    .bind(order)
    .bind(title)
    .bind(description)
    .bind(commit_message)
    .bind(order)
    .bind(&depends_json)
    .fetch_one(pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(id)
}

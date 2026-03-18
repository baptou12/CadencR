use std::collections::HashMap;

use async_trait::async_trait;
use sqlx::SqlitePool;

use crate::domain::features::models::{Phase, QueueItem, WorkflowType};
use crate::domain::features::repository;
use crate::domain::mcp::servers::AgentType;
use crate::domain::workflow::populate::topological_sort;
use crate::domain::workflow::prompts::{build_execute_prompt, build_qa_prompt, Prompts};

use super::WorkflowStrategy;

pub struct FeatureBuildStrategy;

#[async_trait]
impl WorkflowStrategy for FeatureBuildStrategy {
    fn workflow_type(&self) -> WorkflowType {
        WorkflowType::FeatureBuild
    }

    async fn populate_queue(
        &self,
        write_pool: &SqlitePool,
        read_pool: &SqlitePool,
        feature_id: i64,
        plan_id: Option<i64>,
    ) -> Result<Vec<QueueItem>, String> {
        let plan_id = plan_id.ok_or("FeatureBuild requires a plan_id")?;

        // 1. Clear existing queue (idempotent)
        repository::clear_queue_for_feature(write_pool, feature_id)
            .await
            .map_err(|e| format!("Failed to clear queue: {e}"))?;

        // 2. Read all phases for the plan
        let phases: Vec<Phase> = sqlx::query_as(
            "SELECT * FROM phases WHERE plan_id = ? ORDER BY order_index, step_number",
        )
        .bind(plan_id)
        .fetch_all(read_pool)
        .await
        .map_err(|e| format!("Failed to read phases: {e}"))?;

        if phases.is_empty() {
            return Ok(vec![]);
        }

        // 3. Build title -> phase map for resolving depends_on references
        let title_to_phase: HashMap<String, &Phase> = phases
            .iter()
            .map(|p| (p.title.clone(), p))
            .collect();

        let phase_ids: Vec<i64> = phases.iter().map(|p| p.id).collect();

        // 4. Resolve depends_on title references to edges
        let mut edges: Vec<(i64, i64)> = Vec::new();
        for phase in &phases {
            if let Some(ref deps_str) = phase.depends_on {
                let deps_str = deps_str.trim();
                if deps_str.is_empty() {
                    continue;
                }
                for dep_title in deps_str.split(',') {
                    let dep_title = dep_title.trim();
                    if dep_title.is_empty() {
                        continue;
                    }
                    let dep_phase = title_to_phase.get(dep_title).ok_or_else(|| {
                        format!(
                            "Phase '{}' depends on '{}' which does not exist in plan",
                            phase.title, dep_title
                        )
                    })?;
                    edges.push((dep_phase.id, phase.id));
                }
            }
        }

        // 5. Topological sort with group indices
        let sorted = topological_sort(&phase_ids, &edges)?;
        let id_to_group: HashMap<i64, usize> = sorted.iter().copied().collect();
        let id_to_order: HashMap<i64, usize> = sorted
            .iter()
            .enumerate()
            .map(|(i, &(id, _))| (id, i))
            .collect();

        // 6. Insert queue items
        let workflow_type_str = WorkflowType::FeatureBuild.as_str();
        let mut phase_to_queue_item: HashMap<i64, i64> = HashMap::new();

        for phase in &phases {
            let order_index = *id_to_order.get(&phase.id).unwrap_or(&0) as i64;
            let group_index = *id_to_group.get(&phase.id).unwrap_or(&0) as i64;

            let item_type = map_phase_type_to_item_type(phase.phase_type.as_deref());
            let has_deps = phase.depends_on.as_ref().map_or(false, |d| !d.trim().is_empty());
            let status = if has_deps { "blocked" } else { "ready" };

            let queue_id = repository::insert_queue_item(
                write_pool,
                feature_id,
                workflow_type_str,
                item_type,
                Some(phase.id),
                status,
                order_index,
                Some(group_index),
            )
            .await
            .map_err(|e| format!("Failed to insert queue item: {e}"))?;

            phase_to_queue_item.insert(phase.id, queue_id);
        }

        // 7. Insert dependency edges
        for phase in &phases {
            if let Some(ref deps_str) = phase.depends_on {
                for dep_title in deps_str.split(',') {
                    let dep_title = dep_title.trim();
                    if dep_title.is_empty() {
                        continue;
                    }
                    if let Some(dep_phase) = title_to_phase.get(dep_title) {
                        let queue_item_id = phase_to_queue_item[&phase.id];
                        let depends_on_item_id = phase_to_queue_item[&dep_phase.id];
                        repository::insert_dependency(write_pool, queue_item_id, depends_on_item_id)
                            .await
                            .map_err(|e| format!("Failed to insert dependency: {e}"))?;
                    }
                }
            }
        }

        // 8. Append built-in review item (depends on all phase items)
        let max_order = sorted.len() as i64;
        let max_group = sorted.iter().map(|&(_, g)| g).max().unwrap_or(0) as i64 + 1;
        let all_queue_ids: Vec<i64> = phase_to_queue_item.values().copied().collect();

        let review_id = repository::insert_queue_item(
            write_pool,
            feature_id,
            workflow_type_str,
            "review",
            None,
            "blocked",
            max_order,
            Some(max_group),
        )
        .await
        .map_err(|e| format!("Failed to insert review item: {e}"))?;

        for &dep_id in &all_queue_ids {
            repository::insert_dependency(write_pool, review_id, dep_id)
                .await
                .map_err(|e| format!("Failed to insert review dependency: {e}"))?;
        }

        // 9. Return the full queue
        let items = repository::get_queue_for_feature(read_pool, feature_id)
            .await
            .map_err(|e| format!("Failed to read queue: {e}"))?;

        Ok(items)
    }

    fn agent_type_for_item(&self, item_type: &str) -> Result<AgentType, String> {
        match item_type {
            "execute" => Ok(AgentType::Execute),
            "qa" => Ok(AgentType::Qa),
            "review" => Ok(AgentType::Review),
            "risk" => Ok(AgentType::Risk),
            "retro" => Ok(AgentType::Retro),
            other => Err(format!("Unknown item type for FeatureBuild: {other}")),
        }
    }

    async fn build_system_prompt(
        &self,
        read_pool: &SqlitePool,
        item: &QueueItem,
    ) -> Result<String, String> {
        match item.item_type.as_str() {
            "execute" | "qa" => {
                let phase = self.read_phase(read_pool, item.phase_id).await?;
                let autonomy_auto = true; // workflow queue always runs in auto mode
                if item.item_type == "execute" {
                    Ok(build_execute_prompt(
                        &phase.title,
                        phase.prompt.as_deref().unwrap_or(""),
                        phase.commit_message.as_deref().unwrap_or(""),
                        autonomy_auto,
                    ))
                } else {
                    Ok(build_qa_prompt(
                        &phase.title,
                        phase.prompt.as_deref().unwrap_or(""),
                        autonomy_auto,
                    ))
                }
            }
            "review" => Ok(Prompts::review().to_string()),
            other => Err(format!("Unknown item type for system prompt: {other}")),
        }
    }

    async fn build_initial_prompt(
        &self,
        read_pool: &SqlitePool,
        item: &QueueItem,
        feature_title: &str,
    ) -> Result<String, String> {
        match item.item_type.as_str() {
            "execute" | "qa" => {
                let phase = self.read_phase(read_pool, item.phase_id).await?;
                Ok(phase.prompt.unwrap_or_else(|| phase.title))
            }
            "review" => Ok(format!("Review all changes for feature {feature_title}")),
            other => Err(format!("Unknown item type for initial prompt: {other}")),
        }
    }
}

impl FeatureBuildStrategy {
    async fn read_phase(&self, read_pool: &SqlitePool, phase_id: Option<i64>) -> Result<Phase, String> {
        let phase_id = phase_id.ok_or("Queue item requires a phase_id but none was set")?;
        sqlx::query_as::<_, Phase>("SELECT * FROM phases WHERE id = ?")
            .bind(phase_id)
            .fetch_optional(read_pool)
            .await
            .map_err(|e| format!("Failed to read phase: {e}"))?
            .ok_or_else(|| format!("Phase {phase_id} not found"))
    }
}

fn map_phase_type_to_item_type(phase_type: Option<&str>) -> &'static str {
    match phase_type {
        Some("setup") | Some("value") => "execute",
        Some("qa") => "qa",
        _ => "execute", // default to execute
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_phase_type_mapping() {
        assert_eq!(map_phase_type_to_item_type(Some("setup")), "execute");
        assert_eq!(map_phase_type_to_item_type(Some("value")), "execute");
        assert_eq!(map_phase_type_to_item_type(Some("qa")), "qa");
        assert_eq!(map_phase_type_to_item_type(None), "execute");
        assert_eq!(map_phase_type_to_item_type(Some("unknown")), "execute");
    }

    #[test]
    fn test_agent_type_mapping() {
        let strategy = FeatureBuildStrategy;
        assert!(matches!(strategy.agent_type_for_item("execute"), Ok(AgentType::Execute)));
        assert!(matches!(strategy.agent_type_for_item("qa"), Ok(AgentType::Qa)));
        assert!(matches!(strategy.agent_type_for_item("review"), Ok(AgentType::Review)));
        assert!(matches!(strategy.agent_type_for_item("risk"), Ok(AgentType::Risk)));
        assert!(matches!(strategy.agent_type_for_item("retro"), Ok(AgentType::Retro)));
        assert!(strategy.agent_type_for_item("unknown").is_err());
    }
}

use std::collections::HashMap;

use async_trait::async_trait;
use serde_json::json;
use sqlx::SqlitePool;

use crate::domain::features::models::{QueueItem, WorkflowType};
use crate::domain::features::repository;
use crate::domain::mcp::servers::AgentType;
use crate::domain::ws_workflow::{service as ws_service, template_engine};
use crate::domain::workflow::prompts::build_execute_prompt;

use super::WorkflowStrategy;

#[allow(dead_code)]
pub struct CustomWorkflowStrategy {
    pub workflow_definition_id: i64,
}

#[async_trait]
impl WorkflowStrategy for CustomWorkflowStrategy {
    fn workflow_type(&self) -> WorkflowType {
        WorkflowType::Custom
    }

    async fn populate_queue(
        &self,
        write_pool: &SqlitePool,
        read_pool: &SqlitePool,
        feature_id: i64,
        _plan_id: Option<i64>,
    ) -> Result<Vec<QueueItem>, String> {
        // Clear existing queue
        repository::clear_queue_for_feature(write_pool, feature_id)
            .await
            .map_err(|e| e.to_string())?;

        // Load workflow definition with phases
        let definition = ws_service::get_definition(read_pool, self.workflow_definition_id)
            .await
            .map_err(|e| e.to_string())?;

        // Insert queue items for each phase, tracking slug -> queue_item_id
        let mut slug_to_id: HashMap<String, i64> = HashMap::new();

        for phase in &definition.phases {
            let status = if phase.input_phase_slugs.is_empty() {
                "ready"
            } else {
                "blocked"
            };

            let agent_type = phase.agent_type.as_str();

            let mut config = json!({
                "agent_type": agent_type,
                "gate_type": phase.gate_type,
                "system_prompt_template": phase.system_prompt_template,
                "command_prompt_template": phase.command_prompt_template,
                "artifact_template": phase.artifact_template,
                "input_phase_slugs": phase.input_phase_slugs,
                "model_override": phase.model_override,
            });

            if !phase.decompose_from.is_empty() {
                config["decompose_from"] = json!(phase.decompose_from);
            }

            let item_id = repository::insert_queue_item_with_config(
                write_pool,
                feature_id,
                "custom",
                &phase.slug,
                status,
                phase.order_index as i64,
                Some(phase.order_index as i64),
                Some(&config.to_string()),
            )
            .await
            .map_err(|e| e.to_string())?;

            slug_to_id.insert(phase.slug.clone(), item_id);
        }

        // Create dependency edges
        for phase in &definition.phases {
            if let Some(&item_id) = slug_to_id.get(&phase.slug) {
                for dep_slug in &phase.input_phase_slugs {
                    if let Some(&dep_id) = slug_to_id.get(dep_slug) {
                        repository::insert_dependency(write_pool, item_id, dep_id)
                            .await
                            .map_err(|e| e.to_string())?;
                    }
                }
            }
        }

        // Return all queue items
        repository::get_queue_for_feature(read_pool, feature_id)
            .await
            .map_err(|e| e.to_string())
    }

    fn agent_type_for_item(&self, _item_type: &str, config: Option<&str>) -> Result<AgentType, String> {
        // Read agent_type from config JSON if available
        if let Some(cfg) = config {
            if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(cfg) {
                if let Some(at) = parsed.get("agent_type").and_then(|v| v.as_str()) {
                    return match at {
                        "execute" => Ok(AgentType::Execute),
                        _ => Ok(AgentType::Workflow),
                    };
                }
            }
        }

        Ok(AgentType::Workflow)
    }

    async fn build_system_prompt(
        &self,
        read_pool: &SqlitePool,
        item: &QueueItem,
        _autonomy_level: u8,
    ) -> Result<String, String> {
        // Decomposed task items have item_type like "implement:001"
        if is_decomposed_item(item) {
            return Ok(String::new()); // Execute agents use the default system prompt
        }

        let (phase, definition) = load_phase_from_item(read_pool, item, self.workflow_definition_id).await?;
        let ctx = template_engine::build_template_context(
            read_pool,
            item.feature_id,
            &phase,
            &definition,
        )
        .await
        .map_err(|e| e.to_string())?;

        Ok(template_engine::interpolate(&phase.system_prompt_template, &ctx))
    }

    async fn build_initial_prompt(
        &self,
        read_pool: &SqlitePool,
        item: &QueueItem,
        _feature_title: &str,
        autonomy_level: u8,
    ) -> Result<String, String> {
        // Decomposed task items: build execute prompt from phase row
        if is_decomposed_item(item) {
            return build_decomposed_prompt(read_pool, item, autonomy_level).await;
        }

        let (phase, definition) = load_phase_from_item(read_pool, item, self.workflow_definition_id).await?;
        let ctx = template_engine::build_template_context(
            read_pool,
            item.feature_id,
            &phase,
            &definition,
        )
        .await
        .map_err(|e| e.to_string())?;

        let mut prompt = template_engine::interpolate(&phase.command_prompt_template, &ctx);

        if !phase.artifact_template.is_empty() {
            let interpolated = template_engine::interpolate(&phase.artifact_template, &ctx);
            // Strip HTML comment placeholders — they're authoring hints, not prompt content
            let cleaned = interpolated
                .lines()
                .filter(|line| {
                    let t = line.trim();
                    !(t.starts_with("<!--") && t.ends_with("-->"))
                })
                .fold(String::new(), |mut acc, line| {
                    if !acc.is_empty() { acc.push('\n'); }
                    acc.push_str(line);
                    acc
                });
            let cleaned = cleaned.trim();
            if !cleaned.is_empty() {
                prompt.push_str("\n\n## Expected Output Format\n\n");
                prompt.push_str(cleaned);
            }
        }

        Ok(prompt)
    }
}

fn is_decomposed_item(item: &QueueItem) -> bool {
    item.config
        .as_deref()
        .and_then(|s| serde_json::from_str::<serde_json::Value>(s).ok())
        .and_then(|c| c.get("decomposed")?.as_bool())
        .unwrap_or(false)
}

async fn build_decomposed_prompt(
    read_pool: &SqlitePool,
    item: &QueueItem,
    autonomy_level: u8,
) -> Result<String, String> {
    // Load the synthetic phase linked via phase_id
    let phase_id = item.phase_id.ok_or("Decomposed item missing phase_id")?;
    let phase = sqlx::query_as::<_, (String, Option<String>, Option<String>)>(
        "SELECT title, prompt, commit_message FROM phases WHERE id = ?",
    )
    .bind(phase_id)
    .fetch_optional(read_pool)
    .await
    .map_err(|e| e.to_string())?
    .ok_or_else(|| format!("Phase {phase_id} not found for decomposed item"))?;

    Ok(build_execute_prompt(
        &phase.0,
        phase.1.as_deref().unwrap_or(""),
        phase.2.as_deref().unwrap_or(""),
        autonomy_level,
    ))
}

/// Load the WorkflowPhase matching item.item_type (slug) from the definition.
#[allow(dead_code)]
async fn load_phase_from_item(
    read_pool: &SqlitePool,
    item: &QueueItem,
    workflow_definition_id: i64,
) -> Result<(crate::domain::ws_workflow::models::WorkflowPhase, crate::domain::ws_workflow::models::WorkflowDefinition), String> {
    let definition = ws_service::get_definition(read_pool, workflow_definition_id)
        .await
        .map_err(|e| e.to_string())?;

    let phase = definition
        .phases
        .iter()
        .find(|p| p.slug == item.item_type)
        .ok_or_else(|| format!("Phase with slug '{}' not found in definition", item.item_type))?
        .clone();

    Ok((phase, definition))
}

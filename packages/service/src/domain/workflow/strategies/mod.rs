pub mod feature_build;

use async_trait::async_trait;
use sqlx::SqlitePool;

use crate::domain::features::models::{QueueItem, WorkflowType};
use crate::domain::mcp::servers::AgentType;

use self::feature_build::FeatureBuildStrategy;

/// Each workflow type implements this trait to define how its queue is populated
/// and what item types are valid.
#[async_trait]
pub trait WorkflowStrategy: Send + Sync {
    /// The workflow type identifier (matches DB column)
    fn workflow_type(&self) -> WorkflowType;

    /// Populate the queue for this workflow. Called after plan finalization.
    async fn populate_queue(
        &self,
        write_pool: &SqlitePool,
        read_pool: &SqlitePool,
        feature_id: i64,
        plan_id: Option<i64>,
    ) -> Result<Vec<QueueItem>, String>;

    /// Map an item_type to the AgentType that should execute it.
    fn agent_type_for_item(&self, item_type: &str) -> Result<AgentType, String>;

    /// Build the system prompt for an item.
    async fn build_system_prompt(
        &self,
        _read_pool: &SqlitePool,
        _item: &QueueItem,
    ) -> Result<String, String> {
        Ok(String::new())
    }

    /// Build the initial user prompt for an item.
    async fn build_initial_prompt(
        &self,
        _read_pool: &SqlitePool,
        _item: &QueueItem,
        _feature_title: &str,
    ) -> Result<String, String> {
        Ok(String::new())
    }
}

/// Registry of available workflow strategies
pub fn get_strategy(workflow_type: &WorkflowType) -> Result<Box<dyn WorkflowStrategy>, String> {
    match workflow_type {
        WorkflowType::FeatureBuild => Ok(Box::new(FeatureBuildStrategy)),
        other => Err(format!("Workflow type {:?} not yet implemented", other)),
    }
}

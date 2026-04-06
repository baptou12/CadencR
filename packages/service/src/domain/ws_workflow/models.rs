use serde::{Deserialize, Serialize};
use std::fmt;
use std::str::FromStr;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowDefinition {
    pub id: i64,
    pub name: String,
    pub slug: String,
    pub description: Option<String>,
    pub is_preset: bool,
    pub phases: Vec<WorkflowPhase>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct WorkflowPhase {
    pub id: i64,
    pub workflow_definition_id: i64,
    pub name: String,
    pub slug: String,
    pub order_index: i32,
    pub gate_type: String,
    pub system_prompt_template: String,
    pub command_prompt_template: String,
    pub artifact_template: String,
    #[sqlx(default)]
    #[serde(default)]
    pub input_phase_slugs: Vec<String>,
    pub model_override: String,
    pub agent_type: String,
    #[sqlx(default)]
    #[serde(default)]
    pub decompose_from: String,
    #[sqlx(default)]
    #[serde(default)]
    pub artifact_types: Vec<String>,
    #[sqlx(default)]
    #[serde(default = "default_max_iterations")]
    pub max_iterations: i32,
}

pub(crate) fn default_max_iterations() -> i32 {
    1
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowTask {
    pub id: i64,
    pub feature_id: i64,
    pub source_phase_slug: String,
    pub title: String,
    pub description: String,
    pub commit_message: String,
    pub order_index: i32,
    pub parallel_group: i32,
    pub depends_on: Vec<String>,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum GateType {
    Auto,
    Approval,
    Manual,
    Iterate,
}

impl fmt::Display for GateType {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            GateType::Auto => write!(f, "auto"),
            GateType::Approval => write!(f, "approval"),
            GateType::Manual => write!(f, "manual"),
            GateType::Iterate => write!(f, "iterate"),
        }
    }
}

impl FromStr for GateType {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.to_lowercase().as_str() {
            "auto" => Ok(GateType::Auto),
            "approval" => Ok(GateType::Approval),
            "manual" => Ok(GateType::Manual),
            "iterate" => Ok(GateType::Iterate),
            _ => Err(format!("Invalid gate type: {}", s)),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct WorkflowArtifact {
    pub id: i64,
    pub feature_id: i64,
    pub phase_slug: String,
    #[sqlx(default)]
    #[serde(default = "default_artifact_type")]
    pub artifact_type: String,
    pub content: String,
    pub agent_session_id: Option<i64>,
    pub created_at: String,
    pub updated_at: String,
}

pub const DEFAULT_ARTIFACT_TYPE: &str = "default";

fn default_artifact_type() -> String {
    DEFAULT_ARTIFACT_TYPE.to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateWorkflowDefinition {
    pub name: String,
    pub slug: String,
    pub description: Option<String>,
    pub is_preset: bool,
    pub phases: Vec<CreateWorkflowPhase>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateWorkflowPhase {
    pub name: String,
    pub slug: String,
    pub order_index: i32,
    pub gate_type: GateType,
    pub system_prompt_template: String,
    pub command_prompt_template: String,
    pub artifact_template: String,
    pub input_phase_slugs: Vec<String>,
    pub model_override: String,
    pub agent_type: String,
    #[serde(default)]
    pub decompose_from: String,
    #[serde(default)]
    pub artifact_types: Vec<String>,
    #[serde(default = "default_max_iterations")]
    pub max_iterations: i32,
}

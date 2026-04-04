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
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum GateType {
    Auto,
    Approval,
    Manual,
}

impl fmt::Display for GateType {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            GateType::Auto => write!(f, "auto"),
            GateType::Approval => write!(f, "approval"),
            GateType::Manual => write!(f, "manual"),
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
            _ => Err(format!("Invalid gate type: {}", s)),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct WorkflowArtifact {
    pub id: i64,
    pub feature_id: i64,
    pub phase_slug: String,
    pub content: String,
    pub agent_session_id: Option<i64>,
    pub created_at: String,
    pub updated_at: String,
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
}

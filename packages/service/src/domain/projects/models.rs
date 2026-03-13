use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(Debug, Serialize, ToSchema)]
pub struct Project {
    pub id: i64,
    pub name: String,
    pub path: String,
    pub branch_prefix: Option<String>,
    pub qa_prompt: Option<String>,
    pub agent_autonomy: Option<String>,
    pub parallel_execution: Option<i64>,
    pub created_at: String,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct CreateProjectRequest {
    pub name: String,
    pub path: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct ProjectSetting {
    pub key: String,
    pub value: Option<String>,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct SetProjectSettingRequest {
    pub key: String,
    pub value: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct ProjectModelSettings {
    pub plan: String,
    pub prd: String,
    pub execute: String,
    pub risk: String,
    pub review: String,
    #[serde(rename = "review-fixer")]
    pub review_fixer: String,
    pub session: String,
    pub qa: String,
    pub retro: String,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct SetProjectModelSettingRequest {
    pub model_type: String,
    pub model: String,
}

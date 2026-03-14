use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(Debug, Serialize, sqlx::FromRow, ToSchema)]
pub struct Feature {
    pub id: i64,
    pub project_id: i64,
    pub title: String,
    #[serde(rename = "type")]
    pub type_: String,
    pub status: String,
    pub prd: Option<String>,
    pub workflow_step: Option<String>,
    pub workflow_config: Option<String>,
    pub model_plan: Option<String>,
    pub model_prd: Option<String>,
    pub model_execute: Option<String>,
    pub model_risk: Option<String>,
    pub model_review: Option<String>,
    #[serde(rename = "model_review-fixer")]
    pub model_review_fixer: Option<String>,
    pub model_session: Option<String>,
    pub model_qa: Option<String>,
    pub model_retro: Option<String>,
    pub agent_autonomy: Option<String>,
    pub parallel_execution: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct CreateFeatureRequest {
    pub project_id: i64,
    pub title: Option<String>,
    #[serde(rename = "type")]
    pub type_: Option<String>,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct UpdateStatusRequest {
    pub status: String,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct UpdateTitleRequest {
    pub title: String,
}

#[derive(Debug, Serialize, sqlx::FromRow, ToSchema)]
pub struct Plan {
    pub id: i64,
    pub feature_id: i64,
    pub title: Option<String>,
    pub status: Option<String>,
    pub summary: Option<String>,
    pub context: Option<String>,
    pub clarifications: Option<String>,
    pub completion_conditions: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Serialize, sqlx::FromRow, ToSchema)]
pub struct Phase {
    pub id: i64,
    pub plan_id: i64,
    pub step_number: i64,
    pub title: String,
    pub status: String,
    pub complexity: Option<i64>,
    pub commit_message: Option<String>,
    pub prompt: Option<String>,
    pub phase_type: Option<String>,
    pub implementation_notes: Option<String>,
    pub deviations: Option<String>,
    pub order_index: Option<i64>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct PlanWithPhases {
    #[serde(flatten)]
    pub plan: Plan,
    pub phases: Vec<Phase>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct PlanProgress {
    pub total: i64,
    pub done: i64,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct PrdResponse {
    pub prd: Option<String>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct IsEmptyResponse {
    pub empty: bool,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct WorkingDirResponse {
    pub path: Option<String>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct CreateFeatureResponse {
    pub id: i64,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct FeatureSetting {
    pub key: String,
    pub value: String,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct SetFeatureSettingRequest {
    pub key: String,
    pub value: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct FeatureModelSettings {
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
pub struct SetFeatureModelSettingRequest {
    pub model_type: String,
    pub model: String,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct ResetPhaseRequest {}

#[derive(Debug, Deserialize, ToSchema)]
pub struct OverridePhaseStatusRequest {
    pub status: String,
}

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(Debug, Serialize, ToSchema)]
pub struct Setting {
    pub key: String,
    pub value: Option<String>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct ModelSettings {
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
pub struct SetSettingRequest {
    pub value: String,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct SetModelSettingRequest {
    pub agent_type: String,
    pub model_id: String,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct AddPromptEntryRequest {
    pub project_id: i64,
    pub content: String,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct GetPromptHistoryParams {
    pub project_id: i64,
}

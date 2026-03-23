use serde::Serialize;
use utoipa::ToSchema;

#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct UsageBucket {
    pub utilization: f64,
    pub resets_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
#[allow(dead_code)]
pub enum UsageStatus {
    Success,
    Cached,
    RateLimited,
    Error,
}

#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct UsageResponse {
    pub five_hour: Option<UsageBucket>,
    pub seven_day: Option<UsageBucket>,
    pub seven_day_sonnet: Option<UsageBucket>,
    pub status: UsageStatus,
    pub status_message: Option<String>,
    pub retry_at: Option<u64>,
    pub updated_at: u64,
}

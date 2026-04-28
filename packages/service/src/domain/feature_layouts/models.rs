use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

/// A user-saved feature-page layout (tab grid configuration).
///
/// `config` is an opaque JSON blob owned by the frontend (validated there via
/// Zod). The backend never reads its shape — keeping the schema in one place
/// avoids drift when we add new tab kinds or split modes.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema, sqlx::FromRow)]
pub struct FeatureLayout {
    pub id: i64,
    pub name: String,
    pub config: String,
    pub is_default: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct CreateFeatureLayoutRequest {
    pub name: String,
    /// JSON-serialized layout. Frontend owns the schema; backend only checks
    /// it parses as JSON to fail fast on obviously bad payloads.
    pub config: String,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct UpdateFeatureLayoutRequest {
    pub name: Option<String>,
    pub config: Option<String>,
}

#[derive(Debug, Serialize, ToSchema)]
#[schema(as = FeatureLayoutsSuccessResponse)]
pub struct SuccessResponse {
    pub success: bool,
}

//! Signed tab revisions live separately from editable author folders.
pub mod routes;
mod service;
pub mod storage;

use crate::domain::themes::managed::models::SignedMixedCatalog;
use crate::error::AppError;
use axum::http::StatusCode;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct InstallManagedTabRequest {
    pub index: SignedMixedCatalog,
    pub tab_id: String,
    pub version: String,
}
#[derive(Debug, Serialize, ToSchema)]
pub struct ManagedTabInventoryEntry {
    pub id: String,
    pub name: String,
    pub version: String,
    pub error: Option<String>,
}

pub fn invalid(message: impl std::fmt::Display) -> AppError {
    AppError::coded(
        StatusCode::BAD_REQUEST,
        "MANAGED_TAB_INVALID",
        message.to_string(),
    )
}

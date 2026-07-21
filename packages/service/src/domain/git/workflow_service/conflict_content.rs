use std::path::PathBuf;

use crate::app_state::AppState;
use crate::domain::git::commands;
use crate::domain::git::models::{ConflictContentResponse, GetConflictContentParams};
use crate::domain::git::service::resolve_feature_git_path;
use crate::error::AppError;

use super::validate_file_mutation_path;

pub async fn get_conflict_content(
    state: &AppState,
    params: GetConflictContentParams,
) -> Result<ConflictContentResponse, AppError> {
    validate_file_mutation_path(&params.file_path)?;
    let git_path = resolve_feature_git_path(state, params.feature_id)
        .await?
        .ok_or_else(|| {
            AppError::NotFound(format!("feature {} has no git path", params.feature_id))
        })?;
    commands::get_conflict_content(&PathBuf::from(git_path), &params.file_path).await
}

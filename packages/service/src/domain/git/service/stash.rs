//! Service layer for the Git-tab Stashes view. Resolves the feature's git
//! directory, then delegates to the `git stash list` command orchestration.

use std::path::Path;

use crate::app_state::AppState;
use crate::domain::git::commands;
use crate::domain::git::models::{ListStashesParams, StashEntry};
use crate::error::AppError;

use super::resolve_feature_git_path;

pub async fn list_stashes(
    state: &AppState,
    params: ListStashesParams,
) -> Result<Vec<StashEntry>, AppError> {
    let git_path = match resolve_feature_git_path(state, params.feature_id).await? {
        Some(p) => p,
        None => return Ok(vec![]),
    };
    commands::list_stashes(Path::new(&git_path)).await
}

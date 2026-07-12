use std::path::Path;

use crate::app_state::AppState;
use crate::domain::git::commands;
use crate::domain::git::models::{DiffImageSide, GetDiffImageParams};
use crate::error::AppError;
use crate::shared::image_file::{image_mime_for_path, MAX_IMAGE_FILE_SIZE};

use super::diff::resolve_diff_refs;
use super::resolve_feature_git_path;

pub struct DiffImage {
    pub bytes: Vec<u8>,
    pub mime: &'static str,
}

fn image_source<'a>(
    params: &'a GetDiffImageParams,
    old_ref: &'a str,
    new_ref: Option<&'a str>,
) -> (&'a str, Option<&'a str>) {
    match params.side {
        DiffImageSide::Old => (
            params.old_file_path.as_deref().unwrap_or(&params.file_path),
            Some(old_ref),
        ),
        DiffImageSide::New => (params.file_path.as_str(), new_ref),
    }
}

/// Return one exact image side from the same ref pair used by the text diff.
pub async fn get_diff_image(
    state: &AppState,
    params: GetDiffImageParams,
) -> Result<DiffImage, AppError> {
    let git_path = resolve_feature_git_path(state, params.feature_id)
        .await?
        .ok_or_else(|| AppError::NotFound("Feature worktree not found".into()))?;
    let root = Path::new(&git_path);
    let (old_ref, new_ref) = resolve_diff_refs(
        state,
        params.feature_id,
        &params.mode,
        params.target_branch.as_deref(),
        params.commit_sha.as_deref(),
        root,
    )
    .await?;

    let (file_path, reference) = image_source(&params, &old_ref, new_ref.as_deref());
    let mime = image_mime_for_path(Path::new(file_path))
        .ok_or_else(|| AppError::BadRequest("Unsupported image extension".into()))?;
    let bytes = commands::get_file_bytes(root, file_path, reference, MAX_IMAGE_FILE_SIZE).await?;

    Ok(DiffImage { bytes, mime })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn params(side: DiffImageSide) -> GetDiffImageParams {
        GetDiffImageParams {
            feature_id: 1,
            file_path: "new/name.png".into(),
            old_file_path: Some("old/name.png".into()),
            side,
            mode: "uncommitted".into(),
            commit_sha: None,
            target_branch: None,
        }
    }

    #[test]
    fn old_side_uses_rename_source_and_base_ref() {
        assert_eq!(
            image_source(&params(DiffImageSide::Old), "base", Some("head")),
            ("old/name.png", Some("base"))
        );
    }

    #[test]
    fn new_side_uses_destination_and_comparison_ref() {
        assert_eq!(
            image_source(&params(DiffImageSide::New), "base", Some("head")),
            ("new/name.png", Some("head"))
        );
    }
}

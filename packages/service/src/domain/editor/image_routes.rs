//! `GET /api/editor/read-image` — streams raw image bytes for the
//! in-editor `ImageFileViewer`. Distinct from `read_file_handler`
//! because that endpoint rejects binary files; this one is gated by an
//! explicit image-extension allowlist and a larger (25 MB) size limit.
//!
//! Extracted into its own module so `routes.rs` stays manageable.

use axum::extract::{Query, State};
use axum::response::Response;
use axum::routing::get;
use axum::Router;

use super::routes::ReadFileParams;
use super::service;
use crate::app_state::AppState;
use crate::domain::projects::service::resolve_feature_editor_root;
use crate::error::AppError;
use crate::shared::image_file::{image_mime_for_path, image_response, MAX_IMAGE_FILE_SIZE};

#[utoipa::path(
    get,
    path = "/api/editor/read-image",
    params(ReadFileParams),
    responses(
        (status = 200, description = "Raw image bytes", content_type = "image/*"),
        (status = 400, description = "Unsupported extension or file too large"),
        (status = 404, description = "File not found"),
    )
)]
pub async fn read_image_handler(
    State(state): State<AppState>,
    Query(params): Query<ReadFileParams>,
) -> Result<Response, AppError> {
    let project_root =
        resolve_feature_editor_root(&state.read_pool, params.project_id, params.feature_id).await?;
    let path = service::validate_path(&project_root, &params.file_path)?;

    let mime = image_mime_for_path(&path)
        .ok_or_else(|| AppError::BadRequest("Unsupported image extension".into()))?;

    let bytes = tokio::task::spawn_blocking(move || -> Result<Vec<u8>, AppError> {
        use std::io::Read;

        let mut file = std::fs::File::open(&path).map_err(|e| match e.kind() {
            std::io::ErrorKind::NotFound => {
                AppError::NotFound(format!("File not found: {}", path.display()))
            }
            std::io::ErrorKind::PermissionDenied => {
                AppError::BadRequest(format!("Permission denied: {}", path.display()))
            }
            _ => AppError::Internal(e.to_string()),
        })?;
        let len = file
            .metadata()
            .map_err(|e| AppError::Internal(e.to_string()))?
            .len();
        if len > MAX_IMAGE_FILE_SIZE as u64 {
            return Err(AppError::BadRequest(format!(
                "Image exceeds {} MB size limit",
                MAX_IMAGE_FILE_SIZE / (1024 * 1024)
            )));
        }
        // Pre-size the buffer: `read_to_end` would otherwise grow it
        // through ~18 reallocations for a 25 MB file.
        let mut buf = Vec::with_capacity(len as usize);
        file.read_to_end(&mut buf)
            .map_err(|e| AppError::Internal(e.to_string()))?;
        Ok(buf)
    })
    .await
    .map_err(|e| AppError::Internal(format!("Blocking task failed: {e}")))??;

    image_response(bytes, mime)
}

pub fn image_router() -> Router<AppState> {
    Router::new().route("/api/editor/read-image", get(read_image_handler))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn size_limit_is_25_mb() {
        assert_eq!(MAX_IMAGE_FILE_SIZE, 25 * 1024 * 1024);
    }
}

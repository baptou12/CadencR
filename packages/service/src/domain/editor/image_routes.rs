//! `GET /api/editor/read-image` — streams raw image bytes for the
//! in-editor `ImageFileViewer`. Distinct from `read_file_handler`
//! because that endpoint rejects binary files; this one is gated by an
//! explicit image-extension allowlist and a larger (25 MB) size limit.
//!
//! Extracted into its own module so `routes.rs` stays manageable.

use axum::extract::{Query, State};
use axum::http::{header, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::Router;

use super::routes::ReadFileParams;
use super::service;
use crate::app_state::AppState;
use crate::domain::projects::service::resolve_feature_editor_root;
use crate::error::AppError;

const MAX_IMAGE_FILE_SIZE: u64 = 25 * 1024 * 1024;

/// Return the MIME type for a supported image extension, or `None` if
/// the file isn't on our allowlist. The frontend's `isImageFile` must
/// stay in sync with this list — keep both in lockstep.
fn image_mime_for_extension(ext: &str) -> Option<&'static str> {
    match ext {
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "gif" => Some("image/gif"),
        "webp" => Some("image/webp"),
        "bmp" => Some("image/bmp"),
        "ico" => Some("image/x-icon"),
        "avif" => Some("image/avif"),
        _ => None,
    }
}

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

    let ext = path
        .extension()
        .and_then(|s| s.to_str())
        .map(|s| s.to_ascii_lowercase())
        .unwrap_or_default();
    let mime = image_mime_for_extension(&ext)
        .ok_or_else(|| AppError::BadRequest(format!("Unsupported image extension: .{ext}")))?;

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
        if len > MAX_IMAGE_FILE_SIZE {
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

    let len = bytes.len();
    let response = Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, mime)
        .header(header::CONTENT_LENGTH, len)
        // Bust caches when the file changes — the path is stable but the
        // bytes change on overwrite; without `no-cache` the browser would
        // hand back a stale image after the user edits a screenshot.
        .header(header::CACHE_CONTROL, "no-cache")
        .body(axum::body::Body::from(bytes))
        .map_err(|e| AppError::Internal(format!("Failed to build response: {e}")))?;

    Ok(response.into_response())
}

pub fn image_router() -> Router<AppState> {
    Router::new().route("/api/editor/read-image", get(read_image_handler))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allowlist_recognizes_common_image_extensions() {
        assert_eq!(image_mime_for_extension("png"), Some("image/png"));
        assert_eq!(image_mime_for_extension("jpg"), Some("image/jpeg"));
        assert_eq!(image_mime_for_extension("jpeg"), Some("image/jpeg"));
        assert_eq!(image_mime_for_extension("gif"), Some("image/gif"));
        assert_eq!(image_mime_for_extension("webp"), Some("image/webp"));
        assert_eq!(image_mime_for_extension("bmp"), Some("image/bmp"));
        assert_eq!(image_mime_for_extension("ico"), Some("image/x-icon"));
        assert_eq!(image_mime_for_extension("avif"), Some("image/avif"));
    }

    #[test]
    fn allowlist_rejects_non_image_extensions() {
        // SVG is rendered inline in the editor, not via this endpoint.
        assert_eq!(image_mime_for_extension("svg"), None);
        assert_eq!(image_mime_for_extension("txt"), None);
        assert_eq!(image_mime_for_extension("zip"), None);
        assert_eq!(image_mime_for_extension("pdf"), None);
        assert_eq!(image_mime_for_extension(""), None);
    }

    #[test]
    fn size_limit_is_25_mb() {
        assert_eq!(MAX_IMAGE_FILE_SIZE, 25 * 1024 * 1024);
    }
}

//! `GET /api/blobs/{hash}` — serves an off-loaded payload's raw bytes.
//!
//! Deliberately outside the OpenAPI surface, matching `get_diff_image_handler`:
//! the generated client models JSON, and this returns opaque binary that the
//! frontend turns into an object URL. The renderer's CSP (`img-src 'self' data:
//! blob:`) is why the bytes must come back over the API instead of the message
//! linking a file path directly.

use axum::extract::Path;
use axum::response::Response;
use axum::routing::get;
use axum::Router;

use super::{sniff_media_type, store};
use crate::app_state::AppState;
use crate::error::AppError;
use crate::shared::image_file::image_response;

/// Blobs are content-addressed, so a hash's bytes can never change. Cache hard:
/// re-fetching a screenshot the user already scrolled past is pure waste, and
/// this route is hit once per image per stream render.
// These bytes come from authenticated conversations. `public` would explicitly
// authorize a shared proxy to retain them, so keep the immutable cache private
// to the authenticated browser profile.
const IMMUTABLE_CACHE: &str = "private, max-age=31536000, immutable";

pub async fn get_blob_handler(Path(hash): Path<String>) -> Result<Response, AppError> {
    // `store::get` rejects anything that isn't a 64-char lowercase hex hash,
    // which is what keeps `..` and absolute paths out of the filesystem read.
    let bytes = store::get_async(&hash).await?;
    let media_type = sniff_media_type(&bytes);
    let mut response = image_response(bytes, media_type)?;
    response.headers_mut().insert(
        axum::http::header::CACHE_CONTROL,
        axum::http::HeaderValue::from_static(IMMUTABLE_CACHE),
    );
    Ok(response)
}

pub fn routes() -> Router<AppState> {
    Router::new().route("/api/blobs/{hash}", get(get_blob_handler))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn serves_stored_bytes_with_a_sniffed_content_type() {
        let mut png = vec![0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A];
        png.extend([0u8; 64]);
        let hash = store::put(&png).unwrap();

        let response = get_blob_handler(Path(hash)).await.expect("blob is served");

        assert_eq!(response.status(), 200);
        assert_eq!(response.headers().get("content-type").unwrap(), "image/png");
        assert_eq!(
            response.headers().get("cache-control").unwrap(),
            IMMUTABLE_CACHE
        );
    }

    #[tokio::test]
    async fn missing_and_traversing_hashes_are_not_found() {
        for hash in [
            "0".repeat(64),
            "../../etc/passwd".to_string(),
            String::new(),
        ] {
            assert!(
                matches!(
                    get_blob_handler(Path(hash.clone())).await,
                    Err(AppError::NotFound(_))
                ),
                "{hash:?} must be rejected"
            );
        }
    }
}

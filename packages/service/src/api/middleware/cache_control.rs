//! Cache-Control for the remote (network) SPA listener.
//!
//! An installed iOS standalone PWA has no reload button or pull-to-refresh, so a
//! stale cached `index.html` keeps pointing at old hashed bundles and the user is
//! stuck on old code. We make the entry document always revalidate while letting
//! the content-hashed assets cache forever:
//!
//! - `/assets/*` (Vite's content-hashed output) → `immutable`, cached for a year.
//! - everything else served here (`index.html` fallback, `manifest.webmanifest`,
//!   icons, API JSON) → `no-cache`, so a reload/relaunch always revalidates.
//!
//! Only set when the handler didn't already pick a policy (e.g. `image_routes`
//! sets its own), and only on the remote listener — the loopback `file://`
//! renderer never hits this layer.

use axum::extract::Request;
use axum::http::{header, HeaderValue};
use axum::middleware::Next;
use axum::response::Response;

const IMMUTABLE: &str = "public, max-age=31536000, immutable";
const REVALIDATE: &str = "no-cache";

pub async fn cache_control_middleware(request: Request, next: Next) -> Response {
    let immutable = request.uri().path().starts_with("/assets/");
    let mut response = next.run(request).await;
    let headers = response.headers_mut();
    if !headers.contains_key(header::CACHE_CONTROL) {
        let value = if immutable { IMMUTABLE } else { REVALIDATE };
        headers.insert(header::CACHE_CONTROL, HeaderValue::from_static(value));
    }
    response
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::Body;
    use axum::http::{Request as HttpRequest, StatusCode};
    use axum::routing::get;
    use axum::Router;
    use tower::ServiceExt;

    fn app() -> Router {
        Router::new()
            .route("/assets/index-abc123.js", get(|| async { "js" }))
            .route("/", get(|| async { "html" }))
            .route(
                "/already-set",
                get(|| async { ([(header::CACHE_CONTROL, "max-age=60")], "preset") }),
            )
            .layer(axum::middleware::from_fn(cache_control_middleware))
    }

    async fn cache_header(uri: &str) -> Option<String> {
        let resp = app()
            .oneshot(HttpRequest::builder().uri(uri).body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
        resp.headers()
            .get(header::CACHE_CONTROL)
            .map(|v| v.to_str().unwrap().to_string())
    }

    #[tokio::test]
    async fn hashed_assets_are_immutable() {
        assert_eq!(
            cache_header("/assets/index-abc123.js").await.as_deref(),
            Some(IMMUTABLE)
        );
    }

    #[tokio::test]
    async fn entry_document_revalidates() {
        assert_eq!(cache_header("/").await.as_deref(), Some(REVALIDATE));
    }

    #[tokio::test]
    async fn preserves_handler_set_cache_control() {
        assert_eq!(
            cache_header("/already-set").await.as_deref(),
            Some("max-age=60")
        );
    }
}

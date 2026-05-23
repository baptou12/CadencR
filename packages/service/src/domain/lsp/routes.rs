//! HTTP + WebSocket routes for the LSP host.
//!
//! - `POST /api/lsp/sessions` — reserve a session for `(workspace, language)`
//!   and get back an opaque id. utoipa-annotated so the generated TS client
//!   gets a typed hook.
//! - `GET  /api/lsp/sessions/:session_id/connect` — WebSocket upgrade. Same
//!   origin + subprotocol-token auth as the existing `/ws` route; not
//!   utoipa-annotated, matching the existing `/ws` convention.

use std::path::PathBuf;

use axum::extract::{Path, State, WebSocketUpgrade};
use axum::http::HeaderMap;
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::api::middleware::{validate_ws_origin, validate_ws_token};
use crate::app_state::AppState;
use crate::error::AppError;

use super::lifecycle::CrashKey;
use super::probe::{probe_servers, ServerProbe};
use super::proxy::run_proxy;
use super::registry::SessionSpec;
use super::spawn::{resolve_server, spawn_server};

pub fn lsp_router() -> Router<AppState> {
    Router::new()
        .route("/api/lsp/sessions", post(open_session_handler))
        .route(
            "/api/lsp/sessions/{session_id}/connect",
            get(connect_handler),
        )
        .route("/api/lsp/servers", get(list_servers_handler))
}

#[derive(Debug, Serialize, ToSchema)]
pub struct ListServersResponse {
    pub servers: Vec<ServerProbe>,
}

/// Inspect the LSP catalog and report each entry's installation state.
/// Used by Settings → Editor; never triggers a download.
#[utoipa::path(
    get,
    path = "/api/lsp/servers",
    responses(
        (status = 200, body = ListServersResponse),
    )
)]
pub async fn list_servers_handler() -> Json<ListServersResponse> {
    Json(ListServersResponse {
        servers: probe_servers().await,
    })
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct OpenLspSessionRequest {
    /// Absolute path to the workspace root the language server should index.
    pub workspace_root: String,
    /// LSP `TextDocumentItem` language id (e.g. `"typescript"`, `"rust"`,
    /// `"python"`). The renderer derives this from the same catalog the
    /// service uses; see `domain/lsp/spawn.rs::resolve_server`.
    pub language_id: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct OpenLspSessionResponse {
    /// Opaque single-use id. Connect within 30 s by upgrading
    /// `GET /api/lsp/sessions/{session_id}/connect` to WebSocket.
    pub session_id: String,
}

#[utoipa::path(
    post,
    path = "/api/lsp/sessions",
    request_body = OpenLspSessionRequest,
    responses(
        (status = 200, body = OpenLspSessionResponse),
        (status = 400, description = "Unknown language id or invalid workspace path"),
    )
)]
pub async fn open_session_handler(
    State(state): State<AppState>,
    Json(req): Json<OpenLspSessionRequest>,
) -> Result<Json<OpenLspSessionResponse>, AppError> {
    if req.language_id.is_empty() {
        return Err(AppError::BadRequest("language_id is required".into()));
    }
    let workspace_root = PathBuf::from(&req.workspace_root);
    if !workspace_root.is_absolute() {
        return Err(AppError::BadRequest(format!(
            "workspace_root must be absolute, got {:?}",
            req.workspace_root
        )));
    }
    // Do the full binary discovery (and, if necessary, the on-demand
    // download) at reservation time. The WS upgrade later can't surface
    // an informative error to the browser — a non-101 status appears as a
    // bare `error` event with no body — so we have to fail visibly here
    // while we can still return JSON. Renderer reads `.error` and toasts.
    let server = resolve_server(&req.language_id).await?;
    let session_id = state
        .lsp_sessions
        .reserve(SessionSpec {
            workspace_root,
            language_id: req.language_id,
            server,
        })
        .await;
    Ok(Json(OpenLspSessionResponse { session_id }))
}

pub async fn connect_handler(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
    Path(session_id): Path<String>,
    headers: HeaderMap,
) -> Response {
    if let Err(resp) = validate_ws_origin(&headers, state.frontend_port) {
        return resp;
    }
    let selected_proto = match validate_ws_token(&headers, &state.auth_token) {
        Ok(proto) => proto.to_string(),
        Err(resp) => return resp,
    };

    // Claim the reservation BEFORE the upgrade, so an invalid id returns 404
    // rather than completing the handshake and immediately closing — the
    // renderer can show a useful error.
    let spec = match state.lsp_sessions.claim(&session_id).await {
        Ok(spec) => spec,
        Err(err) => return err.into_response(),
    };

    // Crash backoff: if this `(workspace, language)` has been crashing,
    // reject the upgrade with 503 and a Retry-After hint so the renderer
    // can surface "language server is unhealthy; try again in N s".
    let crash_key = CrashKey {
        workspace_root: spec.workspace_root.clone(),
        language_id: spec.language_id.clone(),
    };
    if let Err(remaining) = state.lsp_crashes.check(&crash_key).await {
        let secs = remaining.as_secs().max(1);
        return AppError::ServiceUnavailable(format!(
            "language server crashed recently; retry in {secs}s"
        ))
        .into_response();
    }

    // Binary was already resolved (and downloaded if needed) at POST time;
    // here we just spawn it. If the binary went missing between POST and
    // WS upgrade (unlikely — < 30s window) the spawn returns Internal.
    let child = match spawn_server(&spec.server, &spec.workspace_root) {
        Ok(c) => c,
        Err(err) => {
            state.lsp_crashes.record_crash(crash_key).await;
            return err.into_response();
        }
    };

    let ws = ws.protocols([selected_proto]);
    let display_name = spec.server.display_name.clone();
    let crash_tracker = state.lsp_crashes.clone();
    ws.on_upgrade(move |socket| async move {
        run_proxy(socket, child, &display_name, crash_tracker, crash_key).await;
    })
    .into_response()
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::Body;
    use axum::http::{header, Request as HttpRequest, StatusCode};
    use tower::ServiceExt;

    async fn app() -> Router {
        let pool = sqlx::SqlitePool::connect("sqlite::memory:")
            .await
            .expect("pool");
        let mut state = AppState::with_pool(pool);
        state.auth_token = "test-token".into();
        state.port = 5005;
        lsp_router().with_state(state)
    }

    fn post_open(body: &str) -> HttpRequest<Body> {
        HttpRequest::builder()
            .method("POST")
            .uri("/api/lsp/sessions")
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(body.to_string()))
            .unwrap()
    }

    #[tokio::test]
    async fn open_rejects_relative_workspace() {
        let body = r#"{"workspace_root":"relative/path","language_id":"typescript"}"#;
        let resp = app().await.oneshot(post_open(body)).await.unwrap();
        assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn open_rejects_unknown_language() {
        let body = r#"{"workspace_root":"/tmp","language_id":"brainfuck"}"#;
        let resp = app().await.oneshot(post_open(body)).await.unwrap();
        assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn open_returns_session_id_or_404_for_known_language() {
        let body = r#"{"workspace_root":"/tmp","language_id":"typescript"}"#;
        let resp = app().await.oneshot(post_open(body)).await.unwrap();
        // Either 200 (tsserver on PATH in CI) or 404 (not installed).
        // Both are correct end-states — what matters is that POST emits
        // a structured response the renderer can toast, not a silent WS
        // failure on a later upgrade.
        let status = resp.status();
        assert!(
            status == StatusCode::OK || status == StatusCode::NOT_FOUND,
            "unexpected status {status}"
        );
        let bytes = axum::body::to_bytes(resp.into_body(), 64 * 1024)
            .await
            .unwrap();
        let parsed: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        if status == StatusCode::OK {
            let id = parsed["session_id"].as_str().expect("session_id string");
            assert!(!id.is_empty());
        } else {
            let msg = parsed["error"].as_str().expect("error string");
            assert!(
                msg.contains("typescript-language-server"),
                "404 body should name the missing binary, got {msg}"
            );
        }
    }

    // Note: there's no unit test here for "GET /connect with unknown session
    // returns 404", because driving a real WebSocket handshake through
    // `tower::ServiceExt::oneshot` is brittle — axum's `WebSocketUpgrade`
    // extractor returns 426 before our handler runs unless the synthetic
    // request matches its negotiation exactly across axum versions. The
    // claim-side semantics ("unknown session id is NotFound") are covered by
    // `super::super::registry::tests::unknown_session_is_not_found`, and the
    // route↔registry wiring is covered by the manual smoke test.
}

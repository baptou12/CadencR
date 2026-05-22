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

use super::proxy::run_proxy;
use super::registry::SessionSpec;
use super::spawn::{resolve_language, resolve_server, spawn_server};

pub fn lsp_router() -> Router<AppState> {
    Router::new()
        .route("/api/lsp/sessions", post(open_session_handler))
        .route(
            "/api/lsp/sessions/{session_id}/connect",
            get(connect_handler),
        )
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
    // Fail fast at reservation time so the renderer can show "no server for
    // this language" before opening a WS that would immediately error out.
    // We only validate the *language* here — actual binary discovery /
    // download happens lazily on the WS upgrade so we don't block the
    // renderer's request on a 30s network fetch.
    resolve_language(&req.language_id)?;
    let session_id = state
        .lsp_sessions
        .reserve(SessionSpec {
            workspace_root,
            language_id: req.language_id,
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
    let server_spec = match resolve_server(&spec.language_id).await {
        Ok(s) => s,
        Err(err) => return err.into_response(),
    };
    let child = match spawn_server(&server_spec, &spec.workspace_root) {
        Ok(c) => c,
        Err(err) => return err.into_response(),
    };

    let ws = ws.protocols([selected_proto]);
    let display_name = server_spec.display_name.clone();
    ws.on_upgrade(move |socket| async move {
        run_proxy(socket, child, &display_name).await;
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
    async fn open_returns_session_id_for_known_language() {
        let body = r#"{"workspace_root":"/tmp","language_id":"typescript"}"#;
        let resp = app().await.oneshot(post_open(body)).await.unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(resp.into_body(), 64 * 1024)
            .await
            .unwrap();
        // Parse into untyped JSON to avoid forcing a `Deserialize` impl on
        // the response type, which orval doesn't need.
        let parsed: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        let id = parsed["session_id"].as_str().expect("session_id string");
        assert!(!id.is_empty());
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

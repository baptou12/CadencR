//! Routes of the two tab levels past the page (`docs/CUSTOM_TABS.md` §4.6,
//! §4.7): `exec` and `backend` for the tab (plugin token), and the activity
//! the user sees (main token). Loopback only, like every custom-tab route.

use axum::extract::{Json, Path, Query, State};
use axum::http::StatusCode;
use axum::routing::{delete, get, post};
use axum::Router;
use serde::{Deserialize, Serialize};
use utoipa::{IntoParams, ToSchema};

use super::activity::PluginTabExecRecord;
use super::backend::models::{PluginBackendRequest, PluginBackendResponse, PluginTabBackendStatus};
use super::backend::BackendLaunch;
use super::exec::{self, PluginExecRequest, PluginExecResult};
use super::plugin_routes::{granted_manifest, granted_tab};
use super::policy::Scope;
use super::principal::PluginPrincipal;
use crate::app_state::AppState;
use crate::domain::features::service::get_feature_cwd;
use crate::error::AppError;

pub fn plugin_tab_runtime_router() -> Router<AppState> {
    Router::new()
        .route(
            "/api/plugin-tabs/self/exec",
            post(plugin_tab_self_exec_handler),
        )
        .route(
            "/api/plugin-tabs/self/backend",
            post(plugin_tab_self_backend_handler),
        )
        .route(
            "/api/plugin-tabs/{id}/activity",
            get(plugin_tab_activity_handler),
        )
        .route(
            "/api/plugin-tabs/{id}/backends/{feature_id}",
            delete(plugin_tab_stop_backend_handler),
        )
}

/// Run one of the tab's declared `commands` in its conversation's folder,
/// without a shell (plugin token). A non-zero exit is a 200 result. 403
/// `PLUGIN_EXEC_DENIED` for an undeclared program, 422
/// `PLUGIN_EXEC_NOT_FOUND`, 429 `PLUGIN_EXEC_BUSY`, 504 `PLUGIN_EXEC_TIMEOUT`,
/// 502 `PLUGIN_EXEC_OUTPUT_TOO_LARGE` / `PLUGIN_EXEC_FAILED`.
#[utoipa::path(
    post,
    path = "/api/plugin-tabs/self/exec",
    request_body = PluginExecRequest,
    responses((status = 200, body = PluginExecResult))
)]
pub async fn plugin_tab_self_exec_handler(
    State(state): State<AppState>,
    principal: PluginPrincipal,
    Json(body): Json<PluginExecRequest>,
) -> Result<Json<PluginExecResult>, AppError> {
    let manifest = granted_manifest(&state, &principal).await?;
    Ok(Json(
        exec::run(
            &state.read_pool,
            &state.plugin_tab_activity,
            &principal,
            &manifest,
            body,
        )
        .await?,
    ))
}

/// Send one request to the tab's native backend, starting it if it is not
/// running (plugin token). A backend error is a 200 with `error`. 403
/// `PLUGIN_BACKEND_UNDECLARED` / `PLUGIN_BACKEND_UNSUPPORTED`, 422
/// `PLUGIN_BACKEND_UNAVAILABLE`, 429 `PLUGIN_BACKEND_BUSY`, 503
/// `PLUGIN_BACKEND_CRASHING`, 504 `PLUGIN_BACKEND_TIMEOUT`, 502
/// `PLUGIN_BACKEND_EXITED`.
#[utoipa::path(
    post,
    path = "/api/plugin-tabs/self/backend",
    request_body = PluginBackendRequest,
    responses((status = 200, body = PluginBackendResponse))
)]
pub async fn plugin_tab_self_backend_handler(
    State(state): State<AppState>,
    principal: PluginPrincipal,
    Json(body): Json<PluginBackendRequest>,
) -> Result<Json<PluginBackendResponse>, AppError> {
    let launch = backend_launch(&state, &principal).await?;
    Ok(Json(
        state
            .plugin_tab_backends
            .request(&state.plugin_tab_grants, launch, body)
            .await?,
    ))
}

async fn backend_launch(
    state: &AppState,
    principal: &PluginPrincipal,
) -> Result<BackendLaunch, AppError> {
    let (tab, manifest) = granted_tab(state, principal).await?;
    let Some(backend) = manifest.backend.clone() else {
        return Err(AppError::coded(
            StatusCode::FORBIDDEN,
            "PLUGIN_BACKEND_UNDECLARED",
            "this tab declares no `backend` in tab.json",
        ));
    };
    if tab.is_managed() {
        return Err(AppError::coded(
            StatusCode::FORBIDDEN,
            "PLUGIN_BACKEND_UNSUPPORTED",
            "marketplace tabs cannot run a native backend",
        ));
    }
    let worktree = get_feature_cwd(&state.read_pool, principal.feature_id).await?;
    Ok(BackendLaunch {
        plugin_id: principal.plugin_id.clone(),
        plugin_version: manifest.version.clone(),
        project_id: principal.project_id,
        feature_id: principal.feature_id,
        plugin_dir: tab.report.directory,
        worktree: worktree.into(),
        backend,
        scopes: Scope::parse_all(&manifest.permissions),
        permissions_hash: principal.permissions_hash.clone(),
        api_base_url: format!("http://127.0.0.1:{}", state.port),
    })
}

/// `?feature_id=` of the conversation whose activity is shown.
#[derive(Debug, Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
pub struct PluginTabActivityQuery {
    pub feature_id: i64,
}

/// What a tab ran in one conversation since Cadencr started.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct PluginTabActivity {
    /// The commands it asked Cadencr to run, newest first (at most 50).
    pub commands: Vec<PluginTabExecRecord>,
    /// Its native backend there; `None` when it never started.
    pub backend: Option<PluginTabBackendStatus>,
}

#[utoipa::path(
    get,
    path = "/api/plugin-tabs/{id}/activity",
    params(("id" = String, Path,), PluginTabActivityQuery),
    responses((status = 200, body = PluginTabActivity))
)]
pub async fn plugin_tab_activity_handler(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Query(query): Query<PluginTabActivityQuery>,
) -> Json<PluginTabActivity> {
    Json(PluginTabActivity {
        commands: state.plugin_tab_activity.recent(&id, query.feature_id),
        backend: state
            .plugin_tab_backends
            .status(&id, query.feature_id)
            .await,
    })
}

/// Stop the tab's backend in one conversation and clear its crash history:
/// the tab's next request starts it afresh.
#[utoipa::path(
    delete,
    path = "/api/plugin-tabs/{id}/backends/{feature_id}",
    params(("id" = String, Path,), ("feature_id" = i64, Path,)),
    responses((status = 204))
)]
pub async fn plugin_tab_stop_backend_handler(
    State(state): State<AppState>,
    Path((id, feature_id)): Path<(String, i64)>,
) -> StatusCode {
    state.plugin_tab_backends.stop(&id, feature_id).await;
    StatusCode::NO_CONTENT
}

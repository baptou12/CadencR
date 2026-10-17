//! Host API for custom tabs (`docs/CUSTOM_TABS.md` §4.2), main token only.
//! Handler names carry a `plugin_tab_` prefix: they are global operationIds.

use axum::extract::{Json, Path, Query, State};
use axum::response::Response;
use axum::routing::{get, post, put};
use axum::Router;
use sqlx::SqlitePool;

use super::models::{
    CreatePluginTabRequest, PluginTabConfiguration, PluginTabConsentRequest, PluginTabProjectQuery,
    PluginTabSummary, PluginTabWorkspace, PutPluginTabConfigurationRequest,
    SetPluginTabEnablementRequest,
};
use super::{assets, authoring, config, consent, enablement, registry, summary, workspace};
use crate::app_state::AppState;
use crate::error::AppError;

pub fn plugin_tabs_router() -> Router<AppState> {
    Router::new()
        .route("/api/plugin-tabs", get(plugin_tab_list_handler))
        .route(
            "/api/plugin-tabs/authoring",
            post(plugin_tab_authoring_handler),
        )
        .route("/api/plugin-tabs/{id}", get(plugin_tab_get_handler))
        .route(
            "/api/plugin-tabs/{id}/enablement",
            put(plugin_tab_set_enablement_handler),
        )
        .route(
            "/api/plugin-tabs/{id}/consent",
            put(plugin_tab_consent_handler),
        )
        .route(
            "/api/plugin-tabs/{id}/configuration",
            get(plugin_tab_get_configuration_handler).put(plugin_tab_put_configuration_handler),
        )
        .route(
            "/api/plugin-tabs/{id}/workspace",
            post(plugin_tab_workspace_handler),
        )
        // `{*path}` never matches an empty path, so the entry document has its
        // own routes, with and without the trailing slash.
        .route(
            "/api/plugin-tabs/{id}/assets",
            get(plugin_tab_entry_handler),
        )
        .route(
            "/api/plugin-tabs/{id}/assets/",
            get(plugin_tab_entry_handler),
        )
        .route(
            "/api/plugin-tabs/{id}/assets/{*path}",
            get(plugin_tab_asset_handler),
        )
}

#[utoipa::path(
    get,
    path = "/api/plugin-tabs",
    params(PluginTabProjectQuery),
    responses((status = 200, body = Vec<PluginTabSummary>))
)]
pub async fn plugin_tab_list_handler(
    State(state): State<AppState>,
    Query(query): Query<PluginTabProjectQuery>,
) -> Result<Json<Vec<PluginTabSummary>>, AppError> {
    Ok(Json(
        summary::list(&state.read_pool, query.project_id).await?,
    ))
}

#[utoipa::path(
    get,
    path = "/api/plugin-tabs/{id}",
    params(("id" = String, Path,), PluginTabProjectQuery),
    responses((status = 200, body = PluginTabSummary))
)]
pub async fn plugin_tab_get_handler(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Query(query): Query<PluginTabProjectQuery>,
) -> Result<Json<PluginTabSummary>, AppError> {
    Ok(Json(
        summary::get(&state.read_pool, &id, query.project_id).await?,
    ))
}

/// Set or clear the global switch or a project override. Turning a tab on
/// requires a valid manifest (422 `PLUGIN_TAB_INVALID`) and a current consent
/// (409 `PLUGIN_TAB_CONSENT_REQUIRED`).
#[utoipa::path(
    put,
    path = "/api/plugin-tabs/{id}/enablement",
    params(("id" = String, Path,)),
    request_body = SetPluginTabEnablementRequest,
    responses((status = 200, body = PluginTabSummary))
)]
pub async fn plugin_tab_set_enablement_handler(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<SetPluginTabEnablementRequest>,
) -> Result<Json<PluginTabSummary>, AppError> {
    let pool = &state.write_pool;
    let tab = registry::get(&id).await?;
    require_project(pool, body.project_id).await?;
    enablement::set(pool, &tab, body.project_id, body.enabled).await?;
    Ok(Json(summary::from_tab(pool, tab, body.project_id).await?))
}

/// Accept the tab's current permissions. 409 `PLUGIN_TAB_CONSENT_STALE` when
/// `permissions_hash` is not the current one.
#[utoipa::path(
    put,
    path = "/api/plugin-tabs/{id}/consent",
    params(("id" = String, Path,), PluginTabProjectQuery),
    request_body = PluginTabConsentRequest,
    responses((status = 200, body = PluginTabSummary))
)]
pub async fn plugin_tab_consent_handler(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Query(query): Query<PluginTabProjectQuery>,
    Json(body): Json<PluginTabConsentRequest>,
) -> Result<Json<PluginTabSummary>, AppError> {
    let pool = &state.write_pool;
    let tab = registry::get(&id).await?;
    let (_, current) = tab.require_valid()?;
    consent::require_current(&id, &current, &body.permissions_hash)?;
    consent::record(pool, &id, &current).await?;
    Ok(Json(summary::from_tab(pool, tab, query.project_id).await?))
}

#[utoipa::path(
    get,
    path = "/api/plugin-tabs/{id}/configuration",
    params(("id" = String, Path,), PluginTabProjectQuery),
    responses((status = 200, body = PluginTabConfiguration))
)]
pub async fn plugin_tab_get_configuration_handler(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Query(query): Query<PluginTabProjectQuery>,
) -> Result<Json<PluginTabConfiguration>, AppError> {
    let tab = registry::get(&id).await?;
    let (manifest, _) = tab.require_valid()?;
    Ok(Json(
        config::read(&state.read_pool, &id, manifest, query.project_id).await?,
    ))
}

/// Write settings at `project_id` (global when omitted); `null` removes a
/// value. Returns the form as `GET` does, secrets masked.
#[utoipa::path(
    put,
    path = "/api/plugin-tabs/{id}/configuration",
    params(("id" = String, Path,), PluginTabProjectQuery),
    request_body = PutPluginTabConfigurationRequest,
    responses((status = 200, body = PluginTabConfiguration))
)]
pub async fn plugin_tab_put_configuration_handler(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Query(query): Query<PluginTabProjectQuery>,
    Json(body): Json<PutPluginTabConfigurationRequest>,
) -> Result<Json<PluginTabConfiguration>, AppError> {
    let pool = &state.write_pool;
    let tab = registry::get(&id).await?;
    let (manifest, _) = tab.require_valid()?;
    require_project(pool, query.project_id).await?;
    config::write(pool, &id, manifest, query.project_id, &body.values).await?;
    Ok(Json(
        config::read(pool, &id, manifest, query.project_id).await?,
    ))
}

/// Create a new custom tab and its authoring project (§8).
#[utoipa::path(
    post,
    path = "/api/plugin-tabs/authoring",
    request_body = CreatePluginTabRequest,
    responses((status = 200, body = PluginTabWorkspace))
)]
pub async fn plugin_tab_authoring_handler(
    State(state): State<AppState>,
    Json(body): Json<CreatePluginTabRequest>,
) -> Result<Json<PluginTabWorkspace>, AppError> {
    Ok(Json(authoring::create(&state.write_pool, &body).await?))
}

/// The tab's authoring project, created if missing. Idempotent; also the retry
/// for a `PLUGIN_TAB_PROJECT_SETUP_FAILED` creation.
#[utoipa::path(
    post,
    path = "/api/plugin-tabs/{id}/workspace",
    params(("id" = String, Path,)),
    responses((status = 200, body = PluginTabWorkspace))
)]
pub async fn plugin_tab_workspace_handler(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<PluginTabWorkspace>, AppError> {
    Ok(Json(workspace::ensure(&state.write_pool, &id).await?))
}

/// The tab's `entry` document. Outside OpenAPI (opaque bytes; see `assets`).
pub async fn plugin_tab_entry_handler(Path(id): Path<String>) -> Result<Response, AppError> {
    assets::serve(&id, "").await
}

/// One static file of the tab. Outside OpenAPI (opaque bytes; see `assets`).
pub async fn plugin_tab_asset_handler(
    Path((id, path)): Path<(String, String)>,
) -> Result<Response, AppError> {
    assets::serve(&id, &path).await
}

async fn require_project(pool: &SqlitePool, project_id: Option<i64>) -> Result<(), AppError> {
    match project_id {
        Some(project_id) => {
            crate::domain::projects::service::ensure_project_exists(pool, project_id).await
        }
        None => Ok(()),
    }
}

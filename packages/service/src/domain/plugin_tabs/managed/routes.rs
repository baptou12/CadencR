use super::{invalid, service, InstallManagedTabRequest, ManagedTabInventoryEntry};
use crate::{
    app_state::AppState,
    domain::themes::managed::{catalog, models::ManagedThemeCatalogResponse},
    error::AppError,
};
use axum::{
    extract::{Path, State},
    routing::{get, post},
    Json, Router,
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/api/marketplace/tabs",
            get(get_managed_tabs).post(install_managed_tab),
        )
        .route(
            "/api/marketplace/tabs/catalog",
            get(get_managed_tab_catalog),
        )
        .route(
            "/api/marketplace/tabs/catalog/refresh",
            post(refresh_managed_tab_catalog),
        )
        .route(
            "/api/marketplace/tabs/{id}/update",
            post(update_managed_tab),
        )
        .route(
            "/api/marketplace/tabs/{id}",
            axum::routing::delete(remove_managed_tab),
        )
        .layer(axum::extract::DefaultBodyLimit::max(
            cadencr_registry_core::MAX_CATALOG_BYTES + 1024 * 1024,
        ))
}
#[utoipa::path(get, path="/api/marketplace/tabs", operation_id="getManagedTabs", responses((status=200, body=Vec<ManagedTabInventoryEntry>)))]
pub async fn get_managed_tabs() -> Result<Json<Vec<ManagedTabInventoryEntry>>, AppError> {
    Ok(Json(service::inventory().await?))
}

async fn acquire(refresh: bool) -> ManagedThemeCatalogResponse {
    let mut response = catalog::acquire_catalog(refresh).await;
    response.recommended_versions = response
        .index
        .as_ref()
        .map(|index| catalog::recommended_for(index, "tab"))
        .unwrap_or_default();
    response
}
#[utoipa::path(get, path="/api/marketplace/tabs/catalog", operation_id="getManagedTabCatalog", responses((status=200, body=ManagedThemeCatalogResponse)))]
pub async fn get_managed_tab_catalog() -> Json<ManagedThemeCatalogResponse> {
    Json(acquire(false).await)
}
#[utoipa::path(post, path="/api/marketplace/tabs/catalog/refresh", operation_id="refreshManagedTabCatalog", responses((status=200, body=ManagedThemeCatalogResponse)))]
pub async fn refresh_managed_tab_catalog() -> Json<ManagedThemeCatalogResponse> {
    Json(acquire(true).await)
}
#[utoipa::path(post, path="/api/marketplace/tabs", operation_id="installManagedTab", request_body=InstallManagedTabRequest, responses((status=200, body=ManagedTabInventoryEntry)))]
pub async fn install_managed_tab(
    State(state): State<AppState>,
    Json(body): Json<InstallManagedTabRequest>,
) -> Result<Json<ManagedTabInventoryEntry>, AppError> {
    let entry = service::install(body, false).await?;
    notify(&state, &entry.id);
    Ok(Json(entry))
}
#[utoipa::path(post, path="/api/marketplace/tabs/{id}/update", operation_id="updateManagedTab", params(("id"=String,Path)), request_body=InstallManagedTabRequest, responses((status=200, body=ManagedTabInventoryEntry)))]
pub async fn update_managed_tab(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<InstallManagedTabRequest>,
) -> Result<Json<ManagedTabInventoryEntry>, AppError> {
    if id != body.tab_id {
        return Err(invalid("tab update id mismatch"));
    }
    let entry = service::install(body, true).await?;
    notify(&state, &id);
    Ok(Json(entry))
}
#[utoipa::path(delete, path="/api/marketplace/tabs/{id}", operation_id="removeManagedTab", params(("id"=String,Path)), responses((status=200, body=bool)))]
pub async fn remove_managed_tab(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<bool>, AppError> {
    service::remove(id.clone()).await?;
    notify(&state, &id);
    Ok(Json(true))
}
fn notify(state: &AppState, id: &str) {
    let _ = state
        .plugin_tab_events_tx
        .send(super::super::PluginTabChangedEvent {
            plugin_id: id.to_string(),
        });
}

use axum::extract::{Json, Path, State};
use axum::routing::{get, post, put};
use axum::Router;

use crate::app_state::AppState;
use crate::error::AppError;

use super::models::{
    CreateThemeRequest, DeleteThemeResponse, UserTheme, WriteThemeRequest, WriteThemeResponse,
};
use super::store;
use super::workspace::{self, ThemeWorkspace};

pub fn themes_router() -> Router<AppState> {
    Router::new()
        .route(
            "/api/themes",
            get(list_themes_handler).post(create_theme_handler),
        )
        .route(
            "/api/themes/{id}",
            put(write_theme_handler).delete(delete_theme_handler),
        )
        .route("/api/themes/{id}/workspace", post(theme_workspace_handler))
}

#[utoipa::path(get, path = "/api/themes", responses((status = 200, body = Vec<UserTheme>)))]
pub async fn list_themes_handler() -> Result<Json<Vec<UserTheme>>, AppError> {
    Ok(Json(store::list().await?))
}

#[utoipa::path(post, path = "/api/themes", request_body = CreateThemeRequest, responses((status = 200, body = UserTheme)))]
pub async fn create_theme_handler(
    Json(body): Json<CreateThemeRequest>,
) -> Result<Json<UserTheme>, AppError> {
    Ok(Json(
        store::create(&body.label, body.appearance, body.css_vars, body.xterm).await?,
    ))
}

#[utoipa::path(
    put,
    path = "/api/themes/{id}",
    params(("id" = String, Path,)),
    request_body = WriteThemeRequest,
    responses((status = 200, body = WriteThemeResponse))
)]
pub async fn write_theme_handler(
    Path(id): Path<String>,
    Json(body): Json<WriteThemeRequest>,
) -> Result<Json<WriteThemeResponse>, AppError> {
    Ok(Json(WriteThemeResponse {
        theme: store::write(&id, &body.content).await?,
    }))
}

#[utoipa::path(
    delete,
    path = "/api/themes/{id}",
    params(("id" = String, Path,)),
    responses((status = 200, body = DeleteThemeResponse))
)]
pub async fn delete_theme_handler(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<DeleteThemeResponse>, AppError> {
    store::delete(&id).await?;
    workspace::remove(&state.write_pool, &id).await;
    Ok(Json(DeleteThemeResponse { success: true }))
}

/// The project this theme is edited in, created on first use. A POST because it
/// can create a project, a conversation and a git repository; repeating it
/// always returns the same ids.
#[utoipa::path(
    post,
    path = "/api/themes/{id}/workspace",
    params(("id" = String, Path,)),
    responses((status = 200, body = ThemeWorkspace))
)]
pub async fn theme_workspace_handler(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<ThemeWorkspace>, AppError> {
    Ok(Json(workspace::ensure(&state.write_pool, &id).await?))
}

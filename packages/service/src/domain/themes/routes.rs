use axum::extract::{Json, Path};
use axum::routing::{get, put};
use axum::Router;

use crate::app_state::AppState;
use crate::error::AppError;

use super::models::{
    CreateThemeRequest, DeleteThemeResponse, UserTheme, WriteThemeRequest, WriteThemeResponse,
};
use super::store;

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
    Path(id): Path<String>,
) -> Result<Json<DeleteThemeResponse>, AppError> {
    store::delete(&id).await?;
    Ok(Json(DeleteThemeResponse { success: true }))
}

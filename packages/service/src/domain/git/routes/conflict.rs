use axum::extract::{Json, Query, State};

use crate::app_state::AppState;
use crate::domain::git::models::{ConflictContentResponse, GetConflictContentParams};
use crate::domain::git::workflow_service;
use crate::error::AppError;

#[utoipa::path(
    get,
    path = "/api/git/conflict-content",
    params(
        ("feature_id" = i64, Query,),
        ("file_path" = String, Query,)
    ),
    responses((status = 200, body = ConflictContentResponse))
)]
pub async fn get_conflict_content_handler(
    State(state): State<AppState>,
    Query(params): Query<GetConflictContentParams>,
) -> Result<Json<ConflictContentResponse>, AppError> {
    Ok(Json(
        workflow_service::get_conflict_content(&state, params).await?,
    ))
}

#[cfg(test)]
mod tests {
    use axum::body::Body;
    use axum::http::{Request, StatusCode};
    use tower::ServiceExt;

    use super::*;

    #[tokio::test]
    async fn conflict_content_route_is_registered_as_get() {
        let pool = sqlx::SqlitePool::connect("sqlite::memory:").await.unwrap();
        let app = super::super::git_router().with_state(AppState::with_pool(pool));
        let response = app
            .oneshot(
                Request::builder()
                    .uri("/api/git/conflict-content")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    }
}

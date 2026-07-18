use axum::extract::{Json, State};

use crate::app_state::AppState;
use crate::domain::git::models::{
    FileMutationBody, GitOperationControlBody, GitOperationResponse, PushBody, PushInputBody,
    StashMutationBody, StashPushBody, SuccessResponse, UpdateBranchBody,
};
use crate::domain::git::{service, workflow_service};
use crate::error::AppError;

#[utoipa::path(
    post,
    path = "/api/git/index/stage",
    request_body = FileMutationBody,
    responses((status = 200, body = SuccessResponse))
)]
pub async fn stage_file_handler(
    State(state): State<AppState>,
    Json(body): Json<FileMutationBody>,
) -> Result<Json<SuccessResponse>, AppError> {
    Ok(Json(
        workflow_service::index::stage_file(&state, body).await?,
    ))
}

#[utoipa::path(
    post,
    path = "/api/git/index/reset",
    request_body = FileMutationBody,
    responses((status = 200, body = SuccessResponse))
)]
pub async fn reset_file_handler(
    State(state): State<AppState>,
    Json(body): Json<FileMutationBody>,
) -> Result<Json<SuccessResponse>, AppError> {
    Ok(Json(
        workflow_service::index::reset_file(&state, body).await?,
    ))
}

#[utoipa::path(
    post,
    path = "/api/git/stashes/push",
    request_body = StashPushBody,
    responses((status = 200, body = GitOperationResponse))
)]
pub async fn push_stash_handler(
    State(state): State<AppState>,
    Json(body): Json<StashPushBody>,
) -> Result<Json<GitOperationResponse>, AppError> {
    Ok(Json(service::push_stash(&state, body).await?))
}

#[utoipa::path(
    post,
    path = "/api/git/stashes/apply",
    request_body = StashMutationBody,
    responses((status = 200, body = GitOperationResponse))
)]
pub async fn apply_stash_handler(
    State(state): State<AppState>,
    Json(body): Json<StashMutationBody>,
) -> Result<Json<GitOperationResponse>, AppError> {
    Ok(Json(service::apply_stash(&state, body).await?))
}

#[utoipa::path(
    post,
    path = "/api/git/stashes/pop",
    request_body = StashMutationBody,
    responses((status = 200, body = GitOperationResponse))
)]
pub async fn pop_stash_handler(
    State(state): State<AppState>,
    Json(body): Json<StashMutationBody>,
) -> Result<Json<GitOperationResponse>, AppError> {
    Ok(Json(service::pop_stash(&state, body).await?))
}

#[utoipa::path(
    post,
    path = "/api/git/stashes/drop",
    request_body = StashMutationBody,
    responses((status = 200, body = GitOperationResponse))
)]
pub async fn drop_stash_handler(
    State(state): State<AppState>,
    Json(body): Json<StashMutationBody>,
) -> Result<Json<GitOperationResponse>, AppError> {
    Ok(Json(service::drop_stash(&state, body).await?))
}

#[utoipa::path(
    post,
    path = "/api/git/update-branch",
    request_body = UpdateBranchBody,
    responses((status = 200, body = GitOperationResponse))
)]
pub async fn update_branch_handler(
    State(state): State<AppState>,
    Json(body): Json<UpdateBranchBody>,
) -> Result<Json<GitOperationResponse>, AppError> {
    Ok(Json(workflow_service::update_branch(&state, body).await?))
}

#[utoipa::path(
    post,
    path = "/api/git/update-branch/continue",
    request_body = GitOperationControlBody,
    responses((status = 200, body = GitOperationResponse))
)]
pub async fn continue_update_branch_handler(
    State(state): State<AppState>,
    Json(body): Json<GitOperationControlBody>,
) -> Result<Json<GitOperationResponse>, AppError> {
    Ok(Json(
        workflow_service::continue_update_branch(&state, body).await?,
    ))
}

#[utoipa::path(
    post,
    path = "/api/git/update-branch/abort",
    request_body = GitOperationControlBody,
    responses((status = 200, body = GitOperationResponse))
)]
pub async fn abort_update_branch_handler(
    State(state): State<AppState>,
    Json(body): Json<GitOperationControlBody>,
) -> Result<Json<GitOperationResponse>, AppError> {
    Ok(Json(
        workflow_service::abort_update_branch(&state, body).await?,
    ))
}

#[utoipa::path(
    post,
    path = "/api/git/commit",
    request_body = crate::domain::git::models::CommitBody,
    responses((status = 200, body = SuccessResponse))
)]
pub async fn commit_handler(
    State(state): State<AppState>,
    Json(body): Json<crate::domain::git::models::CommitBody>,
) -> Result<Json<SuccessResponse>, AppError> {
    Ok(Json(workflow_service::commit(&state, body).await?))
}

#[utoipa::path(
    post,
    path = "/api/git/push",
    request_body = PushBody,
    responses((status = 200, body = SuccessResponse))
)]
pub async fn push_handler(
    State(state): State<AppState>,
    Json(body): Json<PushBody>,
) -> Result<Json<SuccessResponse>, AppError> {
    Ok(Json(workflow_service::push(&state, body).await?))
}

#[utoipa::path(
    post,
    path = "/api/git/push-input",
    request_body = PushInputBody,
    responses((status = 200, body = SuccessResponse))
)]
pub async fn push_input_handler(
    State(state): State<AppState>,
    Json(body): Json<PushInputBody>,
) -> Result<Json<SuccessResponse>, AppError> {
    Ok(Json(workflow_service::push_input(&state, body).await?))
}

#[cfg(test)]
mod tests {
    use axum::body::Body;
    use axum::http::{Request, StatusCode};
    use tower::ServiceExt;

    use super::*;

    #[tokio::test]
    async fn mutation_routes_are_registered_as_post_endpoints() {
        let pool = sqlx::SqlitePool::connect("sqlite::memory:").await.unwrap();
        let app = super::super::git_router().with_state(AppState::with_pool(pool));
        for path in [
            "/api/git/index/stage",
            "/api/git/index/reset",
            "/api/git/stashes/push",
            "/api/git/stashes/apply",
            "/api/git/stashes/pop",
            "/api/git/stashes/drop",
            "/api/git/update-branch",
            "/api/git/update-branch/continue",
            "/api/git/update-branch/abort",
        ] {
            let request = Request::builder()
                .method("POST")
                .uri(path)
                .header("content-type", "application/json")
                .body(Body::from("{}"))
                .unwrap();
            let response = app.clone().oneshot(request).await.unwrap();
            assert_eq!(
                response.status(),
                StatusCode::UNPROCESSABLE_ENTITY,
                "{path}"
            );
        }
    }
}

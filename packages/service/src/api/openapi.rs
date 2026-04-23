use axum::routing::get;
use axum::{Json, Router};
use serde::Serialize;
use utoipa::OpenApi;

use crate::app_state::AppState;
use crate::domain::agents::claude_code::routes as claude_code_routes;
use crate::domain::diff_comments::models as diff_comments_models;
use crate::domain::diff_comments::routes as diff_comments_routes;
use crate::domain::features::models as features_models;
use crate::domain::features::routes as features_routes;
use crate::domain::git::models;
use crate::domain::git::routes;
use crate::domain::projects::models as projects_models;
use crate::domain::projects::routes as projects_routes;
use crate::domain::sessions::models as sessions_models;
use crate::domain::sessions::routes as sessions_routes;
use crate::domain::workspace::models as workspace_models;
use crate::domain::workspace::routes as workspace_routes;

#[derive(OpenApi)]
#[openapi(
    info(title = "Cadence Service API", version = "0.1.0"),
    paths(
        health,
        openapi_spec,
        routes::get_branch_handler,
        routes::get_stats_handler,
        routes::get_diff_handler,
        routes::get_changed_files_handler,
        routes::get_file_content_handler,
        routes::get_file_content_batch_handler,
        routes::get_commit_log_handler,
        routes::get_file_blob_shas_handler,
        routes::list_files_handler,
        routes::get_worktree_info_handler,
        routes::create_worktree_handler,
        routes::remove_worktree_handler,
        routes::delete_worktree_handler,
        routes::retry_worktree_setup_handler,
        routes::list_project_worktrees_handler,
        routes::list_feature_worktrees_handler,
        routes::remove_orphan_worktree_handler,
        routes::get_original_branch_handler,
        routes::check_merge_conflicts_handler,
        routes::merge_feature_branch_handler,
        routes::delete_feature_branch_handler,
        workspace_routes::list_settings_handler,
        workspace_routes::get_setting_handler,
        workspace_routes::set_setting_handler,
        workspace_routes::get_model_settings_handler,
        workspace_routes::set_model_setting_handler,
        workspace_routes::get_provider_settings_handler,
        workspace_routes::set_provider_setting_handler,
        projects_routes::list_projects_handler,
        projects_routes::create_project_handler,
        projects_routes::delete_project_handler,
        projects_routes::get_project_settings_handler,
        projects_routes::set_project_setting_handler,
        projects_routes::get_project_model_settings_handler,
        projects_routes::set_project_model_setting_handler,
        projects_routes::get_project_provider_settings_handler,
        projects_routes::set_project_provider_setting_handler,
        features_routes::list_features_handler,
        features_routes::create_feature_handler,
        features_routes::get_feature_handler,
        features_routes::delete_feature_handler,
        features_routes::update_feature_status_handler,
        features_routes::update_feature_title_handler,
        features_routes::get_prd_handler,
        features_routes::is_empty_handler,
        features_routes::get_plan_with_phases_handler,
        features_routes::get_plan_progress_handler,
        features_routes::reset_phase_handler,
        features_routes::override_phase_status_handler,
        features_routes::get_feature_settings_handler,
        features_routes::set_feature_setting_handler,
        features_routes::get_feature_model_settings_handler,
        features_routes::set_feature_model_setting_handler,
        features_routes::get_feature_provider_settings_handler,
        features_routes::set_feature_provider_setting_handler,
        features_routes::get_working_dir_handler,
        features_routes::open_external_handler,
        diff_comments_routes::list_diff_comments_handler,
        diff_comments_routes::create_diff_comment_handler,
        diff_comments_routes::update_diff_comment_handler,
        diff_comments_routes::delete_diff_comment_handler,
        diff_comments_routes::mark_diff_comments_sent_handler,
        diff_comments_routes::delete_pending_diff_comments_handler,
        diff_comments_routes::list_diff_viewed_handler,
        diff_comments_routes::mark_diff_viewed_handler,
        diff_comments_routes::unmark_diff_viewed_handler,
        diff_comments_routes::clear_all_diff_viewed_handler,
        sessions_routes::get_sessions_handler,
        sessions_routes::get_feature_agent_state_handler,
        sessions_routes::get_draft_handler,
        sessions_routes::save_draft_handler,
        super::get_agent_catalog,
        claude_code_routes::list_profiles_handler,
        claude_code_routes::upsert_profile_handler,
        claude_code_routes::delete_profile_handler,
        claude_code_routes::set_active_profile_handler,
        claude_code_routes::list_custom_models_handler,
        claude_code_routes::upsert_custom_model_handler,
        claude_code_routes::delete_custom_model_handler,
    ),
    components(schemas(
        HealthResponse,
        crate::domain::agents::runtime::AgentCatalogResponse,
        crate::domain::agents::runtime::ProviderCatalogEntry,
        crate::domain::agents::runtime::ModelCatalogEntry,
        crate::domain::agents::runtime::ProviderStatus,
        models::BranchResponse,
        models::GitStats,
        models::DiffResponse,
        models::ChangedFile,
        models::FileContent,
        models::FileContentBatchItem,
        models::CommitLogEntry,
        models::CommitLogResponse,
        models::FileBlobSha,
        models::WorktreeInfo,
        models::ProjectWorktreeInfo,
        models::FeatureWorktreeInfo,
        models::MergeConflictResult,
        models::MergeResult,
        models::OriginalBranchResponse,
        models::SuccessResponse,
        models::CreateWorktreeResponse,
        models::GetBranchParams,
        models::GetStatsParams,
        models::GetDiffParams,
        models::GetChangedFilesParams,
        models::GetFileContentParams,
        models::GetFileContentBatchBody,
        models::GetCommitLogParams,
        models::GetFileBlobShasParams,
        models::ListFilesParams,
        models::WorktreeInfoParams,
        models::CreateWorktreeBody,
        models::RemoveWorktreeParams,
        models::DeleteWorktreeParams,
        models::RetryWorktreeBody,
        models::ListProjectWorktreesParams,
        models::RemoveOrphanWorktreeBody,
        models::GetOriginalBranchParams,
        models::CheckMergeConflictsParams,
        models::MergeFeatureBranchBody,
        models::DeleteFeatureBranchParams,
        workspace_models::Setting,
        workspace_models::ModelSettings,
        workspace_models::AgentProviderSettings,
        workspace_models::SetSettingRequest,
        workspace_models::SetModelSettingRequest,
        workspace_models::SetProviderSettingRequest,
        workspace_routes::SettingValueResponse,
        projects_models::Project,
        projects_models::CreateProjectRequest,
        projects_models::ProjectSetting,
        projects_models::SetProjectSettingRequest,
        projects_models::ProjectModelSettings,
        projects_models::ProjectProviderSettings,
        projects_models::SetProjectModelSettingRequest,
        projects_models::SetProjectProviderSettingRequest,
        projects_routes::SuccessResponse,
        features_models::Feature,
        features_models::CreateFeatureRequest,
        features_models::CreateFeatureResponse,
        features_models::UpdateStatusRequest,
        features_models::UpdateTitleRequest,
        features_models::Plan,
        features_models::Phase,
        features_models::PlanWithPhases,
        features_models::PlanProgress,
        features_models::PrdResponse,
        features_models::IsEmptyResponse,
        features_models::WorkingDirResponse,
        features_models::FeatureSetting,
        features_models::SetFeatureSettingRequest,
        features_models::FeatureModelSettings,
        features_models::FeatureProviderSettings,
        features_models::SetFeatureModelSettingRequest,
        features_models::SetFeatureProviderSettingRequest,
        features_models::OverridePhaseStatusRequest,
        features_models::OpenExternalRequest,
        features_models::OpenExternalResponse,
        features_routes::SuccessResponse,
        diff_comments_models::DiffComment,
        diff_comments_models::CreateDiffCommentRequest,
        diff_comments_models::UpdateDiffCommentRequest,
        diff_comments_models::UpdatedResponse,
        diff_comments_models::DeletedResponse,
        diff_comments_models::DiffViewedFile,
        diff_comments_models::MarkViewedRequest,
        diff_comments_routes::SuccessResponse,
        sessions_models::AgentSessionRow,
        sessions_models::AgentBlock,
        sessions_models::SessionState,
        sessions_models::FeatureAgentStateResponse,
        sessions_models::DraftResponse,
        sessions_models::SaveDraftRequest,
        sessions_models::SaveDraftResponse,
        claude_code_routes::ProfileView,
        claude_code_routes::ProfilesResponse,
        claude_code_routes::UpsertProfileRequest,
        claude_code_routes::SetActiveProfileRequest,
        claude_code_routes::CustomModelsResponse,
        claude_code_routes::UpsertCustomModelRequest,
        claude_code_routes::SuccessResponse,
    ))
)]
struct ApiDoc;

#[derive(Serialize, utoipa::ToSchema)]
struct HealthResponse {
    status: String,
    /// Fixed identifier; the Tauri shell checks this to reject an imposter
    /// that grabbed our port before we could bind.
    service: &'static str,
}

#[utoipa::path(
    get,
    path = "/api/health",
    responses((status = 200, description = "Service is healthy", body = HealthResponse))
)]
async fn health() -> Json<HealthResponse> {
    Json(HealthResponse {
        status: "ok".to_string(),
        service: "cadence",
    })
}

#[utoipa::path(
    get,
    path = "/api/openapi.json",
    responses((status = 200, description = "OpenAPI specification"))
)]
async fn openapi_spec() -> Json<utoipa::openapi::OpenApi> {
    Json(ApiDoc::openapi())
}

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/api/health", get(health))
        .route("/api/openapi.json", get(openapi_spec))
}

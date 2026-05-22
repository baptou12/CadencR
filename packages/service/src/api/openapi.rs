use axum::routing::get;
use axum::{Json, Router};
use serde::Serialize;
use utoipa::OpenApi;

use crate::app_state::AppState;
use crate::domain::agents::claude_code::routes as claude_code_routes;
use crate::domain::agents::discovery::routes as discovery_routes;
use crate::domain::custom_actions::models as custom_actions_models;
use crate::domain::custom_actions::routes as custom_actions_routes;
use crate::domain::diff_comments::models as diff_comments_models;
use crate::domain::diff_comments::routes as diff_comments_routes;
use crate::domain::editor::mutation_routes as editor_mutation_routes;
use crate::domain::editor::routes as editor_routes;
use crate::domain::feature_layouts::models as feature_layouts_models;
use crate::domain::feature_layouts::routes as feature_layouts_routes;
use crate::domain::features::auto_name_route as features_auto_name_route;
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
    info(title = "Cadencr Service API", version = "0.1.0"),
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
        routes::check_branch_delete_handler,
        routes::has_uncommitted_changes_handler,
        routes::get_blame_handler,
        routes::list_branches_handler,
        routes::get_git_status_handler,
        routes::get_compare_url_handler,
        crate::domain::git::workflow_service::checkout::checkout_branch_handler,
        crate::domain::git::workflow_service::checkout::validate_checkout_handler,
        routes::update_target_branch_handler,
        routes::commit_handler,
        routes::push_handler,
        routes::push_input_handler,
        routes::get_uncommitted_files_handler,
        editor_routes::read_file_handler,
        editor_routes::write_file_handler,
        editor_routes::tree_handler,
        editor_routes::tree_all_handler,
        editor_routes::content_search_handler,
        editor_routes::search_handler,
        editor_mutation_routes::create_editor_file_handler,
        editor_mutation_routes::create_editor_folder_handler,
        editor_mutation_routes::rename_editor_path_handler,
        editor_mutation_routes::move_editor_path_handler,
        editor_mutation_routes::trash_editor_path_handler,
        editor_mutation_routes::get_editor_root_handler,
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
        features_routes::update_feature_title_handler,
        features_routes::update_feature_status_handler,
        features_routes::update_feature_label_handler,
        features_routes::get_feature_settings_handler,
        features_routes::set_feature_setting_handler,
        features_routes::get_feature_model_settings_handler,
        features_routes::set_feature_model_setting_handler,
        features_routes::get_feature_provider_settings_handler,
        features_routes::set_feature_provider_setting_handler,
        features_routes::get_working_dir_handler,
        features_auto_name_route::auto_name_feature_handler,
        custom_actions_routes::list_actions_handler,
        custom_actions_routes::create_action_handler,
        custom_actions_routes::update_action_handler,
        custom_actions_routes::delete_action_handler,
        custom_actions_routes::list_variables_handler,
        custom_actions_routes::set_variable_handler,
        custom_actions_routes::run_action_handler,
        custom_actions_routes::list_runs_handler,
        custom_actions_routes::get_schedule_handler,
        custom_actions_routes::set_schedule_handler,
        feature_layouts_routes::list_layouts_handler,
        feature_layouts_routes::create_layout_handler,
        feature_layouts_routes::update_layout_handler,
        feature_layouts_routes::delete_layout_handler,
        feature_layouts_routes::set_default_layout_handler,
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
        sessions_routes::get_unified_agents_handler,
        sessions_routes::pin_agent_handler,
        sessions_routes::unpin_agent_handler,
        sessions_routes::get_draft_handler,
        sessions_routes::save_draft_handler,
        sessions_routes::get_message_full_content_handler,
        super::get_agent_catalog,
        discovery_routes::binary_discovery_handler,
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
        discovery_routes::BinaryDiscoveryResponse,
        discovery_routes::ProviderDiscovery,
        discovery_routes::DiscoveredCandidate,
        discovery_routes::DiscoveredSource,
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
        // Only request bodies are registered as schemas. Query/path
        // parameter structs are described inline in `#[utoipa::path(params(...))]`
        // — listing them here would cause orval to emit duplicate TS types.
        models::GetFileContentBatchBody,
        models::CreateWorktreeBody,
        models::RetryWorktreeBody,
        models::RemoveOrphanWorktreeBody,
        crate::domain::git::workflow_service::MergeFeatureBranchBody,
        models::HasUncommittedChangesResponse,
        models::BlameLine,
        models::BlameResponse,
        models::BranchInfo,
        models::CompareUrlResponse,
        models::UpdateTargetBranchBody,
        models::CheckoutBody,
        models::CheckoutValidateBody,
        models::CommitBody,
        models::PushBody,
        models::PushInputBody,
        crate::domain::git::host::GitHost,
        crate::domain::git::git_status::GitStatusSnapshot,
        crate::domain::git::porcelain::UncommittedFile,
        editor_routes::ReadFileResponse,
        editor_routes::WriteFileRequest,
        editor_routes::WriteFileResponse,
        editor_routes::FileTreeEntry,
        editor_routes::ContentMatch,
        editor_routes::ContentSearchResponse,
        editor_routes::FileMatchResult,
        editor_routes::FileSearchResponse,
        editor_mutation_routes::CreateFileRequest,
        editor_mutation_routes::CreateFileResponse,
        editor_mutation_routes::CreateFolderRequest,
        editor_mutation_routes::CreateFolderResponse,
        editor_mutation_routes::RenamePathRequest,
        editor_mutation_routes::RenamePathResponse,
        editor_mutation_routes::MovePathRequest,
        editor_mutation_routes::MovePathResponse,
        editor_mutation_routes::TrashPathRequest,
        editor_mutation_routes::TrashPathResponse,
        editor_mutation_routes::EditorRootResponse,
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
        features_models::FeatureStatus,
        features_models::CreateFeatureRequest,
        features_models::CreateFeatureResponse,
        features_models::UpdateTitleRequest,
        features_models::UpdateStatusRequest,
        features_models::UpdateLabelRequest,
        features_models::WorkingDirResponse,
        features_models::FeatureSetting,
        features_models::SetFeatureSettingRequest,
        features_models::FeatureModelSettings,
        features_models::FeatureProviderSettings,
        features_models::SetFeatureModelSettingRequest,
        features_models::SetFeatureProviderSettingRequest,
        features_routes::SuccessResponse,
        custom_actions_models::CustomAction,
        custom_actions_models::CustomActionVariable,
        custom_actions_models::CustomActionRun,
        custom_actions_models::CustomActionSchedule,
        custom_actions_models::CreateCustomActionRequest,
        custom_actions_models::UpdateCustomActionRequest,
        custom_actions_models::SetCustomActionVariableRequest,
        custom_actions_models::SetCustomActionScheduleRequest,
        custom_actions_models::LastRunSummary,
        custom_actions_models::RunResponse,
        custom_actions_models::Scope,
        custom_actions_models::TriggeredBy,
        custom_actions_models::SuccessResponse,
        feature_layouts_models::FeatureLayout,
        feature_layouts_models::CreateFeatureLayoutRequest,
        feature_layouts_models::UpdateFeatureLayoutRequest,
        feature_layouts_models::SuccessResponse,
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
        sessions_models::UnifiedAgentsMode,
        sessions_models::UnifiedAgentProject,
        sessions_models::UnifiedAgentFeature,
        sessions_models::UnifiedAgentEntry,
        sessions_models::UnifiedAgentsResponse,
        sessions_models::AgentPinResponse,
        sessions_models::DraftResponse,
        sessions_models::SaveDraftRequest,
        sessions_models::SaveDraftResponse,
        sessions_models::MessageFullContentResponse,
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
    /// Fixed identifier; the desktop shell checks this to reject an imposter
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
        service: "cadencr",
    })
}

#[utoipa::path(
    get,
    path = "/api/openapi.json",
    responses((status = 200, description = "OpenAPI specification"))
)]
async fn openapi_spec() -> Json<utoipa::openapi::OpenApi> {
    Json(api_doc())
}

/// Returns the full OpenAPI spec. Used by the runtime endpoint above and by the
/// `dump-openapi` binary that emits the spec for orval client generation.
pub fn api_doc() -> utoipa::openapi::OpenApi {
    ApiDoc::openapi()
}

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/api/health", get(health))
        .route("/api/openapi.json", get(openapi_spec))
}

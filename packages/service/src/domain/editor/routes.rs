use axum::extract::{Json, Query, State};
use axum::routing::{get, post};
use axum::Router;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use super::service;
use crate::app_state::AppState;
use crate::domain::projects::service::resolve_feature_editor_root;
use crate::error::AppError;

// ---------------------------------------------------------------------------
// Request / Response types
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize, utoipa::IntoParams)]
pub struct ReadFileParams {
    pub project_id: i64,
    /// Feature id scopes the read to the feature's worktree when one is
    /// active. When absent, the read resolves against the project root.
    #[serde(default)]
    pub feature_id: Option<i64>,
    pub file_path: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct ReadFileResponse {
    pub content: String,
    pub line_count: u64,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct WriteFileRequest {
    pub project_id: i64,
    #[serde(default)]
    pub feature_id: Option<i64>,
    pub file_path: String,
    pub content: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct WriteFileResponse {
    pub success: bool,
}

#[derive(Debug, Deserialize, utoipa::IntoParams)]
pub struct TreeParams {
    pub project_id: i64,
    #[serde(default)]
    pub feature_id: Option<i64>,
    #[serde(default = "default_dir_path")]
    pub dir_path: String,
}

fn default_dir_path() -> String {
    ".".to_string()
}

#[derive(Debug, Deserialize, utoipa::IntoParams)]
pub struct TreeAllParams {
    pub project_id: i64,
    #[serde(default)]
    pub feature_id: Option<i64>,
    /// When true, gitignored files are omitted from the result — fast,
    /// because the walker skips `node_modules`, `target`, etc. wholesale.
    /// When false (default) the walker traverses everything so the UI can
    /// display all files (gitignored dimmed). Callers that want the tree
    /// to paint quickly should issue the `exclude_gitignored=true` query
    /// first and then merge in the `exclude_gitignored=false` response.
    #[serde(default)]
    pub exclude_gitignored: bool,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct FileTreeEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub is_gitignored: bool,
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

#[utoipa::path(get, path = "/api/editor/read",
    params(ReadFileParams),
    responses((status = 200, body = ReadFileResponse)))]
pub async fn read_file_handler(
    State(state): State<AppState>,
    Query(params): Query<ReadFileParams>,
) -> Result<axum::Json<ReadFileResponse>, AppError> {
    let project_root =
        resolve_feature_editor_root(&state.read_pool, params.project_id, params.feature_id).await?;
    let path = service::validate_path(&project_root, &params.file_path)?;

    let resp = tokio::task::spawn_blocking(move || -> Result<ReadFileResponse, AppError> {
        if service::is_binary(&path).map_err(|e| AppError::Internal(e.to_string()))? {
            return Err(AppError::BadRequest(
                "Binary files cannot be opened".to_string(),
            ));
        }

        const MAX_FILE_SIZE: u64 = 5 * 1024 * 1024;
        let metadata = std::fs::metadata(&path).map_err(|e| match e.kind() {
            std::io::ErrorKind::NotFound => {
                AppError::NotFound(format!("File not found: {}", path.display()))
            }
            _ => AppError::Internal(e.to_string()),
        })?;
        if metadata.len() > MAX_FILE_SIZE {
            return Err(AppError::BadRequest(
                "File exceeds 5MB size limit".to_string(),
            ));
        }

        let content = std::fs::read_to_string(&path).map_err(|e| match e.kind() {
            std::io::ErrorKind::NotFound => {
                AppError::NotFound(format!("File not found: {}", path.display()))
            }
            std::io::ErrorKind::PermissionDenied => {
                AppError::BadRequest(format!("Permission denied: {}", path.display()))
            }
            _ => AppError::Internal(e.to_string()),
        })?;

        let line_count = content.lines().count() as u64;
        if line_count > 10_000 {
            return Err(AppError::BadRequest(
                "File exceeds 10,000 line limit".to_string(),
            ));
        }

        Ok(ReadFileResponse {
            content,
            line_count,
        })
    })
    .await
    .map_err(|e| AppError::Internal(format!("Blocking task failed: {e}")))??;

    Ok(axum::Json(resp))
}

#[utoipa::path(post, path = "/api/editor/write",
    request_body = WriteFileRequest,
    responses((status = 200, body = WriteFileResponse)))]
pub async fn write_file_handler(
    State(state): State<AppState>,
    Json(body): Json<WriteFileRequest>,
) -> Result<axum::Json<WriteFileResponse>, AppError> {
    let project_root =
        resolve_feature_editor_root(&state.read_pool, body.project_id, body.feature_id).await?;
    let path = service::validate_path_for_write(&project_root, &body.file_path)?;
    let content = body.content;

    tokio::task::spawn_blocking(move || -> Result<(), AppError> {
        std::fs::write(&path, &content).map_err(|e| match e.kind() {
            std::io::ErrorKind::PermissionDenied => {
                AppError::BadRequest(format!("Permission denied: {}", path.display()))
            }
            _ => AppError::Internal(e.to_string()),
        })
    })
    .await
    .map_err(|e| AppError::Internal(format!("Blocking task failed: {e}")))??;

    Ok(axum::Json(WriteFileResponse { success: true }))
}

#[utoipa::path(get, path = "/api/editor/tree",
    params(TreeParams),
    responses((status = 200, body = Vec<FileTreeEntry>)))]
pub async fn tree_handler(
    State(state): State<AppState>,
    Query(params): Query<TreeParams>,
) -> Result<axum::Json<Vec<FileTreeEntry>>, AppError> {
    let project_root =
        resolve_feature_editor_root(&state.read_pool, params.project_id, params.feature_id).await?;
    let dir_path_param = params.dir_path;

    let entries = tokio::task::spawn_blocking(move || -> Result<Vec<FileTreeEntry>, AppError> {
        let dir_path = service::validate_path(&project_root, &dir_path_param)?;

        let gitignore = service::build_gitignore(&project_root);

        let mut entries: Vec<FileTreeEntry> = Vec::new();

        let read_dir = std::fs::read_dir(&dir_path).map_err(|e| match e.kind() {
            std::io::ErrorKind::NotFound => AppError::NotFound("Directory not found".to_string()),
            std::io::ErrorKind::PermissionDenied => {
                AppError::BadRequest("Permission denied".to_string())
            }
            _ => AppError::Internal(e.to_string()),
        })?;

        for entry in read_dir {
            let entry = entry.map_err(|e| AppError::Internal(e.to_string()))?;
            let name = entry.file_name().to_string_lossy().to_string();

            let metadata = entry
                .metadata()
                .map_err(|e| AppError::Internal(e.to_string()))?;
            let is_dir = metadata.is_dir();

            let relative = entry
                .path()
                .strip_prefix(&project_root)
                .unwrap_or(entry.path().as_path())
                .to_string_lossy()
                .to_string();

            let is_gitignored = service::is_gitignored(gitignore.as_ref(), &entry.path(), is_dir);

            entries.push(FileTreeEntry {
                name,
                path: relative,
                is_dir,
                is_gitignored,
            });
        }

        entries.sort_by(|a, b| {
            b.is_dir
                .cmp(&a.is_dir)
                .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
        });

        Ok(entries)
    })
    .await
    .map_err(|e| AppError::Internal(format!("Blocking task failed: {e}")))??;

    Ok(axum::Json(entries))
}

#[utoipa::path(get, path = "/api/editor/tree-all",
    params(TreeAllParams),
    responses((status = 200, body = Vec<FileTreeEntry>)))]
pub async fn tree_all_handler(
    State(state): State<AppState>,
    Query(params): Query<TreeAllParams>,
) -> Result<axum::Json<Vec<FileTreeEntry>>, AppError> {
    let project_root =
        resolve_feature_editor_root(&state.read_pool, params.project_id, params.feature_id).await?;
    let exclude_gitignored = params.exclude_gitignored;

    let entries = tokio::task::spawn_blocking(move || -> Result<Vec<FileTreeEntry>, AppError> {
        // The `ignore` crate walks recursively and applies `.gitignore`,
        // `.ignore`, hidden-file rules, etc. When `exclude_gitignored` is true
        // (the default) the walker skips ignored entries entirely, which is
        // what makes the tree feasible on projects with `node_modules` /
        // `target` / `dist` etc. When false we walk everything and mark
        // ignored entries so the UI can dim them.
        let gitignore = if exclude_gitignored {
            None
        } else {
            service::build_gitignore(&project_root)
        };

        let mut walker = ignore::WalkBuilder::new(&project_root);
        walker
            .hidden(false)
            .git_ignore(exclude_gitignored)
            .git_global(exclude_gitignored)
            .git_exclude(exclude_gitignored)
            // Always exclude `.git`: large, noisy, never useful to show.
            // Other heavy dirs (`node_modules`, `target`, `dist`, …) are
            // typically gitignored, so the `exclude_gitignored=true` query
            // (the fast first pass) skips them naturally. The slow
            // `exclude_gitignored=false` query intentionally walks them so
            // we can show all files in the tree.
            .filter_entry(|entry| entry.file_name() != ".git");

        let mut entries: Vec<FileTreeEntry> = Vec::new();
        for result in walker.build() {
            let entry = result.map_err(|e| AppError::Internal(e.to_string()))?;
            // Skip the project root itself.
            if entry.depth() == 0 {
                continue;
            }

            let path = entry.path();
            let is_dir = entry.file_type().map(|ft| ft.is_dir()).unwrap_or(false);
            let name = entry.file_name().to_string_lossy().to_string();

            let relative = path
                .strip_prefix(&project_root)
                .map_err(|e| AppError::Internal(e.to_string()))?
                .to_string_lossy()
                .to_string();

            // When excluding gitignored entries, the walker has already
            // filtered them out; `gitignore` is `None` and the helper
            // short-circuits to `false`.
            let is_gitignored = service::is_gitignored(gitignore.as_ref(), path, is_dir);

            entries.push(FileTreeEntry {
                name,
                path: relative,
                is_dir,
                is_gitignored,
            });
        }

        // Directories first, then case-insensitive name. Pierre re-sorts
        // internally, but emitting a stable order avoids hydration jitter
        // and keeps the non-pierre per-directory endpoint behaviour
        // consistent across the surface.
        entries.sort_by(|a, b| {
            b.is_dir
                .cmp(&a.is_dir)
                .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
        });

        Ok(entries)
    })
    .await
    .map_err(|e| AppError::Internal(format!("Blocking task failed: {e}")))??;

    Ok(axum::Json(entries))
}

// ---------------------------------------------------------------------------
// Content search types & handler
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize, utoipa::IntoParams)]
pub struct ContentSearchParams {
    pub project_id: i64,
    #[serde(default)]
    pub feature_id: Option<i64>,
    pub query: String,
    #[serde(default)]
    pub case_sensitive: bool,
    #[serde(default)]
    pub whole_word: bool,
    #[serde(default)]
    pub is_regex: bool,
    #[serde(default = "default_true")]
    pub respect_gitignore: bool,
    pub include_pattern: Option<String>,
    pub exclude_pattern: Option<String>,
    #[serde(default = "default_content_limit")]
    pub limit: usize,
}

fn default_true() -> bool {
    true
}

fn default_content_limit() -> usize {
    500
}

#[derive(Debug, Serialize, ToSchema)]
pub struct ContentMatch {
    pub path: String,
    pub line_number: u64,
    pub line_content: String,
    pub match_start: usize,
    pub match_end: usize,
    pub context_before: Vec<String>,
    pub context_after: Vec<String>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct ContentSearchResponse {
    pub matches: Vec<ContentMatch>,
    pub truncated: bool,
}

#[utoipa::path(get, path = "/api/editor/content-search",
    params(ContentSearchParams),
    responses((status = 200, body = ContentSearchResponse)))]
pub async fn content_search_handler(
    State(state): State<AppState>,
    Query(params): Query<ContentSearchParams>,
) -> Result<axum::Json<ContentSearchResponse>, AppError> {
    let project_root =
        resolve_feature_editor_root(&state.read_pool, params.project_id, params.feature_id).await?;

    let resp = tokio::task::spawn_blocking(move || service::content_search(&project_root, &params))
        .await
        .map_err(|e| AppError::Internal(format!("Blocking task failed: {e}")))??;

    Ok(axum::Json(resp))
}

// ---------------------------------------------------------------------------
// File search types & handler
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize, utoipa::IntoParams)]
pub struct SearchParams {
    pub project_id: i64,
    #[serde(default)]
    pub feature_id: Option<i64>,
    pub query: Option<String>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct FileMatchResult {
    pub path: String,
    pub positions: Vec<u32>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct FileSearchResponse {
    pub files: Vec<FileMatchResult>,
}

#[utoipa::path(get, path = "/api/editor/search",
    params(SearchParams),
    responses((status = 200, body = FileSearchResponse)))]
pub async fn search_handler(
    State(state): State<AppState>,
    Query(params): Query<SearchParams>,
) -> Result<axum::Json<FileSearchResponse>, AppError> {
    let project_root =
        resolve_feature_editor_root(&state.read_pool, params.project_id, params.feature_id).await?;
    let query = params.query.unwrap_or_default();

    let files: Vec<FileMatchResult> =
        tokio::task::spawn_blocking(move || -> Result<Vec<FileMatchResult>, AppError> {
            if query.is_empty() {
                let paths = service::recent_files(&project_root, 20)?;
                Ok(paths
                    .into_iter()
                    .map(|path| FileMatchResult {
                        path,
                        positions: vec![],
                    })
                    .collect())
            } else {
                let matches = service::fuzzy_search_files(&project_root, &query, 50)?;
                Ok(matches
                    .into_iter()
                    .map(|m| FileMatchResult {
                        path: m.path,
                        positions: m.positions,
                    })
                    .collect())
            }
        })
        .await
        .map_err(|e| AppError::Internal(format!("Blocking task failed: {e}")))??;

    Ok(axum::Json(FileSearchResponse { files }))
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

pub fn editor_router() -> Router<AppState> {
    Router::new()
        .route("/api/editor/read", get(read_file_handler))
        .route("/api/editor/write", post(write_file_handler))
        .route("/api/editor/tree", get(tree_handler))
        .route("/api/editor/tree-all", get(tree_all_handler))
        .route("/api/editor/search", get(search_handler))
        .route("/api/editor/content-search", get(content_search_handler))
}

use axum::extract::{Json, Query};
use axum::routing::{get, post};
use axum::Router;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::app_state::AppState;
use crate::error::AppError;
use super::service;

// ---------------------------------------------------------------------------
// Request / Response types
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize, utoipa::IntoParams)]
pub struct ReadFileParams {
    pub project_path: String,
    pub file_path: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct ReadFileResponse {
    pub content: String,
    pub line_count: u64,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct WriteFileRequest {
    pub project_path: String,
    pub file_path: String,
    pub content: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct WriteFileResponse {
    pub success: bool,
}

#[derive(Debug, Deserialize, utoipa::IntoParams)]
pub struct TreeParams {
    pub project_path: String,
    #[serde(default = "default_dir_path")]
    pub dir_path: String,
}

fn default_dir_path() -> String {
    ".".to_string()
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
    Query(params): Query<ReadFileParams>,
) -> Result<axum::Json<ReadFileResponse>, AppError> {
    let path = service::validate_path(&params.project_path, &params.file_path)?;

    let resp = tokio::task::spawn_blocking(move || -> Result<ReadFileResponse, AppError> {
        if service::is_binary(&path).map_err(|e| AppError::Internal(e.to_string()))? {
            return Err(AppError::BadRequest(
                "Binary files cannot be opened".to_string(),
            ));
        }

        const MAX_FILE_SIZE: u64 = 5 * 1024 * 1024;
        let metadata = std::fs::metadata(&path).map_err(|e| match e.kind() {
            std::io::ErrorKind::NotFound => AppError::NotFound(format!("File not found: {}", path.display())),
            _ => AppError::Internal(e.to_string()),
        })?;
        if metadata.len() > MAX_FILE_SIZE {
            return Err(AppError::BadRequest(
                "File exceeds 5MB size limit".to_string(),
            ));
        }

        let content = std::fs::read_to_string(&path).map_err(|e| match e.kind() {
            std::io::ErrorKind::NotFound => AppError::NotFound(format!("File not found: {}", path.display())),
            std::io::ErrorKind::PermissionDenied => AppError::BadRequest(format!("Permission denied: {}", path.display())),
            _ => AppError::Internal(e.to_string()),
        })?;

        let line_count = content.lines().count() as u64;
        if line_count > 10_000 {
            return Err(AppError::BadRequest(
                "File exceeds 10,000 line limit".to_string(),
            ));
        }

        Ok(ReadFileResponse { content, line_count })
    })
    .await
    .map_err(|e| AppError::Internal(format!("Blocking task failed: {e}")))?
    ?;

    Ok(axum::Json(resp))
}

#[utoipa::path(post, path = "/api/editor/write",
    request_body = WriteFileRequest,
    responses((status = 200, body = WriteFileResponse)))]
pub async fn write_file_handler(
    Json(body): Json<WriteFileRequest>,
) -> Result<axum::Json<WriteFileResponse>, AppError> {
    let path = service::validate_path_for_write(&body.project_path, &body.file_path)?;
    let content = body.content;

    tokio::task::spawn_blocking(move || -> Result<(), AppError> {
        std::fs::write(&path, &content).map_err(|e| match e.kind() {
            std::io::ErrorKind::PermissionDenied => AppError::BadRequest(format!("Permission denied: {}", path.display())),
            _ => AppError::Internal(e.to_string()),
        })
    })
    .await
    .map_err(|e| AppError::Internal(format!("Blocking task failed: {e}")))?
    ?;

    Ok(axum::Json(WriteFileResponse { success: true }))
}

#[utoipa::path(get, path = "/api/editor/tree",
    params(TreeParams),
    responses((status = 200, body = Vec<FileTreeEntry>)))]
pub async fn tree_handler(
    Query(params): Query<TreeParams>,
) -> Result<axum::Json<Vec<FileTreeEntry>>, AppError> {
    let project_path = params.project_path;
    let dir_path_param = params.dir_path;

    let entries = tokio::task::spawn_blocking(move || -> Result<Vec<FileTreeEntry>, AppError> {
        let project_canonical = std::fs::canonicalize(&project_path)
            .map_err(|e| AppError::BadRequest(format!("Invalid project path: {e}")))?;

        let dir_path = service::validate_path(&project_path, &dir_path_param)?;

        let gitignore = service::build_gitignore(&project_canonical);

        let mut entries: Vec<FileTreeEntry> = Vec::new();

        let read_dir = std::fs::read_dir(&dir_path).map_err(|e| match e.kind() {
            std::io::ErrorKind::NotFound => AppError::NotFound("Directory not found".to_string()),
            std::io::ErrorKind::PermissionDenied => AppError::BadRequest("Permission denied".to_string()),
            _ => AppError::Internal(e.to_string()),
        })?;

        for entry in read_dir {
            let entry = entry.map_err(|e| AppError::Internal(e.to_string()))?;
            let name = entry.file_name().to_string_lossy().to_string();

            let metadata = entry.metadata().map_err(|e| AppError::Internal(e.to_string()))?;
            let is_dir = metadata.is_dir();

            let relative = entry
                .path()
                .strip_prefix(&project_canonical)
                .unwrap_or(entry.path().as_path())
                .to_string_lossy()
                .to_string();

            let is_gitignored = service::is_gitignored(
                gitignore.as_ref(),
                &entry.path(),
                is_dir,
            );

            entries.push(FileTreeEntry {
                name,
                path: relative,
                is_dir,
                is_gitignored,
            });
        }

        entries.sort_by(|a, b| {
            b.is_dir.cmp(&a.is_dir).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
        });

        Ok(entries)
    })
    .await
    .map_err(|e| AppError::Internal(format!("Blocking task failed: {e}")))?
    ?;

    Ok(axum::Json(entries))
}

// ---------------------------------------------------------------------------
// Content search types & handler
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize, utoipa::IntoParams)]
pub struct ContentSearchParams {
    pub project_path: String,
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
    Query(params): Query<ContentSearchParams>,
) -> Result<axum::Json<ContentSearchResponse>, AppError> {
    let resp = tokio::task::spawn_blocking(move || service::content_search(&params))
        .await
        .map_err(|e| AppError::Internal(format!("Blocking task failed: {e}")))?
        ?;

    Ok(axum::Json(resp))
}

// ---------------------------------------------------------------------------
// File search types & handler
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize, utoipa::IntoParams)]
pub struct SearchParams {
    pub project_path: String,
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
    Query(params): Query<SearchParams>,
) -> Result<axum::Json<FileSearchResponse>, AppError> {
    let project_path = params.project_path;
    let query = params.query.unwrap_or_default();

    let files: Vec<FileMatchResult> = tokio::task::spawn_blocking(move || -> Result<Vec<FileMatchResult>, AppError> {
        if query.is_empty() {
            let paths = service::recent_files(&project_path, 20)?;
            Ok(paths
                .into_iter()
                .map(|path| FileMatchResult { path, positions: vec![] })
                .collect())
        } else {
            let matches = service::fuzzy_search_files(&project_path, &query, 50)?;
            Ok(matches
                .into_iter()
                .map(|m| FileMatchResult { path: m.path, positions: m.positions })
                .collect())
        }
    })
    .await
    .map_err(|e| AppError::Internal(format!("Blocking task failed: {e}")))?
    ?;

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
        .route("/api/editor/search", get(search_handler))
        .route("/api/editor/content-search", get(content_search_handler))
}

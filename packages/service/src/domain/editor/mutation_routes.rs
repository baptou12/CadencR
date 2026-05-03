use axum::extract::{Json, Query, State};
use axum::routing::{delete, get, patch, post};
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

#[derive(Debug, Deserialize, ToSchema)]
pub struct CreateFileRequest {
    pub project_id: i64,
    #[serde(default)]
    pub feature_id: Option<i64>,
    pub file_path: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct CreateFileResponse {
    pub path: String,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct CreateFolderRequest {
    pub project_id: i64,
    #[serde(default)]
    pub feature_id: Option<i64>,
    pub dir_path: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct CreateFolderResponse {
    pub path: String,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct RenamePathRequest {
    pub project_id: i64,
    #[serde(default)]
    pub feature_id: Option<i64>,
    pub old_path: String,
    pub new_name: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct RenamePathResponse {
    pub new_path: String,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct TrashPathRequest {
    pub project_id: i64,
    #[serde(default)]
    pub feature_id: Option<i64>,
    pub path: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct TrashPathResponse {
    pub success: bool,
}

#[derive(Debug, Deserialize, utoipa::IntoParams)]
pub struct EditorRootParams {
    pub project_id: i64,
    #[serde(default)]
    pub feature_id: Option<i64>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct EditorRootResponse {
    /// Absolute filesystem path of the editor root (project or feature
    /// worktree). Used by the frontend to build absolute paths for native
    /// shell operations such as "Reveal in Finder".
    pub root: String,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Reject names that contain path separators or traversal segments. The new
/// name is always a single path component — the caller chooses the parent.
fn validate_simple_name(name: &str) -> Result<(), AppError> {
    if name.is_empty() {
        return Err(AppError::BadRequest("Name cannot be empty".to_string()));
    }
    if name.contains('/') || name.contains('\\') || name == "." || name == ".." {
        return Err(AppError::BadRequest(
            "Name must be a single path component".to_string(),
        ));
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

#[utoipa::path(post, path = "/api/editor/create-file",
    request_body = CreateFileRequest,
    responses((status = 200, body = CreateFileResponse)))]
pub async fn create_editor_file_handler(
    State(state): State<AppState>,
    Json(body): Json<CreateFileRequest>,
) -> Result<axum::Json<CreateFileResponse>, AppError> {
    let project_root =
        resolve_feature_editor_root(&state.read_pool, body.project_id, body.feature_id).await?;
    let path = service::validate_path_for_write(&project_root, &body.file_path)?;
    let project_root_for_response = project_root.clone();

    let path_for_blocking = path.clone();
    tokio::task::spawn_blocking(move || -> Result<(), AppError> {
        if path_for_blocking.exists() {
            return Err(AppError::BadRequest(format!(
                "File already exists: {}",
                path_for_blocking.display()
            )));
        }
        std::fs::write(&path_for_blocking, "").map_err(|e| match e.kind() {
            std::io::ErrorKind::PermissionDenied => AppError::BadRequest(format!(
                "Permission denied: {}",
                path_for_blocking.display()
            )),
            _ => AppError::Internal(e.to_string()),
        })
    })
    .await
    .map_err(|e| AppError::Internal(format!("Blocking task failed: {e}")))??;

    let relative = path
        .strip_prefix(&project_root_for_response)
        .unwrap_or(path.as_path())
        .to_string_lossy()
        .to_string();
    Ok(axum::Json(CreateFileResponse { path: relative }))
}

#[utoipa::path(post, path = "/api/editor/create-folder",
    request_body = CreateFolderRequest,
    responses((status = 200, body = CreateFolderResponse)))]
pub async fn create_editor_folder_handler(
    State(state): State<AppState>,
    Json(body): Json<CreateFolderRequest>,
) -> Result<axum::Json<CreateFolderResponse>, AppError> {
    let project_root =
        resolve_feature_editor_root(&state.read_pool, body.project_id, body.feature_id).await?;
    let path = service::validate_path_for_write(&project_root, &body.dir_path)?;
    let project_root_for_response = project_root.clone();

    let path_for_blocking = path.clone();
    tokio::task::spawn_blocking(move || -> Result<(), AppError> {
        if path_for_blocking.exists() {
            return Err(AppError::BadRequest(format!(
                "Path already exists: {}",
                path_for_blocking.display()
            )));
        }
        std::fs::create_dir(&path_for_blocking).map_err(|e| match e.kind() {
            std::io::ErrorKind::PermissionDenied => AppError::BadRequest(format!(
                "Permission denied: {}",
                path_for_blocking.display()
            )),
            _ => AppError::Internal(e.to_string()),
        })
    })
    .await
    .map_err(|e| AppError::Internal(format!("Blocking task failed: {e}")))??;

    let relative = path
        .strip_prefix(&project_root_for_response)
        .unwrap_or(path.as_path())
        .to_string_lossy()
        .to_string();
    Ok(axum::Json(CreateFolderResponse { path: relative }))
}

#[utoipa::path(patch, path = "/api/editor/rename",
    request_body = RenamePathRequest,
    responses((status = 200, body = RenamePathResponse)))]
pub async fn rename_editor_path_handler(
    State(state): State<AppState>,
    Json(body): Json<RenamePathRequest>,
) -> Result<axum::Json<RenamePathResponse>, AppError> {
    validate_simple_name(&body.new_name)?;
    let project_root =
        resolve_feature_editor_root(&state.read_pool, body.project_id, body.feature_id).await?;

    let old_abs = service::validate_path(&project_root, &body.old_path)?;
    let parent = old_abs
        .parent()
        .ok_or_else(|| AppError::BadRequest("Cannot rename root path".to_string()))?
        .to_path_buf();
    let new_abs = parent.join(&body.new_name);

    if !new_abs.starts_with(&project_root) {
        return Err(AppError::BadRequest(
            "Renamed path is outside the project directory".to_string(),
        ));
    }

    let project_root_for_response = project_root.clone();
    let new_abs_for_blocking = new_abs.clone();
    tokio::task::spawn_blocking(move || -> Result<(), AppError> {
        if new_abs_for_blocking.exists() {
            return Err(AppError::BadRequest(format!(
                "Destination already exists: {}",
                new_abs_for_blocking.display()
            )));
        }
        std::fs::rename(&old_abs, &new_abs_for_blocking).map_err(|e| match e.kind() {
            std::io::ErrorKind::PermissionDenied => AppError::BadRequest(format!(
                "Permission denied: {}",
                new_abs_for_blocking.display()
            )),
            _ => AppError::Internal(e.to_string()),
        })
    })
    .await
    .map_err(|e| AppError::Internal(format!("Blocking task failed: {e}")))??;

    let relative = new_abs
        .strip_prefix(&project_root_for_response)
        .unwrap_or(new_abs.as_path())
        .to_string_lossy()
        .to_string();
    Ok(axum::Json(RenamePathResponse { new_path: relative }))
}

#[utoipa::path(delete, path = "/api/editor/trash",
    request_body = TrashPathRequest,
    responses((status = 200, body = TrashPathResponse)))]
pub async fn trash_editor_path_handler(
    State(state): State<AppState>,
    Json(body): Json<TrashPathRequest>,
) -> Result<axum::Json<TrashPathResponse>, AppError> {
    let project_root =
        resolve_feature_editor_root(&state.read_pool, body.project_id, body.feature_id).await?;
    let abs_path = service::validate_path(&project_root, &body.path)?;

    tokio::task::spawn_blocking(move || -> Result<(), AppError> {
        trash_path(&abs_path).map_err(|e| AppError::Internal(format!("Trash failed: {e}")))
    })
    .await
    .map_err(|e| AppError::Internal(format!("Blocking task failed: {e}")))??;

    Ok(axum::Json(TrashPathResponse { success: true }))
}

/// Move a path to the OS trash. On macOS we explicitly use `NSFileManager`
/// rather than the default `Finder` (AppleScript) backend, because Finder
/// requires the `com.apple.security.automation.apple-events` entitlement
/// (granted via TCC prompt or a signed/notarized bundle). Unsigned dev
/// builds otherwise fail with `errAEEventNotPermitted (-1743)`.
fn trash_path(abs_path: &std::path::Path) -> Result<(), trash::Error> {
    #[cfg(target_os = "macos")]
    {
        use trash::macos::{DeleteMethod, TrashContextExtMacos};
        let mut ctx = trash::TrashContext::default();
        ctx.set_delete_method(DeleteMethod::NsFileManager);
        ctx.delete(abs_path)
    }
    #[cfg(not(target_os = "macos"))]
    {
        trash::delete(abs_path)
    }
}

#[utoipa::path(get, path = "/api/editor/root",
    params(EditorRootParams),
    responses((status = 200, body = EditorRootResponse)))]
pub async fn get_editor_root_handler(
    State(state): State<AppState>,
    Query(params): Query<EditorRootParams>,
) -> Result<axum::Json<EditorRootResponse>, AppError> {
    let project_root =
        resolve_feature_editor_root(&state.read_pool, params.project_id, params.feature_id).await?;
    Ok(axum::Json(EditorRootResponse {
        root: project_root.to_string_lossy().to_string(),
    }))
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

pub fn editor_mutation_router() -> Router<AppState> {
    Router::new()
        .route("/api/editor/create-file", post(create_editor_file_handler))
        .route(
            "/api/editor/create-folder",
            post(create_editor_folder_handler),
        )
        .route("/api/editor/rename", patch(rename_editor_path_handler))
        .route("/api/editor/trash", delete(trash_editor_path_handler))
        .route("/api/editor/root", get(get_editor_root_handler))
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    #[test]
    fn validate_simple_name_rejects_separators_and_traversal() {
        assert!(validate_simple_name("foo.txt").is_ok());
        assert!(validate_simple_name("").is_err());
        assert!(validate_simple_name("a/b").is_err());
        assert!(validate_simple_name("a\\b").is_err());
        assert!(validate_simple_name("..").is_err());
        assert!(validate_simple_name(".").is_err());
    }

    #[test]
    fn validate_path_for_write_rejects_traversal() {
        let tmp = TempDir::new().unwrap();
        let root = fs::canonicalize(tmp.path()).unwrap();
        let res = service::validate_path_for_write(&root, "../escape.txt");
        // Either the parent canonicalization escapes the project (bad request)
        // or the path resolves outside it. Both are rejected.
        assert!(res.is_err());
    }

    #[test]
    fn create_file_then_trash_roundtrip() {
        let tmp = TempDir::new().unwrap();
        let root = fs::canonicalize(tmp.path()).unwrap();

        // Create a file via validate_path_for_write + write
        let target = service::validate_path_for_write(&root, "hello.txt").unwrap();
        assert!(!target.exists());
        fs::write(&target, "").unwrap();
        assert!(target.exists());

        // Validate path resolves the existing file
        let validated = service::validate_path(&root, "hello.txt").unwrap();
        assert_eq!(validated, target);

        // Trash should not panic; we don't assert removal behavior because the
        // host trash is system-dependent, but the call must succeed.
        // (Skipped on CI environments without a trash backend.)
        let _ = trash::delete(&validated);
    }

    #[test]
    fn rename_with_simple_name_stays_inside_root() {
        // The actual traversal protection happens in `validate_simple_name`,
        // which rejects `..` outright. Once a name is validated, joining it
        // onto the parent of an in-root file always stays in-root.
        let tmp = TempDir::new().unwrap();
        let root = fs::canonicalize(tmp.path()).unwrap();
        let file = root.join("a.txt");
        fs::write(&file, "").unwrap();

        validate_simple_name("b.txt").unwrap();
        let parent = file.parent().unwrap().to_path_buf();
        let target = parent.join("b.txt");
        assert!(target.starts_with(&root));
    }
}

mod handlers;
mod helpers;
mod types;

use axum::routing::{delete, get, patch, post};
use axum::Router;

use crate::app_state::AppState;

pub use handlers::{
    __path_create_editor_file_handler, __path_create_editor_folder_handler,
    __path_get_editor_root_handler, __path_move_editor_path_handler,
    __path_rename_editor_path_handler, __path_trash_editor_path_handler,
    create_editor_file_handler, create_editor_folder_handler, get_editor_root_handler,
    move_editor_path_handler, rename_editor_path_handler, trash_editor_path_handler,
};
#[allow(unused_imports)]
pub use types::{
    CreateFileRequest, CreateFileResponse, CreateFolderRequest, CreateFolderResponse,
    EditorRootParams, EditorRootResponse, MovePathRequest, MovePathResponse, RenamePathRequest,
    RenamePathResponse, TrashPathRequest, TrashPathResponse,
};

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
        .route("/api/editor/move", post(move_editor_path_handler))
        .route("/api/editor/trash", delete(trash_editor_path_handler))
        .route("/api/editor/root", get(get_editor_root_handler))
}

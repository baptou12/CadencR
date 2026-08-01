//! The conversation an agent edits a theme in.
//!
//! Editing a theme with an agent is the ordinary Cadencr conversation, pointed
//! at the theme's own folder instead of a repository. Rather than teach the
//! runtime a second notion of "where does this agent run", a theme gets what
//! every conversation already has — a project row whose `path` *is* the theme
//! directory, and one feature inside it. Every existing path (session init,
//! prompt send, checkpoints) then resolves the right cwd with no special case.
//!
//! What makes it invisible is `projects.kind`: a `system` project is filtered
//! out of the project list, the unified agents grid and the MCP workspace
//! tools, so the user's sidebar never grows a row per theme.
//!
//! Both halves are created lazily on first open and torn down with the theme.

use sqlx::SqlitePool;

use crate::domain::projects::models::SYSTEM_PROJECT_KIND;
use crate::error::AppError;

use super::paths;

/// Where a theme's conversation lives. The renderer needs all three to mount an
/// agent session: the ws session id is derived from `feature_id`.
#[derive(Debug, Clone, serde::Serialize, utoipa::ToSchema)]
pub struct ThemeWorkspace {
    pub project_id: i64,
    pub feature_id: i64,
    /// The theme directory — the agent's working directory.
    pub cwd: String,
}

/// The theme's conversation, creating it if this is the first time the user has
/// opened the theme with an agent. Idempotent: the same theme always resolves
/// to the same feature, so the conversation persists across opens.
pub async fn ensure(pool: &SqlitePool, theme_id: &str) -> Result<ThemeWorkspace, AppError> {
    // Reading the theme first makes an unknown id a 404 before anything is
    // written, and gives the conversation a name the user recognizes.
    let theme = super::store::get(theme_id).await?;
    let dir = paths::theme_dir(theme_id)?;
    let cwd = dir.to_string_lossy().to_string();

    let project_id = ensure_project(pool, theme_id, &cwd).await?;
    let title = theme
        .theme
        .map(|document| document.label)
        .or(theme.label)
        .unwrap_or_else(|| theme_id.to_string());
    let feature_id = ensure_feature(pool, project_id, &title).await?;
    Ok(ThemeWorkspace {
        project_id,
        feature_id,
        cwd,
    })
}

/// Drop the conversation for a deleted theme. Best-effort by design: the theme
/// file is already gone, and leaving a project row pointing at a directory that
/// no longer exists is worse than failing to report a cleanup error.
pub async fn remove(pool: &SqlitePool, theme_id: &str) {
    let Ok(dir) = paths::theme_dir(theme_id) else {
        return;
    };
    let cwd = dir.to_string_lossy().to_string();
    match find_project(pool, &cwd).await {
        Ok(Some(project_id)) => {
            if let Err(e) =
                crate::domain::projects::repository::delete_project(pool, project_id).await
            {
                tracing::warn!(
                    theme_id,
                    project_id,
                    "failed to delete theme workspace: {e}"
                );
            }
        }
        Ok(None) => {}
        Err(e) => tracing::warn!(theme_id, "failed to look up theme workspace: {e}"),
    }
}

async fn find_project(pool: &SqlitePool, cwd: &str) -> Result<Option<i64>, AppError> {
    Ok(
        sqlx::query_scalar("SELECT id FROM projects WHERE path = ? AND kind = ?")
            .bind(cwd)
            .bind(SYSTEM_PROJECT_KIND)
            .fetch_optional(pool)
            .await?,
    )
}

async fn ensure_project(pool: &SqlitePool, theme_id: &str, cwd: &str) -> Result<i64, AppError> {
    if let Some(id) = find_project(pool, cwd).await? {
        return Ok(id);
    }
    // Named from the slug rather than the label: a project name has to survive
    // being used as a settings filename, and the slug already is one.
    Ok(
        sqlx::query_scalar("INSERT INTO projects (name, path, kind) VALUES (?, ?, ?) RETURNING id")
            .bind(theme_id)
            .bind(cwd)
            .bind(SYSTEM_PROJECT_KIND)
            .fetch_one(pool)
            .await?,
    )
}

async fn ensure_feature(pool: &SqlitePool, project_id: i64, title: &str) -> Result<i64, AppError> {
    let existing: Option<i64> =
        sqlx::query_scalar("SELECT id FROM features WHERE project_id = ? ORDER BY id LIMIT 1")
            .bind(project_id)
            .fetch_optional(pool)
            .await?;
    if let Some(id) = existing {
        return Ok(id);
    }
    let feature_id: i64 = sqlx::query_scalar(
        "INSERT INTO features (project_id, title, status, type) \
         VALUES (?, ?, 'active', 'ws-session') RETURNING id",
    )
    .bind(project_id)
    .bind(title)
    .fetch_one(pool)
    .await?;
    // A theme folder is not a repository, so there is nothing to branch or to
    // create a worktree from. Pinning the mode here is what removes the branch
    // and worktree choices from the conversation entirely.
    sqlx::query(
        "INSERT INTO feature_settings (feature_id, key, value) VALUES (?, 'worktree_mode', 'skip')",
    )
    .bind(feature_id)
    .execute(pool)
    .await?;
    Ok(feature_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::themes::test_support::{dracula_css_vars, dracula_xterm};

    async fn pool() -> SqlitePool {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        crate::shared::migrate::run_migrations(
            &crate::shared::migrate::MigrationContext::pool_only(&pool),
        )
        .await
        .unwrap();
        pool
    }

    async fn create_theme(label: &str) -> String {
        super::super::store::create(
            label,
            super::super::models::ThemeAppearance::Dark,
            dracula_css_vars(),
            dracula_xterm(),
        )
        .await
        .expect("creates")
        .id
    }

    #[tokio::test]
    async fn creates_the_conversation_in_the_theme_folder() {
        let pool = pool().await;
        let id = create_theme("My Theme").await;
        let workspace = ensure(&pool, &id).await.expect("ensures");
        assert!(
            workspace.cwd.ends_with("themes/my-theme"),
            "{}",
            workspace.cwd
        );

        let mode: String = sqlx::query_scalar(
            "SELECT value FROM feature_settings WHERE feature_id = ? AND key = 'worktree_mode'",
        )
        .bind(workspace.feature_id)
        .fetch_one(&pool)
        .await
        .expect("mode");
        assert_eq!(mode, "skip", "a theme folder has no branches to choose");
    }

    #[tokio::test]
    async fn reopening_a_theme_resumes_the_same_conversation() {
        let pool = pool().await;
        let id = create_theme("My Theme").await;
        let first = ensure(&pool, &id).await.expect("ensures");
        let second = ensure(&pool, &id).await.expect("ensures again");
        assert_eq!(first.feature_id, second.feature_id);
        assert_eq!(first.project_id, second.project_id);
    }

    #[tokio::test]
    async fn the_workspace_project_is_hidden_from_the_project_list() {
        let pool = pool().await;
        let id = create_theme("My Theme").await;
        ensure(&pool, &id).await.expect("ensures");
        let listed = crate::domain::projects::repository::list_projects(&pool)
            .await
            .expect("lists");
        assert!(listed.is_empty(), "{listed:?}");
    }

    #[tokio::test]
    async fn deleting_a_theme_takes_its_conversation_with_it() {
        let pool = pool().await;
        let id = create_theme("My Theme").await;
        let workspace = ensure(&pool, &id).await.expect("ensures");
        remove(&pool, &id).await;

        let projects: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM projects WHERE id = ?")
            .bind(workspace.project_id)
            .fetch_one(&pool)
            .await
            .expect("counts");
        let features: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM features WHERE id = ?")
            .bind(workspace.feature_id)
            .fetch_one(&pool)
            .await
            .expect("counts");
        assert_eq!((projects, features), (0, 0));
    }

    #[tokio::test]
    async fn an_unknown_theme_has_no_workspace() {
        let pool = pool().await;
        assert!(ensure(&pool, "nope").await.is_err());
    }
}

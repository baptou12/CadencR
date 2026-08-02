//! The project a theme is built in.
//!
//! A theme is edited the way everything else in Cadencr is edited: in a project,
//! with the file in the editor, an agent beside it and git underneath. Rather
//! than teach the runtime a second notion of "where does this agent run", a
//! theme gets what every conversation already has — a project row whose `path`
//! *is* the theme directory, and a conversation inside it. Every existing path
//! (session init, prompt send, checkpoints, the editor, the Git tab) then works
//! with no special case, and the theme file the app is watching is the very file
//! the agent writes, so the app restyles itself as it is edited.
//!
//! Two pieces of setup are what make that true rather than nearly true:
//!
//!  - The directory is made a git repository. A theme project is a project; the
//!    Git tab is where the user reads what the agent changed and how to undo it.
//!  - Worktrees are off (`skip`, as the feature setting and the project
//!    default). A worktree would hand the agent a *copy* of the theme somewhere
//!    else, and the live app would go on painting from a file nobody edits.
//!
//! `projects.kind = 'theme'` hides none of this — it is how the theme finds its
//! project again, to open it, rename it and delete it.

use std::path::Path;

use sqlx::SqlitePool;
use tokio::sync::broadcast;

use crate::domain::projects::models::THEME_PROJECT_KIND;
use crate::error::AppError;
use crate::shared::git_cli::{run_git, run_git_with_env};

use super::paths;

/// Cadencr authors the first commit itself: a fresh theme repository inherits no
/// identity of its own, and `git commit` refuses without one.
const COMMIT_IDENTITY: [(&str, &str); 4] = [
    ("GIT_AUTHOR_NAME", "Cadencr"),
    ("GIT_AUTHOR_EMAIL", "themes@cadencr.local"),
    ("GIT_COMMITTER_NAME", "Cadencr"),
    ("GIT_COMMITTER_EMAIL", "themes@cadencr.local"),
];

/// Atomic saves stage through `.theme.json.tmp`; it exists for microseconds and
/// is nobody's change.
const GITIGNORE: &str = ".*.tmp\n";

/// Where a theme is edited. The renderer needs all three to route to the
/// conversation; the ws session id is derived from `feature_id`.
#[derive(Debug, Clone, serde::Serialize, utoipa::ToSchema)]
pub struct ThemeWorkspace {
    pub project_id: i64,
    pub feature_id: i64,
    /// The theme directory — the project root, and the agent's cwd.
    pub cwd: String,
}

/// The theme's project, creating it if this is the first time the theme has been
/// opened. Idempotent: the same theme always resolves to the same project and
/// conversation, so the work persists across opens.
pub async fn ensure(pool: &SqlitePool, theme_id: &str) -> Result<ThemeWorkspace, AppError> {
    // Reading the theme first makes an unknown id a 404 before anything is
    // written, and gives the project the name the user recognizes.
    let theme = super::store::get(theme_id).await?;
    let dir = paths::theme_dir(theme_id)?;
    let cwd = dir.to_string_lossy().to_string();
    let label = theme_label(&theme).unwrap_or_else(|| theme_id.to_string());

    ensure_repository(&dir).await?;
    let name = project_name(Some(&label), theme_id);
    let project_id = ensure_project(pool, &name, &cwd).await?;
    // Not only at creation: the theme may have been renamed while nothing was
    // watching — by the user's own editor, or before this ran at all.
    rename_project(pool, project_id, &name).await?;
    let feature_id = ensure_feature(pool, project_id, &label).await?;
    Ok(ThemeWorkspace {
        project_id,
        feature_id,
        cwd,
    })
}

/// Rename theme projects for as long as the service runs.
///
/// Renaming a theme is editing one string in a file, which an agent does without
/// telling anyone. Riding the watcher's event means the sidebar follows the same
/// write that repaints the app.
pub async fn watch_renames(
    pool: SqlitePool,
    mut events: broadcast::Receiver<super::ThemesChangeEvent>,
) {
    loop {
        match events.recv().await {
            Ok(event) => {
                if let Err(e) = sync_project_name(&pool, &event.id).await {
                    tracing::warn!(theme_id = %event.id, "failed to rename theme project: {e}");
                }
            }
            // A burst of saves outran the buffer; the next event still carries
            // the current label, so there is nothing to catch up on.
            Err(broadcast::error::RecvError::Lagged(_)) => {}
            Err(broadcast::error::RecvError::Closed) => return,
        }
    }
}

/// Follow a renamed theme in the sidebar.
///
/// The label lives in the file, so it can change without anyone calling an API —
/// an agent rewriting `theme.json` is the normal case.
pub async fn sync_project_name(pool: &SqlitePool, theme_id: &str) -> Result<(), AppError> {
    let Ok(dir) = paths::theme_dir(theme_id) else {
        return Ok(());
    };
    let cwd = dir.to_string_lossy().to_string();
    let Some(project_id) = find_project(pool, &cwd).await? else {
        return Ok(());
    };
    let theme = super::store::get(theme_id).await?;
    let name = project_name(theme_label(&theme).as_deref(), theme_id);
    rename_project(pool, project_id, &name).await
}

async fn rename_project(pool: &SqlitePool, project_id: i64, name: &str) -> Result<(), AppError> {
    let renamed = sqlx::query("UPDATE projects SET name = ? WHERE id = ? AND name != ?")
        .bind(name)
        .bind(project_id)
        .bind(name)
        .execute(pool)
        .await?
        .rows_affected();
    // A project's settings live in a file named after the project, so a rename
    // moves them. Re-assert the ones this project can't work without.
    if renamed > 0 {
        apply_project_defaults(pool, project_id).await?;
    }
    Ok(())
}

/// Drop the project for a deleted theme. Best-effort by design: the theme file
/// is already gone, and leaving a project pointing at a directory that no longer
/// exists is worse than failing to report a cleanup error.
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
                tracing::warn!(theme_id, project_id, "failed to delete theme project: {e}");
            }
        }
        Ok(None) => {}
        Err(e) => tracing::warn!(theme_id, "failed to look up theme project: {e}"),
    }
}

fn theme_label(theme: &super::models::UserTheme) -> Option<String> {
    theme
        .theme
        .as_ref()
        .map(|document| document.label.clone())
        .or_else(|| theme.label.clone())
}

/// The sidebar name for a theme's project.
///
/// Prefixed rather than bare, for one reason that matters: project settings are
/// stored in a file named after the project, so a theme sharing a name with one
/// of the user's own projects would share its settings — including the worktree
/// default below. The prefix also answers, in the one line the sidebar shows,
/// why this project exists.
///
/// A label that a project name is not allowed to contain — the same shapes
/// `projects::service` rejects — falls back to the slug the theme is stored
/// under, which is a valid name by construction.
fn project_name(label: Option<&str>, theme_id: &str) -> String {
    let trimmed = label.unwrap_or_default().trim();
    let usable =
        !trimmed.is_empty() && !trimmed.contains("..") && !trimmed.contains(['/', '\\', '\0']);
    format!("Theme: {}", if usable { trimmed } else { theme_id })
}

/// Make the theme directory a repository, once. A theme project without git
/// would be the one project in the app with no answer to "what did the agent
/// just do to my colors, and how do I put it back".
async fn ensure_repository(dir: &Path) -> Result<(), AppError> {
    if dir.join(".git").exists() {
        return Ok(());
    }
    std::fs::write(dir.join(".gitignore"), GITIGNORE)
        .map_err(|e| AppError::Internal(format!("failed to write the theme's .gitignore: {e}")))?;
    run_git(&["init", "-q", "-b", "main"], dir).await?;
    run_git(&["add", "-A"], dir).await?;
    // `-c commit.gpgsign=false`: this commit is Cadencr's, not the user's, and a
    // global signing config would otherwise stop it on a key prompt.
    run_git_with_env(
        &["-c", "commit.gpgsign=false", "commit", "-qm", "New theme"],
        dir,
        &COMMIT_IDENTITY,
    )
    .await?;
    Ok(())
}

async fn find_project(pool: &SqlitePool, cwd: &str) -> Result<Option<i64>, AppError> {
    Ok(
        sqlx::query_scalar("SELECT id FROM projects WHERE path = ? AND kind = ?")
            .bind(cwd)
            .bind(THEME_PROJECT_KIND)
            .fetch_optional(pool)
            .await?,
    )
}

async fn ensure_project(pool: &SqlitePool, name: &str, cwd: &str) -> Result<i64, AppError> {
    if let Some(id) = find_project(pool, cwd).await? {
        return Ok(id);
    }
    let project_id: i64 =
        sqlx::query_scalar("INSERT INTO projects (name, path, kind) VALUES (?, ?, ?) RETURNING id")
            .bind(name)
            .bind(cwd)
            .bind(THEME_PROJECT_KIND)
            .fetch_one(pool)
            .await?;
    apply_project_defaults(pool, project_id).await?;
    Ok(project_id)
}

/// Every conversation started here, not just the first, has to edit the theme in
/// place — see the module header.
async fn apply_project_defaults(pool: &SqlitePool, project_id: i64) -> Result<(), AppError> {
    crate::domain::projects::repository::set_project_setting(
        pool,
        project_id,
        "default_worktree_mode",
        "skip",
    )
    .await
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

    /// Retitle the theme the way anything outside the API does it: by editing
    /// the file.
    fn rename_theme_file(id: &str, label: &str) {
        let file = paths::theme_file(id).expect("path");
        let renamed = std::fs::read_to_string(&file)
            .expect("read")
            .replace("\"My Theme\"", &format!("\"{label}\""));
        std::fs::write(&file, renamed).expect("write");
    }

    async fn project_name_of(pool: &SqlitePool, project_id: i64) -> String {
        sqlx::query_scalar("SELECT name FROM projects WHERE id = ?")
            .bind(project_id)
            .fetch_one(pool)
            .await
            .expect("name")
    }

    #[tokio::test]
    async fn creates_a_project_rooted_in_the_theme_folder() {
        let pool = pool().await;
        let id = create_theme("My Theme").await;
        let workspace = ensure(&pool, &id).await.expect("ensures");
        assert!(
            workspace.cwd.ends_with("themes/my-theme"),
            "{}",
            workspace.cwd
        );
        assert_eq!(
            project_name_of(&pool, workspace.project_id).await,
            "Theme: My Theme"
        );

        // Both, not either: the feature setting governs this conversation, and
        // the project default governs the next one the user starts here.
        let feature_mode: String = sqlx::query_scalar(
            "SELECT value FROM feature_settings WHERE feature_id = ? AND key = 'worktree_mode'",
        )
        .bind(workspace.feature_id)
        .fetch_one(&pool)
        .await
        .expect("feature worktree_mode");
        let project_mode = crate::domain::settings_store::project_get(
            &pool,
            workspace.project_id,
            "default_worktree_mode",
        )
        .await
        .expect("project settings");
        assert_eq!(
            (feature_mode.as_str(), project_mode.as_deref()),
            ("skip", Some("skip")),
            "a worktree would hide the edits from the running app"
        );
    }

    #[tokio::test]
    async fn the_theme_folder_is_a_repository_with_the_theme_committed() {
        let pool = pool().await;
        let id = create_theme("My Theme").await;
        let workspace = ensure(&pool, &id).await.expect("ensures");
        let dir = Path::new(&workspace.cwd);

        let tracked = run_git(&["ls-files"], dir).await.expect("ls-files");
        assert!(tracked.contains("theme.json"), "{tracked}");
        // Nothing pending right after creation: the Git tab has to mean "what
        // changed since you started", not "everything".
        let status = run_git(&["status", "--porcelain"], dir)
            .await
            .expect("status");
        assert_eq!(status.trim(), "", "unexpected pending changes");
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
    async fn reopening_catches_up_on_a_rename_nothing_was_watching() {
        let pool = pool().await;
        let id = create_theme("My Theme").await;
        let workspace = ensure(&pool, &id).await.expect("ensures");
        rename_theme_file(&id, "Vamp");

        ensure(&pool, &id).await.expect("ensures again");

        assert_eq!(
            project_name_of(&pool, workspace.project_id).await,
            "Theme: Vamp"
        );
    }

    #[tokio::test]
    async fn the_theme_project_is_listed_like_any_other() {
        let pool = pool().await;
        let id = create_theme("My Theme").await;
        let workspace = ensure(&pool, &id).await.expect("ensures");
        let listed = crate::domain::projects::repository::list_projects(&pool)
            .await
            .expect("lists");
        assert_eq!(listed.len(), 1, "{listed:?}");
        assert_eq!(listed[0].id, workspace.project_id);
    }

    #[tokio::test]
    async fn renaming_the_theme_renames_the_project() {
        let pool = pool().await;
        let id = create_theme("My Theme").await;
        let workspace = ensure(&pool, &id).await.expect("ensures");

        rename_theme_file(&id, "Vamp");
        sync_project_name(&pool, &id).await.expect("syncs");

        assert_eq!(
            project_name_of(&pool, workspace.project_id).await,
            "Theme: Vamp"
        );
        // The settings file is named after the project, so the rename left the
        // old one behind — the defaults have to come with it.
        let mode = crate::domain::settings_store::project_get(
            &pool,
            workspace.project_id,
            "default_worktree_mode",
        )
        .await
        .expect("project settings");
        assert_eq!(mode.as_deref(), Some("skip"));
    }

    #[tokio::test]
    async fn deleting_a_theme_takes_its_project_with_it() {
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
    async fn an_unknown_theme_has_no_project() {
        let pool = pool().await;
        assert!(ensure(&pool, "nope").await.is_err());
    }

    #[test]
    fn a_label_a_project_cannot_be_named_falls_back_to_the_slug() {
        assert_eq!(project_name(Some("  Vamp  "), "vamp"), "Theme: Vamp");
        for label in ["", "   ", "a/b", "../evil"] {
            let named = project_name(Some(label), "my-theme");
            assert_eq!(named, "Theme: my-theme", "{label}");
        }
        assert_eq!(project_name(None, "my-theme"), "Theme: my-theme");
    }
}

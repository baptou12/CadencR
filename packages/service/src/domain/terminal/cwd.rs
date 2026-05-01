use sqlx::SqlitePool;

use crate::domain::git::repository::get_project_path;
use crate::domain::workflow::worktree::get_setting;
use crate::error::AppError;

/// Resolve the working directory for a terminal: feature worktree if set and
/// alive on disk, otherwise project path.
pub async fn resolve_cwd(
    pool: &SqlitePool,
    feature_id: i64,
    project_id: i64,
) -> Result<String, AppError> {
    if let Some(path) = get_setting(pool, feature_id, "worktree_path").await {
        if std::path::Path::new(&path).exists() {
            return Ok(path);
        }
    }
    get_project_path(pool, project_id).await
}

/// Same as [`resolve_cwd`] but honours `requested_cwd` when it matches the
/// feature's worktree path or the project path. Lets the frontend pin a fresh
/// PTY to the directory it just observed (e.g. on "Restart here") instead of
/// depending on a second snapshot read that may not have caught up with the
/// most recent write. Invalid input is silently downgraded to `resolve_cwd`.
pub async fn resolve_pty_cwd(
    pool: &SqlitePool,
    feature_id: i64,
    project_id: i64,
    requested_cwd: Option<&str>,
) -> Result<String, AppError> {
    let Some(req) = requested_cwd.filter(|s| !s.is_empty()) else {
        return resolve_cwd(pool, feature_id, project_id).await;
    };
    if !std::path::Path::new(req).exists() {
        return resolve_cwd(pool, feature_id, project_id).await;
    }
    if get_setting(pool, feature_id, "worktree_path")
        .await
        .as_deref()
        == Some(req)
    {
        return Ok(req.to_string());
    }
    if get_project_path(pool, project_id).await.ok().as_deref() == Some(req) {
        return Ok(req.to_string());
    }
    resolve_cwd(pool, feature_id, project_id).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::SqlitePoolOptions;

    async fn setup_db() -> SqlitePool {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::query("CREATE TABLE projects (id INTEGER PRIMARY KEY, name TEXT, path TEXT)")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query(
            "CREATE TABLE feature_settings (feature_id INTEGER, key TEXT, value TEXT, PRIMARY KEY (feature_id, key))",
        )
        .execute(&pool)
        .await
        .unwrap();
        pool
    }

    fn temp_dir() -> String {
        std::env::temp_dir().to_string_lossy().into_owned()
    }

    #[tokio::test]
    async fn resolve_pty_cwd_honours_requested_when_it_matches_worktree() {
        let pool = setup_db().await;
        let cwd = temp_dir();
        sqlx::query("INSERT INTO projects (id, name, path) VALUES (1, 'p', '/nope')")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query(
            "INSERT INTO feature_settings (feature_id, key, value) VALUES (1, 'worktree_path', ?)",
        )
        .bind(&cwd)
        .execute(&pool)
        .await
        .unwrap();

        let resolved = resolve_pty_cwd(&pool, 1, 1, Some(&cwd)).await.unwrap();
        assert_eq!(resolved, cwd);
    }

    #[tokio::test]
    async fn resolve_pty_cwd_honours_requested_when_it_matches_project_path() {
        let pool = setup_db().await;
        let cwd = temp_dir();
        sqlx::query("INSERT INTO projects (id, name, path) VALUES (1, 'p', ?)")
            .bind(&cwd)
            .execute(&pool)
            .await
            .unwrap();

        let resolved = resolve_pty_cwd(&pool, 1, 1, Some(&cwd)).await.unwrap();
        assert_eq!(resolved, cwd);
    }

    #[tokio::test]
    async fn resolve_pty_cwd_rejects_arbitrary_paths() {
        let pool = setup_db().await;
        let project_path = temp_dir();
        sqlx::query("INSERT INTO projects (id, name, path) VALUES (1, 'p', ?)")
            .bind(&project_path)
            .execute(&pool)
            .await
            .unwrap();

        let resolved = resolve_pty_cwd(&pool, 1, 1, Some("/etc")).await.unwrap();
        assert_eq!(resolved, project_path);
    }

    #[tokio::test]
    async fn resolve_pty_cwd_falls_back_when_requested_is_none() {
        let pool = setup_db().await;
        let project_path = temp_dir();
        sqlx::query("INSERT INTO projects (id, name, path) VALUES (1, 'p', ?)")
            .bind(&project_path)
            .execute(&pool)
            .await
            .unwrap();

        let resolved = resolve_pty_cwd(&pool, 1, 1, None).await.unwrap();
        assert_eq!(resolved, project_path);
    }
}

use super::models::{Project, ProjectModelSettings, ProjectProviderSettings, ProjectSetting};
use crate::domain::agents::runtime::{runtime_setting_key, validate_agent_type};
use crate::error::AppError;
use sqlx::SqlitePool;

pub async fn list_projects(pool: &SqlitePool) -> Result<Vec<Project>, AppError> {
    let rows = sqlx::query_as::<_, (i64, String, String, Option<String>, String)>(
        r#"WITH latest_project_activity AS (
               SELECT
                   f.project_id,
                   MAX(datetime(COALESCE(am.created_at, s.started_at, f.created_at))) AS activity_at
               FROM features f
               LEFT JOIN agent_sessions s ON s.feature_id = f.id
               LEFT JOIN agent_messages am ON am.session_id = s.id
               GROUP BY f.project_id
           )
           SELECT p.id, p.name, p.path, p.branch_prefix, p.created_at
           FROM projects p
           LEFT JOIN latest_project_activity activity ON activity.project_id = p.id
           ORDER BY COALESCE(activity.activity_at, datetime(p.created_at)) DESC, p.id DESC"#,
    )
    .fetch_all(pool)
    .await?;

    Ok(rows
        .into_iter()
        .map(|(id, name, path, branch_prefix, created_at)| Project {
            id,
            name,
            path,
            branch_prefix,
            created_at,
        })
        .collect())
}

pub async fn create_project(
    pool: &SqlitePool,
    name: &str,
    path: &str,
) -> Result<Project, AppError> {
    let id = sqlx::query("INSERT INTO projects (name, path) VALUES (?, ?)")
        .bind(name)
        .bind(path)
        .execute(pool)
        .await?
        .last_insert_rowid();

    let row = sqlx::query_as::<_, (i64, String, String, Option<String>, String)>(
        "SELECT id, name, path, branch_prefix, created_at FROM projects WHERE id = ?",
    )
    .bind(id)
    .fetch_one(pool)
    .await?;

    Ok(Project {
        id: row.0,
        name: row.1,
        path: row.2,
        branch_prefix: row.3,
        created_at: row.4,
    })
}

pub async fn delete_project(pool: &SqlitePool, id: i64) -> Result<(), AppError> {
    let mut tx = pool.begin().await?;

    let feature_ids: Vec<i64> =
        sqlx::query_as::<_, (i64,)>("SELECT id FROM features WHERE project_id = ?")
            .bind(id)
            .fetch_all(&mut *tx)
            .await?
            .into_iter()
            .map(|r| r.0)
            .collect();

    if !feature_ids.is_empty() {
        let ph = feature_ids
            .iter()
            .map(|_| "?")
            .collect::<Vec<_>>()
            .join(",");

        let session_ids: Vec<i64> = {
            let query = format!("SELECT id FROM agent_sessions WHERE feature_id IN ({})", ph);
            let mut q = sqlx::query_as::<_, (i64,)>(&query);
            for fid in &feature_ids {
                q = q.bind(fid);
            }
            q.fetch_all(&mut *tx)
                .await?
                .into_iter()
                .map(|r| r.0)
                .collect()
        };

        if !session_ids.is_empty() {
            let sp = session_ids
                .iter()
                .map(|_| "?")
                .collect::<Vec<_>>()
                .join(",");
            let query = format!("DELETE FROM agent_messages WHERE session_id IN ({})", sp);
            let mut q = sqlx::query(&query);
            for sid in &session_ids {
                q = q.bind(sid);
            }
            q.execute(&mut *tx).await?;
        }

        {
            let query = format!("DELETE FROM agent_sessions WHERE feature_id IN ({})", ph);
            let mut q = sqlx::query(&query);
            for fid in &feature_ids {
                q = q.bind(fid);
            }
            q.execute(&mut *tx).await?;
        }
        {
            let query = format!("DELETE FROM feature_settings WHERE feature_id IN ({})", ph);
            let mut q = sqlx::query(&query);
            for fid in &feature_ids {
                q = q.bind(fid);
            }
            q.execute(&mut *tx).await?;
        }
        {
            let query = format!("DELETE FROM diff_viewed_files WHERE feature_id IN ({})", ph);
            let mut q = sqlx::query(&query);
            for fid in &feature_ids {
                q = q.bind(fid);
            }
            q.execute(&mut *tx).await?;
        }
        sqlx::query("DELETE FROM features WHERE project_id = ?")
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }

    sqlx::query("DELETE FROM project_settings WHERE project_id = ?")
        .bind(id)
        .execute(&mut *tx)
        .await?;

    sqlx::query("DELETE FROM projects WHERE id = ?")
        .bind(id)
        .execute(&mut *tx)
        .await?;

    tx.commit().await?;
    Ok(())
}

pub async fn get_project_settings(
    pool: &SqlitePool,
    project_id: i64,
) -> Result<Vec<ProjectSetting>, AppError> {
    let column_row: Option<(Option<String>,)> =
        sqlx::query_as("SELECT branch_prefix FROM projects WHERE id = ?")
            .bind(project_id)
            .fetch_optional(pool)
            .await?;

    let mut settings: Vec<ProjectSetting> = Vec::new();

    if let Some((branch_prefix,)) = column_row {
        let column_settings = [("branch_prefix", branch_prefix)];
        for (key, value) in column_settings {
            if value.is_some() {
                settings.push(ProjectSetting {
                    key: key.to_string(),
                    value,
                });
            }
        }
    }

    let rows: Vec<(String, Option<String>)> =
        sqlx::query_as("SELECT key, value FROM project_settings WHERE project_id = ?")
            .bind(project_id)
            .fetch_all(pool)
            .await?;
    settings.extend(
        rows.into_iter()
            .map(|(key, value)| ProjectSetting { key, value }),
    );

    Ok(settings)
}

pub async fn set_project_setting(
    pool: &SqlitePool,
    project_id: i64,
    key: &str,
    value: &str,
) -> Result<(), AppError> {
    let real_columns = ["model_session", "branch_prefix", "agent_runtime_session"];

    if real_columns.contains(&key) {
        let query = format!("UPDATE projects SET \"{}\" = ? WHERE id = ?", key);
        sqlx::query(&query)
            .bind(value)
            .bind(project_id)
            .execute(pool)
            .await?;
    } else {
        sqlx::query(
            "INSERT INTO project_settings (project_id, key, value) VALUES (?, ?, ?) ON CONFLICT(project_id, key) DO UPDATE SET value = excluded.value",
        )
        .bind(project_id)
        .bind(key)
        .bind(value)
        .execute(pool)
        .await?;
    }
    Ok(())
}

pub async fn get_project_model_settings(
    pool: &SqlitePool,
    project_id: i64,
) -> Result<ProjectModelSettings, AppError> {
    let row: Option<(Option<String>,)> =
        sqlx::query_as("SELECT model_session FROM projects WHERE id = ?")
            .bind(project_id)
            .fetch_optional(pool)
            .await?;

    let (session,) = row.unwrap_or_default();

    Ok(ProjectModelSettings {
        session: session.unwrap_or_default(),
    })
}

pub async fn set_project_model_setting(
    pool: &SqlitePool,
    project_id: i64,
    model_type: &str,
    model: &str,
) -> Result<(), AppError> {
    if !validate_agent_type(model_type) {
        return Err(AppError::BadRequest(format!(
            "Invalid model type: {}",
            model_type
        )));
    }
    crate::domain::agents::runtime::reject_workspace_only(model_type, "project")?;
    let col = format!("model_{}", model_type);
    let query = format!("UPDATE projects SET \"{}\" = ? WHERE id = ?", col);
    sqlx::query(&query)
        .bind(model)
        .bind(project_id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn get_project_provider_settings(
    pool: &SqlitePool,
    project_id: i64,
) -> Result<ProjectProviderSettings, AppError> {
    let row: Option<(Option<String>,)> =
        sqlx::query_as("SELECT agent_runtime_session FROM projects WHERE id = ?")
            .bind(project_id)
            .fetch_optional(pool)
            .await?;

    let (session,) = row.unwrap_or_default();

    Ok(ProjectProviderSettings {
        session: session.unwrap_or_default(),
        auto_name: String::new(),
    })
}

pub async fn set_project_provider_setting(
    pool: &SqlitePool,
    project_id: i64,
    provider_type: &str,
    provider: &str,
) -> Result<(), AppError> {
    if !validate_agent_type(provider_type) {
        return Err(AppError::BadRequest(format!(
            "Invalid provider type: {}",
            provider_type
        )));
    }
    crate::domain::agents::runtime::reject_workspace_only(provider_type, "project")?;
    let col = runtime_setting_key(provider_type);
    let query = format!("UPDATE projects SET \"{}\" = ? WHERE id = ?", col);
    sqlx::query(&query)
        .bind(provider)
        .bind(project_id)
        .execute(pool)
        .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::SqlitePoolOptions;

    async fn setup_test_db() -> SqlitePool {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();

        sqlx::query(
            r#"CREATE TABLE projects (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                path TEXT NOT NULL,
                branch_prefix TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                model_session TEXT,
                agent_runtime_session TEXT
            )"#,
        )
        .execute(&pool)
        .await
        .unwrap();

        sqlx::query(
            "CREATE TABLE features (id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL, title TEXT, type TEXT NOT NULL DEFAULT 'ws-session', created_at TEXT DEFAULT (datetime('now')))"
        ).execute(&pool).await.unwrap();

        sqlx::query(
            "CREATE TABLE agent_sessions (id INTEGER PRIMARY KEY AUTOINCREMENT, feature_id INTEGER NOT NULL, started_at TEXT)"
        ).execute(&pool).await.unwrap();

        sqlx::query(
            "CREATE TABLE agent_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id INTEGER NOT NULL, created_at TEXT DEFAULT (datetime('now')))"
        ).execute(&pool).await.unwrap();

        sqlx::query(
            "CREATE TABLE project_settings (project_id INTEGER NOT NULL, key TEXT NOT NULL, value TEXT, PRIMARY KEY(project_id, key))"
        ).execute(&pool).await.unwrap();

        sqlx::query(
            "CREATE TABLE diff_viewed_files (id INTEGER PRIMARY KEY AUTOINCREMENT, feature_id INTEGER NOT NULL)"
        ).execute(&pool).await.unwrap();

        sqlx::query(
            "CREATE TABLE feature_settings (feature_id INTEGER NOT NULL, key TEXT NOT NULL, value TEXT, PRIMARY KEY(feature_id, key))"
        ).execute(&pool).await.unwrap();

        pool
    }

    #[tokio::test]
    async fn test_create_and_list_projects() {
        let pool = setup_test_db().await;
        let p1 = create_project(&pool, "Alpha", "/tmp/alpha").await.unwrap();
        let p2 = create_project(&pool, "Beta", "/tmp/beta").await.unwrap();

        let projects = list_projects(&pool).await.unwrap();
        assert_eq!(projects.len(), 2);
        let names: Vec<&str> = projects.iter().map(|p| p.name.as_str()).collect();
        assert!(names.contains(&"Alpha"));
        assert!(names.contains(&"Beta"));
        assert_eq!(p1.name, "Alpha");
        assert_eq!(p2.path, "/tmp/beta");
    }

    #[tokio::test]
    async fn test_delete_project_cascade() {
        let pool = setup_test_db().await;
        let project = create_project(&pool, "Cascade", "/tmp/cascade")
            .await
            .unwrap();
        let pid = project.id;

        let fid: i64 = sqlx::query_as::<_, (i64,)>(
            "INSERT INTO features (project_id, title) VALUES (?, 'feat') RETURNING id",
        )
        .bind(pid)
        .fetch_one(&pool)
        .await
        .unwrap()
        .0;

        let session_id: i64 = sqlx::query_as::<_, (i64,)>(
            "INSERT INTO agent_sessions (feature_id) VALUES (?) RETURNING id",
        )
        .bind(fid)
        .fetch_one(&pool)
        .await
        .unwrap()
        .0;

        sqlx::query("INSERT INTO agent_messages (session_id) VALUES (?)")
            .bind(session_id)
            .execute(&pool)
            .await
            .unwrap();

        delete_project(&pool, pid).await.unwrap();

        let count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM projects WHERE id = ?")
            .bind(pid)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(count.0, 0);
        let count: (i64,) =
            sqlx::query_as("SELECT COUNT(*) FROM agent_messages WHERE session_id = ?")
                .bind(session_id)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(count.0, 0);
    }

    #[tokio::test]
    async fn test_set_project_setting_rejects_workspace_only_agent() {
        let pool = setup_test_db().await;
        let project = create_project(&pool, "WsOnly", "/tmp/wsonly")
            .await
            .unwrap();
        let err = set_project_model_setting(&pool, project.id, "auto_name", "haiku")
            .await
            .unwrap_err();
        assert!(matches!(err, AppError::BadRequest(_)));
    }
}

use super::models::{Project, ProjectModelSettings, ProjectProviderSettings, ProjectSetting};
use crate::domain::agents::runtime::{runtime_setting_key, validate_agent_type};
use crate::error::AppError;
use sqlx::SqlitePool;

pub async fn list_projects(pool: &SqlitePool) -> Result<Vec<Project>, AppError> {
    let rows = sqlx::query_as::<_, (i64, String, String, Option<String>, Option<String>, Option<String>, Option<String>, String)>(
        "SELECT id, name, path, branch_prefix, qa_prompt, agent_autonomy, parallel_execution, created_at FROM projects ORDER BY created_at DESC",
    )
    .fetch_all(pool)
    .await?;

    Ok(rows
        .into_iter()
        .map(
            |(
                id,
                name,
                path,
                branch_prefix,
                qa_prompt,
                agent_autonomy,
                parallel_execution,
                created_at,
            )| Project {
                id,
                name,
                path,
                branch_prefix,
                qa_prompt,
                agent_autonomy,
                parallel_execution,
                created_at,
            },
        )
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

    let row = sqlx::query_as::<_, (i64, String, String, Option<String>, Option<String>, Option<String>, Option<String>, String)>(
        "SELECT id, name, path, branch_prefix, qa_prompt, agent_autonomy, parallel_execution, created_at FROM projects WHERE id = ?",
    )
    .bind(id)
    .fetch_one(pool)
    .await?;

    Ok(Project {
        id: row.0,
        name: row.1,
        path: row.2,
        branch_prefix: row.3,
        qa_prompt: row.4,
        agent_autonomy: row.5,
        parallel_execution: row.6,
        created_at: row.7,
    })
}

pub async fn delete_project(pool: &SqlitePool, id: i64) -> Result<(), AppError> {
    let mut tx = pool.begin().await?;

    // Get feature IDs
    let feature_ids: Vec<i64> =
        sqlx::query_as::<_, (i64,)>("SELECT id FROM features WHERE project_id = ?")
            .bind(id)
            .fetch_all(&mut *tx)
            .await?
            .into_iter()
            .map(|r| r.0)
            .collect();

    if !feature_ids.is_empty() {
        // Get plan IDs and session IDs for these features
        let ph = feature_ids
            .iter()
            .map(|_| "?")
            .collect::<Vec<_>>()
            .join(",");

        let plan_ids: Vec<i64> = {
            let query = format!("SELECT id FROM plans WHERE feature_id IN ({})", ph);
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

        // Delete agent_messages for sessions
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

        // Delete phases for plans
        if !plan_ids.is_empty() {
            let pp = plan_ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
            let query = format!("DELETE FROM phases WHERE plan_id IN ({})", pp);
            let mut q = sqlx::query(&query);
            for pid in &plan_ids {
                q = q.bind(pid);
            }
            q.execute(&mut *tx).await?;
        }

        // Delete feature children
        {
            let query = format!("DELETE FROM agent_sessions WHERE feature_id IN ({})", ph);
            let mut q = sqlx::query(&query);
            for fid in &feature_ids {
                q = q.bind(fid);
            }
            q.execute(&mut *tx).await?;
        }
        {
            let query = format!("DELETE FROM plans WHERE feature_id IN ({})", ph);
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
        {
            let query = format!("DELETE FROM features WHERE project_id = ?");
            sqlx::query(&query).bind(id).execute(&mut *tx).await?;
        }
    }

    // Delete project children and project itself
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
    // Read known columns from the projects table
    let column_row: Option<(Option<String>, Option<String>, Option<String>, Option<String>)> =
        sqlx::query_as(
            "SELECT agent_autonomy, branch_prefix, qa_prompt, parallel_execution FROM projects WHERE id = ?"
        )
        .bind(project_id)
        .fetch_optional(pool)
        .await?;

    let mut settings: Vec<ProjectSetting> = Vec::new();

    if let Some((agent_autonomy, branch_prefix, qa_prompt, parallel_execution)) = column_row {
        let column_settings = [
            ("agent_autonomy", agent_autonomy),
            ("branch_prefix", branch_prefix),
            ("qa_prompt", qa_prompt),
            ("parallel_execution", parallel_execution),
        ];
        for (key, value) in column_settings {
            if value.is_some() {
                settings.push(ProjectSetting {
                    key: key.to_string(),
                    value,
                });
            }
        }
    }

    // Read additional settings from the key-value table
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
    let real_columns = [
        "model_plan",
        "model_prd",
        "model_execute",
        "model_risk",
        "model_review",
        "model_session",
        "model_qa",
        "agent_autonomy",
        "branch_prefix",
        "qa_prompt",
        "parallel_execution",
        "agent_runtime_plan",
        "agent_runtime_prd",
        "agent_runtime_execute",
        "agent_runtime_risk",
        "agent_runtime_review",
        "agent_runtime_review-fixer",
        "agent_runtime_session",
        "agent_runtime_qa",
        "agent_runtime_retro",
    ];

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
    let row: Option<(Option<String>, Option<String>, Option<String>, Option<String>, Option<String>, Option<String>, Option<String>, Option<String>, Option<String>)> = sqlx::query_as(
        r#"SELECT model_plan, model_prd, model_execute, model_risk, model_review, "model_review-fixer", model_session, model_qa, model_retro FROM projects WHERE id = ?"#,
    )
    .bind(project_id)
    .fetch_optional(pool)
    .await?;

    let (plan, prd, execute, risk, review, review_fixer, session, qa, retro) =
        row.unwrap_or_default();

    Ok(ProjectModelSettings {
        plan: plan.unwrap_or_default(),
        prd: prd.unwrap_or_default(),
        execute: execute.unwrap_or_default(),
        risk: risk.unwrap_or_default(),
        review: review.unwrap_or_default(),
        review_fixer: review_fixer.unwrap_or_default(),
        session: session.unwrap_or_default(),
        qa: qa.unwrap_or_default(),
        retro: retro.unwrap_or_default(),
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
    let row: Option<(
        Option<String>, Option<String>, Option<String>, Option<String>, Option<String>,
        Option<String>, Option<String>, Option<String>, Option<String>,
    )> = sqlx::query_as(
        r#"SELECT agent_runtime_plan, agent_runtime_prd, agent_runtime_execute, agent_runtime_risk,
           agent_runtime_review, "agent_runtime_review-fixer", agent_runtime_session, agent_runtime_qa,
           agent_runtime_retro FROM projects WHERE id = ?"#,
    )
    .bind(project_id)
    .fetch_optional(pool)
    .await?;

    let (plan, prd, execute, risk, review, review_fixer, session, qa, retro) =
        row.unwrap_or_default();

    // Return empty strings (not provider defaults) for unset fields so the
    // frontend inheritance cascade can distinguish "inherit from workspace"
    // from "explicit override to claude_code". The workspace endpoint still
    // falls back to defaults because it is the root of the cascade.
    // `auto_name` has no project-level override column — it's intentionally
    // a workspace-only agent type, so it always inherits (empty string).
    Ok(ProjectProviderSettings {
        plan: plan.unwrap_or_default(),
        prd: prd.unwrap_or_default(),
        execute: execute.unwrap_or_default(),
        risk: risk.unwrap_or_default(),
        review: review.unwrap_or_default(),
        review_fixer: review_fixer.unwrap_or_default(),
        session: session.unwrap_or_default(),
        qa: qa.unwrap_or_default(),
        retro: retro.unwrap_or_default(),
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
                qa_prompt TEXT,
                agent_autonomy TEXT,
                parallel_execution TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                model_plan TEXT,
                model_prd TEXT,
                model_execute TEXT,
                model_risk TEXT,
                model_review TEXT,
                "model_review-fixer" TEXT,
                model_session TEXT,
                model_qa TEXT,
                model_retro TEXT,
                agent_runtime_plan TEXT,
                agent_runtime_prd TEXT,
                agent_runtime_execute TEXT,
                agent_runtime_risk TEXT,
                agent_runtime_review TEXT,
                "agent_runtime_review-fixer" TEXT,
                agent_runtime_session TEXT,
                agent_runtime_qa TEXT,
                agent_runtime_retro TEXT
            )"#,
        )
        .execute(&pool)
        .await
        .unwrap();

        sqlx::query(
            "CREATE TABLE features (id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL, title TEXT, status TEXT DEFAULT 'draft', type TEXT NOT NULL DEFAULT 'feature')"
        ).execute(&pool).await.unwrap();

        sqlx::query(
            "CREATE TABLE plans (id INTEGER PRIMARY KEY AUTOINCREMENT, feature_id INTEGER NOT NULL)"
        ).execute(&pool).await.unwrap();

        sqlx::query(
            "CREATE TABLE phases (id INTEGER PRIMARY KEY AUTOINCREMENT, plan_id INTEGER NOT NULL)",
        )
        .execute(&pool)
        .await
        .unwrap();

        sqlx::query(
            "CREATE TABLE agent_sessions (id INTEGER PRIMARY KEY AUTOINCREMENT, feature_id INTEGER NOT NULL)"
        ).execute(&pool).await.unwrap();

        sqlx::query(
            "CREATE TABLE agent_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id INTEGER NOT NULL)"
        ).execute(&pool).await.unwrap();

        sqlx::query(
            "CREATE TABLE project_settings (project_id INTEGER NOT NULL, key TEXT NOT NULL, value TEXT, PRIMARY KEY(project_id, key))"
        ).execute(&pool).await.unwrap();

        sqlx::query(
            "CREATE TABLE diff_comments (id INTEGER PRIMARY KEY AUTOINCREMENT, feature_id INTEGER NOT NULL)"
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
    async fn test_list_projects_empty() {
        let pool = setup_test_db().await;
        let projects = list_projects(&pool).await.unwrap();
        assert!(projects.is_empty());
    }

    #[tokio::test]
    async fn test_create_and_list_projects() {
        let pool = setup_test_db().await;
        let p1 = create_project(&pool, "Alpha", "/tmp/alpha").await.unwrap();
        let p2 = create_project(&pool, "Beta", "/tmp/beta").await.unwrap();

        let projects = list_projects(&pool).await.unwrap();
        assert_eq!(projects.len(), 2);
        // ORDER BY created_at DESC — p2 was created last so comes first (same second, but rowid order)
        let names: Vec<&str> = projects.iter().map(|p| p.name.as_str()).collect();
        assert!(names.contains(&"Alpha"));
        assert!(names.contains(&"Beta"));
        assert_eq!(p1.name, "Alpha");
        assert_eq!(p2.path, "/tmp/beta");
    }

    #[tokio::test]
    async fn test_delete_project_cascade() {
        let pool = setup_test_db().await;

        // Create project
        let project = create_project(&pool, "Cascade", "/tmp/cascade")
            .await
            .unwrap();
        let pid = project.id;

        // Create feature
        let fid: i64 = sqlx::query_as::<_, (i64,)>(
            "INSERT INTO features (project_id, title) VALUES (?, 'feat') RETURNING id",
        )
        .bind(pid)
        .fetch_one(&pool)
        .await
        .unwrap()
        .0;

        // Create plan + phase
        let plan_id: i64 =
            sqlx::query_as::<_, (i64,)>("INSERT INTO plans (feature_id) VALUES (?) RETURNING id")
                .bind(fid)
                .fetch_one(&pool)
                .await
                .unwrap()
                .0;

        sqlx::query("INSERT INTO phases (plan_id) VALUES (?)")
            .bind(plan_id)
            .execute(&pool)
            .await
            .unwrap();

        // Create session + message
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

        // Project settings, feature settings, diff_viewed_files
        sqlx::query("INSERT INTO project_settings (project_id, key, value) VALUES (?, 'k', 'v')")
            .bind(pid)
            .execute(&pool)
            .await
            .unwrap();

        sqlx::query("INSERT INTO feature_settings (feature_id, key, value) VALUES (?, 'k', 'v')")
            .bind(fid)
            .execute(&pool)
            .await
            .unwrap();

        sqlx::query("INSERT INTO diff_viewed_files (feature_id) VALUES (?)")
            .bind(fid)
            .execute(&pool)
            .await
            .unwrap();

        // Delete project
        delete_project(&pool, pid).await.unwrap();

        // Verify cascade
        let count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM projects WHERE id = ?")
            .bind(pid)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(count.0, 0);

        let count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM features WHERE project_id = ?")
            .bind(pid)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(count.0, 0);

        let count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM plans WHERE feature_id = ?")
            .bind(fid)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(count.0, 0);

        let count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM phases WHERE plan_id = ?")
            .bind(plan_id)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(count.0, 0);

        let count: (i64,) =
            sqlx::query_as("SELECT COUNT(*) FROM agent_sessions WHERE feature_id = ?")
                .bind(fid)
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

        let count: (i64,) =
            sqlx::query_as("SELECT COUNT(*) FROM project_settings WHERE project_id = ?")
                .bind(pid)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(count.0, 0);

        let count: (i64,) =
            sqlx::query_as("SELECT COUNT(*) FROM feature_settings WHERE feature_id = ?")
                .bind(fid)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(count.0, 0);

        let count: (i64,) =
            sqlx::query_as("SELECT COUNT(*) FROM diff_viewed_files WHERE feature_id = ?")
                .bind(fid)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(count.0, 0);
    }

    #[tokio::test]
    async fn test_delete_project_nonexistent() {
        let pool = setup_test_db().await;
        // Should not error
        let result = delete_project(&pool, 9999).await;
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_get_project_settings() {
        let pool = setup_test_db().await;
        let project = create_project(&pool, "Settings", "/tmp/settings")
            .await
            .unwrap();
        let pid = project.id;

        // Set a column-based setting
        set_project_setting(&pool, pid, "agent_autonomy", "full")
            .await
            .unwrap();
        // Set a KV setting
        set_project_setting(&pool, pid, "custom_key", "custom_value")
            .await
            .unwrap();

        let settings = get_project_settings(&pool, pid).await.unwrap();
        let keys: Vec<&str> = settings.iter().map(|s| s.key.as_str()).collect();
        assert!(keys.contains(&"agent_autonomy"));
        assert!(keys.contains(&"custom_key"));

        let autonomy = settings.iter().find(|s| s.key == "agent_autonomy").unwrap();
        assert_eq!(autonomy.value, Some("full".to_string()));

        let custom = settings.iter().find(|s| s.key == "custom_key").unwrap();
        assert_eq!(custom.value, Some("custom_value".to_string()));
    }

    #[tokio::test]
    async fn test_set_project_setting_column_vs_kv() {
        let pool = setup_test_db().await;
        let project = create_project(&pool, "ColVsKv", "/tmp/colvskv")
            .await
            .unwrap();
        let pid = project.id;

        // Column-based: agent_autonomy, branch_prefix, qa_prompt, parallel_execution
        set_project_setting(&pool, pid, "agent_autonomy", "supervised")
            .await
            .unwrap();
        set_project_setting(&pool, pid, "branch_prefix", "feat/")
            .await
            .unwrap();

        let row: (Option<String>, Option<String>) =
            sqlx::query_as("SELECT agent_autonomy, branch_prefix FROM projects WHERE id = ?")
                .bind(pid)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(row.0, Some("supervised".to_string()));
        assert_eq!(row.1, Some("feat/".to_string()));

        // KV-based: instructions, test_command go to project_settings table
        set_project_setting(&pool, pid, "instructions", "do stuff")
            .await
            .unwrap();
        set_project_setting(&pool, pid, "test_command", "cargo test")
            .await
            .unwrap();

        let kv_count: (i64,) =
            sqlx::query_as("SELECT COUNT(*) FROM project_settings WHERE project_id = ?")
                .bind(pid)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(kv_count.0, 2);
    }

    #[tokio::test]
    async fn test_get_project_model_settings() {
        let pool = setup_test_db().await;
        let project = create_project(&pool, "Models", "/tmp/models")
            .await
            .unwrap();
        let pid = project.id;

        sqlx::query(r#"UPDATE projects SET model_plan = 'claude-3-opus', model_execute = 'claude-3-sonnet' WHERE id = ?"#)
            .bind(pid)
            .execute(&pool)
            .await
            .unwrap();

        let settings = get_project_model_settings(&pool, pid).await.unwrap();
        assert_eq!(settings.plan, "claude-3-opus");
        assert_eq!(settings.execute, "claude-3-sonnet");
        assert_eq!(settings.prd, "");
        assert_eq!(settings.risk, "");
    }

    #[tokio::test]
    async fn test_set_project_model_setting() {
        let pool = setup_test_db().await;
        let project = create_project(&pool, "ModelSet", "/tmp/modelset")
            .await
            .unwrap();
        let pid = project.id;

        set_project_model_setting(&pool, pid, "plan", "claude-3-haiku")
            .await
            .unwrap();
        set_project_model_setting(&pool, pid, "execute", "claude-3-opus")
            .await
            .unwrap();
        set_project_model_setting(&pool, pid, "qa", "claude-3-sonnet")
            .await
            .unwrap();

        let settings = get_project_model_settings(&pool, pid).await.unwrap();
        assert_eq!(settings.plan, "claude-3-haiku");
        assert_eq!(settings.execute, "claude-3-opus");
        assert_eq!(settings.qa, "claude-3-sonnet");
        assert_eq!(settings.prd, "");
    }

    #[tokio::test]
    async fn test_set_project_model_setting_rejects_workspace_only_agent() {
        let pool = setup_test_db().await;
        let project = create_project(&pool, "WsOnly", "/tmp/wsonly")
            .await
            .unwrap();
        let err = set_project_model_setting(&pool, project.id, "auto_name", "haiku")
            .await
            .unwrap_err();
        assert!(matches!(err, AppError::BadRequest(_)));

        let err = set_project_provider_setting(&pool, project.id, "auto_name", "opencode")
            .await
            .unwrap_err();
        assert!(matches!(err, AppError::BadRequest(_)));
    }
}

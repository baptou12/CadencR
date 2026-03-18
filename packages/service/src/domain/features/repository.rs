use sqlx::SqlitePool;

use crate::error::AppError;
use super::models::{Feature, Plan, Phase, PlanProgress, FeatureSetting, FeatureModelSettings};

pub async fn list_by_project(pool: &SqlitePool, project_id: i64) -> Result<Vec<Feature>, AppError> {
    let rows = sqlx::query_as::<_, Feature>(
        r#"SELECT id, project_id, title, COALESCE(type, 'feature') as type_, status,
           prd, workflow_step, workflow_config,
           model_plan, model_prd, model_execute, model_risk, model_review,
           "model_review-fixer" as model_review_fixer, model_session, model_qa, model_retro,
           agent_autonomy, parallel_execution,
           COALESCE(created_at, datetime('now')) as created_at
           FROM features WHERE project_id = ? ORDER BY created_at DESC"#,
    )
    .bind(project_id)
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

pub async fn get_by_id(pool: &SqlitePool, id: i64) -> Result<Option<Feature>, AppError> {
    let row = sqlx::query_as::<_, Feature>(
        r#"SELECT id, project_id, title, COALESCE(type, 'feature') as type_, status,
           prd, workflow_step, workflow_config,
           model_plan, model_prd, model_execute, model_risk, model_review,
           "model_review-fixer" as model_review_fixer, model_session, model_qa, model_retro,
           agent_autonomy, parallel_execution,
           COALESCE(created_at, datetime('now')) as created_at
           FROM features WHERE id = ?"#,
    )
    .bind(id)
    .fetch_optional(pool)
    .await?;
    Ok(row)
}

pub async fn create_feature(
    pool: &SqlitePool,
    project_id: i64,
    title: &str,
    type_: &str,
) -> Result<i64, AppError> {
    let result = sqlx::query(
        "INSERT INTO features (project_id, title, type) VALUES (?, ?, ?)",
    )
    .bind(project_id)
    .bind(title)
    .bind(type_)
    .execute(pool)
    .await?;
    Ok(result.last_insert_rowid())
}

pub async fn get_max_session_num(pool: &SqlitePool, project_id: i64) -> Result<i64, AppError> {
    let row: Option<(Option<i64>,)> = sqlx::query_as(
        "SELECT MAX(CAST(REPLACE(title, 'Session ', '') AS INTEGER)) FROM features WHERE project_id = ? AND title LIKE 'Session %'",
    )
    .bind(project_id)
    .fetch_optional(pool)
    .await?;
    Ok(row.and_then(|r| r.0).unwrap_or(0))
}

pub async fn update_status(pool: &SqlitePool, id: i64, status: &str) -> Result<(), AppError> {
    sqlx::query("UPDATE features SET status = ? WHERE id = ?")
        .bind(status)
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn update_title(pool: &SqlitePool, id: i64, title: &str) -> Result<(), AppError> {
    sqlx::query("UPDATE features SET title = ? WHERE id = ?")
        .bind(title)
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn get_prd(pool: &SqlitePool, id: i64) -> Result<Option<String>, AppError> {
    let row: Option<(Option<String>,)> =
        sqlx::query_as("SELECT prd FROM features WHERE id = ?")
            .bind(id)
            .fetch_optional(pool)
            .await?;
    Ok(row.and_then(|r| r.0))
}

pub async fn is_empty(pool: &SqlitePool, id: i64) -> Result<bool, AppError> {
    let feature_row: Option<(String, Option<String>)> =
        sqlx::query_as("SELECT COALESCE(type, 'feature'), prd FROM features WHERE id = ?")
            .bind(id)
            .fetch_optional(pool)
            .await?;

    let (ftype, prd) = match feature_row {
        None => return Ok(true),
        Some(r) => r,
    };

    // Never consider empty if there are active sessions
    let active: Option<(i64,)> = sqlx::query_as(
        "SELECT 1 FROM agent_sessions WHERE feature_id = ? AND status IN ('running', 'paused', 'waiting') LIMIT 1",
    )
    .bind(id)
    .fetch_optional(pool)
    .await?;
    if active.is_some() {
        return Ok(false);
    }

    if ftype == "session" || ftype == "ws-session" {
        let msg: Option<(i64,)> = sqlx::query_as(
            "SELECT 1 FROM agent_messages WHERE session_id IN (SELECT id FROM agent_sessions WHERE feature_id = ?) LIMIT 1",
        )
        .bind(id)
        .fetch_optional(pool)
        .await?;
        return Ok(msg.is_none());
    }

    let has_prd = prd.map(|p| !p.trim().is_empty()).unwrap_or(false);
    let has_plan: Option<(i64,)> =
        sqlx::query_as("SELECT 1 FROM plans WHERE feature_id = ? LIMIT 1")
            .bind(id)
            .fetch_optional(pool)
            .await?;
    Ok(!has_prd && has_plan.is_none())
}

pub async fn get_plan_with_phases(
    pool: &SqlitePool,
    feature_id: i64,
) -> Result<Option<(Plan, Vec<Phase>)>, AppError> {
    let plan: Option<Plan> = sqlx::query_as::<_, Plan>(
        r#"SELECT id, feature_id, COALESCE(title, '') as title, status, summary, context,
           clarifications, completion_conditions,
           COALESCE(created_at, datetime('now')) as created_at
           FROM plans WHERE feature_id = ? ORDER BY created_at DESC LIMIT 1"#,
    )
    .bind(feature_id)
    .fetch_optional(pool)
    .await?;

    let plan = match plan {
        None => return Ok(None),
        Some(p) => p,
    };

    let phases: Vec<Phase> = sqlx::query_as::<_, Phase>(
        r#"SELECT id, plan_id, step_number, title, status, complexity, commit_message,
           prompt, phase_type, implementation_notes, deviations, order_index, depends_on
           FROM phases WHERE plan_id = ? ORDER BY step_number ASC, order_index ASC"#,
    )
    .bind(plan.id)
    .fetch_all(pool)
    .await?;

    Ok(Some((plan, phases)))
}

pub async fn get_plan_progress(pool: &SqlitePool, feature_id: i64) -> Result<PlanProgress, AppError> {
    let plan_row: Option<(i64,)> =
        sqlx::query_as("SELECT id FROM plans WHERE feature_id = ? ORDER BY created_at DESC LIMIT 1")
            .bind(feature_id)
            .fetch_optional(pool)
            .await?;

    let plan_id = match plan_row {
        None => return Ok(PlanProgress { total: 0, done: 0 }),
        Some(r) => r.0,
    };

    let total: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM phases WHERE plan_id = ?")
        .bind(plan_id)
        .fetch_one(pool)
        .await?;
    let done: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM phases WHERE plan_id = ? AND status = 'completed'")
        .bind(plan_id)
        .fetch_one(pool)
        .await?;

    Ok(PlanProgress { total: total.0, done: done.0 })
}

pub async fn reset_phase(pool: &SqlitePool, phase_id: i64) -> Result<(), AppError> {
    // Validate phase exists and is in a resettable state
    let phase_row: Option<(i64, String)> =
        sqlx::query_as("SELECT plan_id, status FROM phases WHERE id = ?")
            .bind(phase_id)
            .fetch_optional(pool)
            .await?;

    let (plan_id, status) = match phase_row {
        None => return Err(AppError::NotFound(format!("Phase {phase_id} not found"))),
        Some(r) => r,
    };

    if status != "completed" && status != "error" {
        return Err(AppError::BadRequest(
            "Can only reset phases in completed or error status".to_string(),
        ));
    }

    // Get step_number to check next phase
    let step_row: Option<(i64,)> =
        sqlx::query_as("SELECT step_number FROM phases WHERE id = ?")
            .bind(phase_id)
            .fetch_optional(pool)
            .await?;
    let step_number = step_row.map(|r| r.0).unwrap_or(0);

    let next_phase: Option<(String,)> = sqlx::query_as(
        "SELECT status FROM phases WHERE plan_id = ? AND step_number > ? ORDER BY step_number ASC, order_index ASC LIMIT 1",
    )
    .bind(plan_id)
    .bind(step_number)
    .fetch_optional(pool)
    .await?;

    if let Some((next_status,)) = next_phase {
        if next_status == "completed" {
            return Err(AppError::BadRequest(
                "Cannot reset a phase when the next phase is already completed".to_string(),
            ));
        }
    }

    // Delete sessions and messages for this phase, then reset
    let mut tx = pool.begin().await?;

    sqlx::query(
        "DELETE FROM agent_messages WHERE session_id IN (SELECT id FROM agent_sessions WHERE phase_id = ?)",
    )
    .bind(phase_id)
    .execute(&mut *tx)
    .await?;

    sqlx::query("DELETE FROM agent_sessions WHERE phase_id = ?")
        .bind(phase_id)
        .execute(&mut *tx)
        .await?;

    sqlx::query(
        "UPDATE phases SET status = 'pending', implementation_notes = NULL, deviations = NULL WHERE id = ?",
    )
    .bind(phase_id)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;
    Ok(())
}

pub async fn override_phase_status(pool: &SqlitePool, phase_id: i64, status: &str) -> Result<(), AppError> {
    let exists: Option<(i64,)> =
        sqlx::query_as("SELECT id FROM phases WHERE id = ?")
            .bind(phase_id)
            .fetch_optional(pool)
            .await?;
    if exists.is_none() {
        return Err(AppError::NotFound(format!("Phase {phase_id} not found")));
    }
    sqlx::query("UPDATE phases SET status = ? WHERE id = ?")
        .bind(status)
        .bind(phase_id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn get_feature_settings(pool: &SqlitePool, feature_id: i64) -> Result<Vec<FeatureSetting>, AppError> {
    // First get inline columns from features table
    let row: Option<(
        Option<String>, Option<String>, Option<String>, Option<String>, Option<String>,
        Option<String>, Option<String>, Option<String>, Option<String>,
        Option<String>, Option<String>,
    )> = sqlx::query_as(
        r#"SELECT model_plan, model_prd, model_execute, model_risk, model_review,
           "model_review-fixer", model_session, model_qa, model_retro,
           agent_autonomy, parallel_execution
           FROM features WHERE id = ?"#,
    )
    .bind(feature_id)
    .fetch_optional(pool)
    .await?;

    let mut result = Vec::new();
    if let Some((plan, prd, exec, risk, review, review_fixer, session, qa, retro, autonomy, parallel)) = row {
        let columns = [
            ("model_plan", plan),
            ("model_prd", prd),
            ("model_execute", exec),
            ("model_risk", risk),
            ("model_review", review),
            ("model_review-fixer", review_fixer),
            ("model_session", session),
            ("model_qa", qa),
            ("model_retro", retro),
            ("agent_autonomy", autonomy),
            ("parallel_execution", parallel),
        ];
        for (key, val) in columns {
            if let Some(v) = val {
                result.push(FeatureSetting { key: key.to_string(), value: v });
            }
        }
    }

    // Then get feature_settings table entries
    let settings: Vec<(String, String)> =
        sqlx::query_as("SELECT key, value FROM feature_settings WHERE feature_id = ?")
            .bind(feature_id)
            .fetch_all(pool)
            .await?;
    for (key, value) in settings {
        result.push(FeatureSetting { key, value });
    }

    Ok(result)
}

pub async fn set_feature_setting(pool: &SqlitePool, feature_id: i64, key: &str, value: &str) -> Result<(), AppError> {
    let real_columns = [
        "model_plan", "model_prd", "model_execute", "model_risk", "model_review",
        "model_review-fixer", "model_session", "model_qa", "model_retro",
        "agent_autonomy", "parallel_execution",
    ];

    if real_columns.contains(&key) {
        let sql = format!(r#"UPDATE features SET "{}" = ? WHERE id = ?"#, key);
        sqlx::query(&sql)
            .bind(value)
            .bind(feature_id)
            .execute(pool)
            .await?;
    } else {
        sqlx::query(
            "INSERT INTO feature_settings (feature_id, key, value) VALUES (?, ?, ?) ON CONFLICT(feature_id, key) DO UPDATE SET value = excluded.value",
        )
        .bind(feature_id)
        .bind(key)
        .bind(value)
        .execute(pool)
        .await?;
    }
    Ok(())
}

pub async fn get_feature_model_settings(pool: &SqlitePool, feature_id: i64) -> Result<FeatureModelSettings, AppError> {
    let row: Option<(
        Option<String>, Option<String>, Option<String>, Option<String>, Option<String>,
        Option<String>, Option<String>, Option<String>, Option<String>,
    )> = sqlx::query_as(
        r#"SELECT model_plan, model_prd, model_execute, model_risk, model_review,
           "model_review-fixer", model_session, model_qa, model_retro
           FROM features WHERE id = ?"#,
    )
    .bind(feature_id)
    .fetch_optional(pool)
    .await?;

    let (plan, prd, execute, risk, review, review_fixer, session, qa, retro) =
        row.unwrap_or_default();

    Ok(FeatureModelSettings {
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

pub async fn set_feature_model_setting(
    pool: &SqlitePool,
    feature_id: i64,
    model_type: &str,
    model: &str,
) -> Result<(), AppError> {
    const VALID_MODEL_TYPES: &[&str] = &["plan", "prd", "execute", "risk", "review", "review-fixer", "session", "qa", "retro"];
    if !VALID_MODEL_TYPES.contains(&model_type) {
        return Err(AppError::BadRequest(format!("Invalid model type: {}", model_type)));
    }
    let col = format!("model_{}", model_type);
    let sql = format!(r#"UPDATE features SET "{}" = ? WHERE id = ?"#, col);
    sqlx::query(&sql)
        .bind(model)
        .bind(feature_id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn resolve_working_dir(pool: &SqlitePool, feature_id: i64, project_id: i64) -> Result<Option<String>, AppError> {
    let feature_row: Option<(String,)> =
        sqlx::query_as("SELECT COALESCE(type, 'feature') FROM features WHERE id = ?")
            .bind(feature_id)
            .fetch_optional(pool)
            .await?;

    if let Some((ftype,)) = feature_row {
        if ftype != "session" {
            let setting: Option<(String,)> = sqlx::query_as(
                "SELECT value FROM feature_settings WHERE feature_id = ? AND key = 'worktree_path'",
            )
            .bind(feature_id)
            .fetch_optional(pool)
            .await?;
            if let Some((path,)) = setting {
                return Ok(Some(path));
            }
        }
    }

    let project_path: Option<(String,)> =
        sqlx::query_as("SELECT path FROM projects WHERE id = ?")
            .bind(project_id)
            .fetch_optional(pool)
            .await?;
    Ok(project_path.map(|r| r.0))
}

pub async fn delete_feature(pool: &SqlitePool, id: i64) -> Result<(), AppError> {
    let mut tx = pool.begin().await?;

    // Get all plan IDs for cascade delete
    let plan_ids: Vec<(i64,)> =
        sqlx::query_as("SELECT id FROM plans WHERE feature_id = ?")
            .bind(id)
            .fetch_all(&mut *tx)
            .await?;

    for (plan_id,) in plan_ids {
        sqlx::query("DELETE FROM phases WHERE plan_id = ?")
            .bind(plan_id)
            .execute(&mut *tx)
            .await?;
    }

    sqlx::query("DELETE FROM plans WHERE feature_id = ?")
        .bind(id)
        .execute(&mut *tx)
        .await?;

    sqlx::query(
        "DELETE FROM agent_messages WHERE session_id IN (SELECT id FROM agent_sessions WHERE feature_id = ?)",
    )
    .bind(id)
    .execute(&mut *tx)
    .await?;

    sqlx::query("DELETE FROM agent_sessions WHERE feature_id = ?")
        .bind(id)
        .execute(&mut *tx)
        .await?;

    sqlx::query("DELETE FROM feature_settings WHERE feature_id = ?")
        .bind(id)
        .execute(&mut *tx)
        .await?;

    sqlx::query("DELETE FROM diff_comments WHERE feature_id = ?")
        .bind(id)
        .execute(&mut *tx)
        .await?;

    sqlx::query("DELETE FROM diff_viewed_files WHERE feature_id = ?")
        .bind(id)
        .execute(&mut *tx)
        .await?;

    sqlx::query("DELETE FROM features WHERE id = ?")
        .bind(id)
        .execute(&mut *tx)
        .await?;

    tx.commit().await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::SqlitePoolOptions;

    async fn setup_test_db() -> SqlitePool {
        let pool = SqlitePoolOptions::new()
            .connect("sqlite::memory:")
            .await
            .expect("Failed to create in-memory SQLite pool");

        sqlx::query(
            r#"CREATE TABLE projects (
                id INTEGER PRIMARY KEY,
                name TEXT,
                path TEXT
            )"#,
        )
        .execute(&pool)
        .await
        .unwrap();

        sqlx::query(
            r#"CREATE TABLE features (
                id INTEGER PRIMARY KEY,
                project_id INTEGER,
                title TEXT,
                status TEXT DEFAULT 'active',
                type TEXT DEFAULT 'feature',
                prd TEXT,
                workflow_step TEXT,
                workflow_config TEXT,
                model_plan TEXT,
                model_prd TEXT,
                model_execute TEXT,
                model_risk TEXT,
                model_review TEXT,
                "model_review-fixer" TEXT,
                model_session TEXT,
                model_qa TEXT,
                model_retro TEXT,
                agent_autonomy TEXT,
                parallel_execution TEXT,
                created_at TEXT DEFAULT (datetime('now'))
            )"#,
        )
        .execute(&pool)
        .await
        .unwrap();

        sqlx::query(
            r#"CREATE TABLE plans (
                id INTEGER PRIMARY KEY,
                feature_id INTEGER,
                title TEXT,
                status TEXT,
                summary TEXT,
                context TEXT,
                clarifications TEXT,
                completion_conditions TEXT,
                created_at TEXT DEFAULT (datetime('now'))
            )"#,
        )
        .execute(&pool)
        .await
        .unwrap();

        sqlx::query(
            r#"CREATE TABLE phases (
                id INTEGER PRIMARY KEY,
                plan_id INTEGER,
                step_number INTEGER DEFAULT 1,
                title TEXT,
                status TEXT DEFAULT 'pending',
                complexity INTEGER,
                commit_message TEXT,
                prompt TEXT,
                phase_type TEXT,
                implementation_notes TEXT,
                deviations TEXT,
                order_index INTEGER DEFAULT 0,
                depends_on TEXT
            )"#,
        )
        .execute(&pool)
        .await
        .unwrap();

        sqlx::query(
            r#"CREATE TABLE agent_sessions (
                id INTEGER PRIMARY KEY,
                feature_id INTEGER,
                phase_id INTEGER,
                title TEXT,
                status TEXT DEFAULT 'idle',
                worktree TEXT
            )"#,
        )
        .execute(&pool)
        .await
        .unwrap();

        sqlx::query(
            r#"CREATE TABLE agent_messages (
                id INTEGER PRIMARY KEY,
                session_id INTEGER,
                content TEXT
            )"#,
        )
        .execute(&pool)
        .await
        .unwrap();

        sqlx::query(
            r#"CREATE TABLE feature_settings (
                feature_id INTEGER,
                key TEXT,
                value TEXT,
                PRIMARY KEY(feature_id, key)
            )"#,
        )
        .execute(&pool)
        .await
        .unwrap();

        sqlx::query(
            r#"CREATE TABLE diff_comments (
                id INTEGER PRIMARY KEY,
                feature_id INTEGER,
                content TEXT
            )"#,
        )
        .execute(&pool)
        .await
        .unwrap();

        sqlx::query(
            r#"CREATE TABLE diff_viewed_files (
                id INTEGER PRIMARY KEY,
                feature_id INTEGER,
                path TEXT
            )"#,
        )
        .execute(&pool)
        .await
        .unwrap();

        pool
    }

    async fn create_test_project(pool: &SqlitePool) -> i64 {
        let result = sqlx::query("INSERT INTO projects (name, path) VALUES ('Test Project', '/tmp/test')")
            .execute(pool)
            .await
            .unwrap();
        result.last_insert_rowid()
    }

    #[tokio::test]
    async fn test_list_by_project() {
        let pool = setup_test_db().await;
        let proj1 = create_test_project(&pool).await;
        let proj2 = create_test_project(&pool).await;

        create_feature(&pool, proj1, "Feature A", "feature").await.unwrap();
        create_feature(&pool, proj1, "Feature B", "feature").await.unwrap();
        create_feature(&pool, proj2, "Feature C", "feature").await.unwrap();

        let features = list_by_project(&pool, proj1).await.unwrap();
        assert_eq!(features.len(), 2);
    }

    #[tokio::test]
    async fn test_get_by_id() {
        let pool = setup_test_db().await;
        let proj = create_test_project(&pool).await;
        let id = create_feature(&pool, proj, "My Feature", "feature").await.unwrap();

        let feature = get_by_id(&pool, id).await.unwrap().unwrap();
        assert_eq!(feature.title, "My Feature");
        assert_eq!(feature.status, "active");
    }

    #[tokio::test]
    async fn test_get_by_id_not_found() {
        let pool = setup_test_db().await;
        let result = get_by_id(&pool, 9999).await.unwrap();
        assert!(result.is_none());
    }

    #[tokio::test]
    async fn test_create_feature() {
        let pool = setup_test_db().await;
        let proj = create_test_project(&pool).await;
        let id = create_feature(&pool, proj, "New Feature", "session").await.unwrap();

        let feature = get_by_id(&pool, id).await.unwrap().unwrap();
        assert_eq!(feature.title, "New Feature");
        assert_eq!(feature.type_, "session");
    }

    #[tokio::test]
    async fn test_get_max_session_num() {
        let pool = setup_test_db().await;
        let proj = create_test_project(&pool).await;

        create_feature(&pool, proj, "Session 1", "session").await.unwrap();
        create_feature(&pool, proj, "Session 3", "session").await.unwrap();
        create_feature(&pool, proj, "Not a session", "feature").await.unwrap();

        let max = get_max_session_num(&pool, proj).await.unwrap();
        assert_eq!(max, 3);
    }

    #[tokio::test]
    async fn test_get_max_session_num_no_sessions() {
        let pool = setup_test_db().await;
        let proj = create_test_project(&pool).await;
        create_feature(&pool, proj, "Not a session", "feature").await.unwrap();

        let max = get_max_session_num(&pool, proj).await.unwrap();
        assert_eq!(max, 0);
    }

    #[tokio::test]
    async fn test_update_status() {
        let pool = setup_test_db().await;
        let proj = create_test_project(&pool).await;
        let id = create_feature(&pool, proj, "My Feature", "feature").await.unwrap();

        update_status(&pool, id, "archived").await.unwrap();
        let feature = get_by_id(&pool, id).await.unwrap().unwrap();
        assert_eq!(feature.status, "archived");
    }

    #[tokio::test]
    async fn test_update_title() {
        let pool = setup_test_db().await;
        let proj = create_test_project(&pool).await;
        let id = create_feature(&pool, proj, "Old Title", "feature").await.unwrap();

        update_title(&pool, id, "New Title").await.unwrap();
        let feature = get_by_id(&pool, id).await.unwrap().unwrap();
        assert_eq!(feature.title, "New Title");
    }

    #[tokio::test]
    async fn test_is_empty_true() {
        let pool = setup_test_db().await;
        let proj = create_test_project(&pool).await;
        let id = create_feature(&pool, proj, "Empty Feature", "feature").await.unwrap();

        let empty = is_empty(&pool, id).await.unwrap();
        assert!(empty);
    }

    #[tokio::test]
    async fn test_is_empty_false_has_messages() {
        let pool = setup_test_db().await;
        let proj = create_test_project(&pool).await;
        let id = create_feature(&pool, proj, "Session Feature", "session").await.unwrap();

        // Insert an agent_session and agent_message
        let sess_result = sqlx::query(
            "INSERT INTO agent_sessions (feature_id, title, status) VALUES (?, 'sess', 'idle')"
        )
        .bind(id)
        .execute(&pool)
        .await
        .unwrap();
        let sess_id = sess_result.last_insert_rowid();

        sqlx::query("INSERT INTO agent_messages (session_id, content) VALUES (?, 'hello')")
            .bind(sess_id)
            .execute(&pool)
            .await
            .unwrap();

        let empty = is_empty(&pool, id).await.unwrap();
        assert!(!empty);
    }

    #[tokio::test]
    async fn test_is_empty_false_has_prd() {
        let pool = setup_test_db().await;
        let proj = create_test_project(&pool).await;
        let id = create_feature(&pool, proj, "Feature With PRD", "feature").await.unwrap();

        sqlx::query("UPDATE features SET prd = 'some content' WHERE id = ?")
            .bind(id)
            .execute(&pool)
            .await
            .unwrap();

        let empty = is_empty(&pool, id).await.unwrap();
        assert!(!empty);
    }

    #[tokio::test]
    async fn test_get_plan_with_phases() {
        let pool = setup_test_db().await;
        let proj = create_test_project(&pool).await;
        let fid = create_feature(&pool, proj, "Feature", "feature").await.unwrap();

        let plan_res = sqlx::query("INSERT INTO plans (feature_id, title, status) VALUES (?, 'Plan', 'active')")
            .bind(fid)
            .execute(&pool)
            .await
            .unwrap();
        let plan_id = plan_res.last_insert_rowid();

        for i in 1..=3i64 {
            sqlx::query(
                "INSERT INTO phases (plan_id, step_number, title, status) VALUES (?, ?, ?, 'pending')"
            )
            .bind(plan_id)
            .bind(i)
            .bind(format!("Phase {}", i))
            .execute(&pool)
            .await
            .unwrap();
        }

        let result = get_plan_with_phases(&pool, fid).await.unwrap();
        assert!(result.is_some());
        let (_, phases) = result.unwrap();
        assert_eq!(phases.len(), 3);
    }

    #[tokio::test]
    async fn test_get_plan_with_phases_no_plan() {
        let pool = setup_test_db().await;
        let proj = create_test_project(&pool).await;
        let fid = create_feature(&pool, proj, "Feature", "feature").await.unwrap();

        let result = get_plan_with_phases(&pool, fid).await.unwrap();
        assert!(result.is_none());
    }

    #[tokio::test]
    async fn test_get_plan_progress() {
        let pool = setup_test_db().await;
        let proj = create_test_project(&pool).await;
        let fid = create_feature(&pool, proj, "Feature", "feature").await.unwrap();

        let plan_res = sqlx::query("INSERT INTO plans (feature_id, title, status) VALUES (?, 'Plan', 'active')")
            .bind(fid)
            .execute(&pool)
            .await
            .unwrap();
        let plan_id = plan_res.last_insert_rowid();

        sqlx::query("INSERT INTO phases (plan_id, step_number, title, status) VALUES (?, 1, 'P1', 'completed')")
            .bind(plan_id).execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO phases (plan_id, step_number, title, status) VALUES (?, 2, 'P2', 'completed')")
            .bind(plan_id).execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO phases (plan_id, step_number, title, status) VALUES (?, 3, 'P3', 'pending')")
            .bind(plan_id).execute(&pool).await.unwrap();

        let progress = get_plan_progress(&pool, fid).await.unwrap();
        assert_eq!(progress.total, 3);
        assert_eq!(progress.done, 2);
    }

    #[tokio::test]
    async fn test_reset_phase() {
        let pool = setup_test_db().await;
        let proj = create_test_project(&pool).await;
        let fid = create_feature(&pool, proj, "Feature", "feature").await.unwrap();

        let plan_res = sqlx::query("INSERT INTO plans (feature_id, title, status) VALUES (?, 'Plan', 'active')")
            .bind(fid).execute(&pool).await.unwrap();
        let plan_id = plan_res.last_insert_rowid();

        let phase_res = sqlx::query(
            "INSERT INTO phases (plan_id, step_number, title, status) VALUES (?, 1, 'Phase 1', 'completed')"
        )
        .bind(plan_id)
        .execute(&pool)
        .await
        .unwrap();
        let phase_id = phase_res.last_insert_rowid();

        // Insert agent_session and message for this phase
        let sess_res = sqlx::query(
            "INSERT INTO agent_sessions (feature_id, phase_id, title, status) VALUES (?, ?, 'sess', 'idle')"
        )
        .bind(fid)
        .bind(phase_id)
        .execute(&pool)
        .await
        .unwrap();
        let sess_id = sess_res.last_insert_rowid();

        sqlx::query("INSERT INTO agent_messages (session_id, content) VALUES (?, 'msg')")
            .bind(sess_id)
            .execute(&pool)
            .await
            .unwrap();

        reset_phase(&pool, phase_id).await.unwrap();

        // Verify sessions and messages deleted
        let sess_count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM agent_sessions WHERE phase_id = ?")
            .bind(phase_id)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(sess_count.0, 0);

        let msg_count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM agent_messages WHERE session_id = ?")
            .bind(sess_id)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(msg_count.0, 0);

        // Verify phase status is pending
        let status: (String,) = sqlx::query_as("SELECT status FROM phases WHERE id = ?")
            .bind(phase_id)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(status.0, "pending");
    }

    #[tokio::test]
    async fn test_reset_phase_invalid_status() {
        let pool = setup_test_db().await;
        let proj = create_test_project(&pool).await;
        let fid = create_feature(&pool, proj, "Feature", "feature").await.unwrap();

        let plan_res = sqlx::query("INSERT INTO plans (feature_id, title, status) VALUES (?, 'Plan', 'active')")
            .bind(fid).execute(&pool).await.unwrap();
        let plan_id = plan_res.last_insert_rowid();

        let phase_res = sqlx::query(
            "INSERT INTO phases (plan_id, step_number, title, status) VALUES (?, 1, 'Phase 1', 'pending')"
        )
        .bind(plan_id)
        .execute(&pool)
        .await
        .unwrap();
        let phase_id = phase_res.last_insert_rowid();

        let result = reset_phase(&pool, phase_id).await;
        assert!(matches!(result, Err(AppError::BadRequest(_))));
    }

    #[tokio::test]
    async fn test_override_phase_status() {
        let pool = setup_test_db().await;
        let proj = create_test_project(&pool).await;
        let fid = create_feature(&pool, proj, "Feature", "feature").await.unwrap();

        let plan_res = sqlx::query("INSERT INTO plans (feature_id, title, status) VALUES (?, 'Plan', 'active')")
            .bind(fid).execute(&pool).await.unwrap();
        let plan_id = plan_res.last_insert_rowid();

        let phase_res = sqlx::query(
            "INSERT INTO phases (plan_id, step_number, title, status) VALUES (?, 1, 'Phase 1', 'pending')"
        )
        .bind(plan_id)
        .execute(&pool)
        .await
        .unwrap();
        let phase_id = phase_res.last_insert_rowid();

        override_phase_status(&pool, phase_id, "completed").await.unwrap();

        let status: (String,) = sqlx::query_as("SELECT status FROM phases WHERE id = ?")
            .bind(phase_id)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(status.0, "completed");
    }

    #[tokio::test]
    async fn test_get_set_feature_settings() {
        let pool = setup_test_db().await;
        let proj = create_test_project(&pool).await;
        let fid = create_feature(&pool, proj, "Feature", "feature").await.unwrap();

        // Set a key-value setting (non-column)
        set_feature_setting(&pool, fid, "instructions", "do this").await.unwrap();

        // Set a column-based setting
        set_feature_setting(&pool, fid, "model_plan", "claude-3").await.unwrap();

        let settings = get_feature_settings(&pool, fid).await.unwrap();
        let instructions = settings.iter().find(|s| s.key == "instructions");
        assert!(instructions.is_some());
        assert_eq!(instructions.unwrap().value, "do this");

        let model_plan = settings.iter().find(|s| s.key == "model_plan");
        assert!(model_plan.is_some());
        assert_eq!(model_plan.unwrap().value, "claude-3");
    }

    #[tokio::test]
    async fn test_get_set_feature_model_settings() {
        let pool = setup_test_db().await;
        let proj = create_test_project(&pool).await;
        let fid = create_feature(&pool, proj, "Feature", "feature").await.unwrap();

        set_feature_model_setting(&pool, fid, "plan", "claude-3-opus").await.unwrap();
        set_feature_model_setting(&pool, fid, "session", "claude-3-haiku").await.unwrap();

        let settings = get_feature_model_settings(&pool, fid).await.unwrap();
        assert_eq!(settings.plan, "claude-3-opus");
        assert_eq!(settings.session, "claude-3-haiku");
    }

    #[tokio::test]
    async fn test_resolve_working_dir_with_worktree() {
        let pool = setup_test_db().await;
        let proj = create_test_project(&pool).await;
        let fid = create_feature(&pool, proj, "Feature", "feature").await.unwrap();

        sqlx::query(
            "INSERT INTO feature_settings (feature_id, key, value) VALUES (?, 'worktree_path', '/tmp/wt')"
        )
        .bind(fid)
        .execute(&pool)
        .await
        .unwrap();

        let dir = resolve_working_dir(&pool, fid, proj).await.unwrap();
        assert_eq!(dir, Some("/tmp/wt".to_string()));
    }

    #[tokio::test]
    async fn test_resolve_working_dir_fallback_to_project() {
        let pool = setup_test_db().await;

        // Create project with specific path
        let proj_res = sqlx::query("INSERT INTO projects (name, path) VALUES ('Proj', '/tmp/proj')")
            .execute(&pool)
            .await
            .unwrap();
        let proj = proj_res.last_insert_rowid();

        let fid = create_feature(&pool, proj, "Feature", "feature").await.unwrap();

        let dir = resolve_working_dir(&pool, fid, proj).await.unwrap();
        assert_eq!(dir, Some("/tmp/proj".to_string()));
    }

    #[tokio::test]
    async fn test_delete_feature_cascade() {
        let pool = setup_test_db().await;
        let proj = create_test_project(&pool).await;
        let fid = create_feature(&pool, proj, "Feature", "feature").await.unwrap();

        // Create plan and phase
        let plan_res = sqlx::query("INSERT INTO plans (feature_id, title, status) VALUES (?, 'Plan', 'active')")
            .bind(fid).execute(&pool).await.unwrap();
        let plan_id = plan_res.last_insert_rowid();

        let phase_res = sqlx::query(
            "INSERT INTO phases (plan_id, step_number, title, status) VALUES (?, 1, 'Phase', 'pending')"
        )
        .bind(plan_id)
        .execute(&pool)
        .await
        .unwrap();
        let phase_id = phase_res.last_insert_rowid();

        // Create agent_session and message
        let sess_res = sqlx::query(
            "INSERT INTO agent_sessions (feature_id, phase_id, title, status) VALUES (?, ?, 'sess', 'idle')"
        )
        .bind(fid)
        .bind(phase_id)
        .execute(&pool)
        .await
        .unwrap();
        let sess_id = sess_res.last_insert_rowid();

        sqlx::query("INSERT INTO agent_messages (session_id, content) VALUES (?, 'msg')")
            .bind(sess_id).execute(&pool).await.unwrap();

        // Create feature_setting
        sqlx::query("INSERT INTO feature_settings (feature_id, key, value) VALUES (?, 'k', 'v')")
            .bind(fid).execute(&pool).await.unwrap();

        // Create diff_comment and diff_viewed_file
        sqlx::query("INSERT INTO diff_comments (feature_id, content) VALUES (?, 'comment')")
            .bind(fid).execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO diff_viewed_files (feature_id, path) VALUES (?, '/some/file')")
            .bind(fid).execute(&pool).await.unwrap();

        delete_feature(&pool, fid).await.unwrap();

        let f_count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM features WHERE id = ?")
            .bind(fid).fetch_one(&pool).await.unwrap();
        assert_eq!(f_count.0, 0);

        let pl_count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM plans WHERE feature_id = ?")
            .bind(fid).fetch_one(&pool).await.unwrap();
        assert_eq!(pl_count.0, 0);

        let ph_count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM phases WHERE plan_id = ?")
            .bind(plan_id).fetch_one(&pool).await.unwrap();
        assert_eq!(ph_count.0, 0);

        let s_count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM agent_sessions WHERE feature_id = ?")
            .bind(fid).fetch_one(&pool).await.unwrap();
        assert_eq!(s_count.0, 0);

        let m_count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM agent_messages WHERE session_id = ?")
            .bind(sess_id).fetch_one(&pool).await.unwrap();
        assert_eq!(m_count.0, 0);

        let fs_count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM feature_settings WHERE feature_id = ?")
            .bind(fid).fetch_one(&pool).await.unwrap();
        assert_eq!(fs_count.0, 0);

        let dc_count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM diff_comments WHERE feature_id = ?")
            .bind(fid).fetch_one(&pool).await.unwrap();
        assert_eq!(dc_count.0, 0);

        let dvf_count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM diff_viewed_files WHERE feature_id = ?")
            .bind(fid).fetch_one(&pool).await.unwrap();
        assert_eq!(dvf_count.0, 0);
    }
}

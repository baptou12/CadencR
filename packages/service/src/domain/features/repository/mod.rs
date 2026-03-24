mod feature_repository;
mod plan_repository;
mod queue_repository;
mod settings_repository;
mod snapshot;

pub use feature_repository::*;
pub use plan_repository::*;
pub use queue_repository::*;
pub use settings_repository::*;
pub use snapshot::*;

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::SqlitePool;
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

        sqlx::query(
            r#"CREATE TABLE session_claude_ids (
                id INTEGER PRIMARY KEY,
                session_id INTEGER REFERENCES agent_sessions(id),
                claude_session_id TEXT
            )"#,
        )
        .execute(&pool)
        .await
        .unwrap();

        sqlx::query(
            r#"CREATE TABLE workflow_queue (
                id INTEGER PRIMARY KEY,
                feature_id INTEGER,
                item_type TEXT NOT NULL DEFAULT 'execute',
                phase_id INTEGER,
                status TEXT NOT NULL DEFAULT 'pending',
                order_index INTEGER NOT NULL DEFAULT 0,
                agent_session_id INTEGER
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

        create_feature(&pool, proj1, "Feature A", "ws-feature").await.unwrap();
        create_feature(&pool, proj1, "Feature B", "ws-feature").await.unwrap();
        create_feature(&pool, proj2, "Feature C", "ws-feature").await.unwrap();

        let features = list_by_project(&pool, proj1).await.unwrap();
        assert_eq!(features.len(), 2);
    }

    #[tokio::test]
    async fn test_get_by_id() {
        let pool = setup_test_db().await;
        let proj = create_test_project(&pool).await;
        let id = create_feature(&pool, proj, "My Feature", "ws-feature").await.unwrap();

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
        let id = create_feature(&pool, proj, "New Feature", "ws-session").await.unwrap();

        let feature = get_by_id(&pool, id).await.unwrap().unwrap();
        assert_eq!(feature.title, "New Feature");
        assert_eq!(feature.type_, "ws-session");
    }

    #[tokio::test]
    async fn test_get_max_session_num() {
        let pool = setup_test_db().await;
        let proj = create_test_project(&pool).await;

        create_feature(&pool, proj, "Session 1", "ws-session").await.unwrap();
        create_feature(&pool, proj, "Session 3", "ws-session").await.unwrap();
        create_feature(&pool, proj, "Not a session", "ws-feature").await.unwrap();

        let max = get_max_session_num(&pool, proj).await.unwrap();
        assert_eq!(max, 3);
    }

    #[tokio::test]
    async fn test_get_max_session_num_no_sessions() {
        let pool = setup_test_db().await;
        let proj = create_test_project(&pool).await;
        create_feature(&pool, proj, "Not a session", "ws-feature").await.unwrap();

        let max = get_max_session_num(&pool, proj).await.unwrap();
        assert_eq!(max, 0);
    }

    #[tokio::test]
    async fn test_update_status() {
        let pool = setup_test_db().await;
        let proj = create_test_project(&pool).await;
        let id = create_feature(&pool, proj, "My Feature", "ws-feature").await.unwrap();

        update_status(&pool, id, "archived").await.unwrap();
        let feature = get_by_id(&pool, id).await.unwrap().unwrap();
        assert_eq!(feature.status, "archived");
    }

    #[tokio::test]
    async fn test_update_title() {
        let pool = setup_test_db().await;
        let proj = create_test_project(&pool).await;
        let id = create_feature(&pool, proj, "Old Title", "ws-feature").await.unwrap();

        update_title(&pool, id, "New Title").await.unwrap();
        let feature = get_by_id(&pool, id).await.unwrap().unwrap();
        assert_eq!(feature.title, "New Title");
    }

    #[tokio::test]
    async fn test_is_empty_true() {
        let pool = setup_test_db().await;
        let proj = create_test_project(&pool).await;
        let id = create_feature(&pool, proj, "Empty Feature", "ws-feature").await.unwrap();

        let empty = is_empty(&pool, id).await.unwrap();
        assert!(empty);
    }

    #[tokio::test]
    async fn test_is_empty_false_has_messages() {
        let pool = setup_test_db().await;
        let proj = create_test_project(&pool).await;
        let id = create_feature(&pool, proj, "Session Feature", "ws-session").await.unwrap();

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
        let id = create_feature(&pool, proj, "Feature With PRD", "ws-feature").await.unwrap();

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
        let fid = create_feature(&pool, proj, "Feature", "ws-feature").await.unwrap();

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
        let fid = create_feature(&pool, proj, "Feature", "ws-feature").await.unwrap();

        let result = get_plan_with_phases(&pool, fid).await.unwrap();
        assert!(result.is_none());
    }

    #[tokio::test]
    async fn test_get_plan_progress() {
        let pool = setup_test_db().await;
        let proj = create_test_project(&pool).await;
        let fid = create_feature(&pool, proj, "Feature", "ws-feature").await.unwrap();

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
        let fid = create_feature(&pool, proj, "Feature", "ws-feature").await.unwrap();

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
        let fid = create_feature(&pool, proj, "Feature", "ws-feature").await.unwrap();

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
        assert!(matches!(result, Err(crate::error::AppError::BadRequest(_))));
    }

    #[tokio::test]
    async fn test_override_phase_status() {
        let pool = setup_test_db().await;
        let proj = create_test_project(&pool).await;
        let fid = create_feature(&pool, proj, "Feature", "ws-feature").await.unwrap();

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
        let fid = create_feature(&pool, proj, "Feature", "ws-feature").await.unwrap();

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
        let fid = create_feature(&pool, proj, "Feature", "ws-feature").await.unwrap();

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
        let fid = create_feature(&pool, proj, "Feature", "ws-feature").await.unwrap();

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

        let fid = create_feature(&pool, proj, "Feature", "ws-feature").await.unwrap();

        let dir = resolve_working_dir(&pool, fid, proj).await.unwrap();
        assert_eq!(dir, Some("/tmp/proj".to_string()));
    }

    #[tokio::test]
    async fn test_delete_feature_cascade() {
        let pool = setup_test_db().await;
        let proj = create_test_project(&pool).await;
        let fid = create_feature(&pool, proj, "Feature", "ws-feature").await.unwrap();

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

    #[tokio::test]
    async fn test_set_feature_model_setting_invalid_type() {
        let pool = setup_test_db().await;
        let proj = create_test_project(&pool).await;
        let fid = create_feature(&pool, proj, "Feature", "ws-feature").await.unwrap();

        let result = set_feature_model_setting(&pool, fid, "invalid_type", "model").await;
        assert!(matches!(result, Err(crate::error::AppError::BadRequest(_))));
    }

    #[tokio::test]
    async fn test_override_phase_status_not_found() {
        let pool = setup_test_db().await;
        let result = override_phase_status(&pool, 9999, "completed").await;
        assert!(matches!(result, Err(crate::error::AppError::NotFound(_))));
    }

    #[tokio::test]
    async fn test_reset_phase_not_found() {
        let pool = setup_test_db().await;
        let result = reset_phase(&pool, 9999).await;
        assert!(matches!(result, Err(crate::error::AppError::NotFound(_))));
    }

    #[tokio::test]
    async fn test_reset_phase_next_phase_completed() {
        let pool = setup_test_db().await;
        let proj = create_test_project(&pool).await;
        let fid = create_feature(&pool, proj, "Feature", "ws-feature").await.unwrap();

        let plan_res = sqlx::query("INSERT INTO plans (feature_id, title, status) VALUES (?, 'Plan', 'active')")
            .bind(fid).execute(&pool).await.unwrap();
        let plan_id = plan_res.last_insert_rowid();

        let p1 = sqlx::query("INSERT INTO phases (plan_id, step_number, title, status) VALUES (?, 1, 'P1', 'completed')")
            .bind(plan_id).execute(&pool).await.unwrap().last_insert_rowid();
        sqlx::query("INSERT INTO phases (plan_id, step_number, title, status) VALUES (?, 2, 'P2', 'completed')")
            .bind(plan_id).execute(&pool).await.unwrap();

        let result = reset_phase(&pool, p1).await;
        assert!(matches!(result, Err(crate::error::AppError::BadRequest(_))));
    }

    #[tokio::test]
    async fn test_is_empty_false_active_session() {
        let pool = setup_test_db().await;
        let proj = create_test_project(&pool).await;
        let fid = create_feature(&pool, proj, "Feature", "ws-feature").await.unwrap();

        sqlx::query("INSERT INTO agent_sessions (feature_id, title, status) VALUES (?, 'sess', 'running')")
            .bind(fid).execute(&pool).await.unwrap();

        let empty = is_empty(&pool, fid).await.unwrap();
        assert!(!empty);
    }

    #[tokio::test]
    async fn test_is_empty_nonexistent_feature() {
        let pool = setup_test_db().await;
        let empty = is_empty(&pool, 9999).await.unwrap();
        assert!(empty);
    }

    #[tokio::test]
    async fn test_is_empty_false_has_plan() {
        let pool = setup_test_db().await;
        let proj = create_test_project(&pool).await;
        let fid = create_feature(&pool, proj, "Feature", "ws-feature").await.unwrap();

        sqlx::query("INSERT INTO plans (feature_id, title, status) VALUES (?, 'Plan', 'active')")
            .bind(fid).execute(&pool).await.unwrap();

        let empty = is_empty(&pool, fid).await.unwrap();
        assert!(!empty);
    }

    #[tokio::test]
    async fn test_get_prd() {
        let pool = setup_test_db().await;
        let proj = create_test_project(&pool).await;
        let fid = create_feature(&pool, proj, "Feature", "ws-feature").await.unwrap();

        // No PRD initially
        let prd = get_prd(&pool, fid).await.unwrap();
        assert!(prd.is_none());

        // Set PRD
        sqlx::query("UPDATE features SET prd = 'my prd content' WHERE id = ?")
            .bind(fid).execute(&pool).await.unwrap();

        let prd = get_prd(&pool, fid).await.unwrap();
        assert_eq!(prd.as_deref(), Some("my prd content"));
    }

    #[tokio::test]
    async fn test_get_plan_progress_no_plan() {
        let pool = setup_test_db().await;
        let proj = create_test_project(&pool).await;
        let fid = create_feature(&pool, proj, "Feature", "ws-feature").await.unwrap();

        let progress = get_plan_progress(&pool, fid).await.unwrap();
        assert_eq!(progress.total, 0);
        assert_eq!(progress.done, 0);
    }

    #[tokio::test]
    async fn test_resolve_working_dir_session_type_skips_worktree() {
        let pool = setup_test_db().await;
        let proj_res = sqlx::query("INSERT INTO projects (name, path) VALUES ('Proj', '/tmp/proj')")
            .execute(&pool).await.unwrap();
        let proj = proj_res.last_insert_rowid();
        let fid = create_feature(&pool, proj, "Session", "ws-session").await.unwrap();

        // Even with worktree_path set, session type should fall through to project path
        sqlx::query("INSERT INTO feature_settings (feature_id, key, value) VALUES (?, 'worktree_path', '/tmp/wt')")
            .bind(fid).execute(&pool).await.unwrap();

        let dir = resolve_working_dir(&pool, fid, proj).await.unwrap();
        assert_eq!(dir, Some("/tmp/proj".to_string()));
    }

    // ── Workflow Queue Tests ─────────────────────────────────────────

    async fn setup_test_db_with_queue() -> SqlitePool {
        let pool = setup_test_db().await;

        // workflow_queue is already created by setup_test_db; add extra columns for queue tests
        sqlx::query("ALTER TABLE workflow_queue ADD COLUMN workflow_type TEXT").execute(&pool).await.unwrap();
        sqlx::query("ALTER TABLE workflow_queue ADD COLUMN group_index INTEGER").execute(&pool).await.unwrap();
        sqlx::query("ALTER TABLE workflow_queue ADD COLUMN config TEXT").execute(&pool).await.unwrap();
        sqlx::query("ALTER TABLE workflow_queue ADD COLUMN result TEXT").execute(&pool).await.unwrap();
        sqlx::query("ALTER TABLE workflow_queue ADD COLUMN created_at TEXT DEFAULT (datetime('now'))").execute(&pool).await.unwrap();
        sqlx::query("ALTER TABLE workflow_queue ADD COLUMN started_at TEXT").execute(&pool).await.unwrap();
        sqlx::query("ALTER TABLE workflow_queue ADD COLUMN ended_at TEXT").execute(&pool).await.unwrap();
        sqlx::query("ALTER TABLE workflow_queue ADD COLUMN pid INTEGER").execute(&pool).await.unwrap();
        sqlx::query("ALTER TABLE workflow_queue ADD COLUMN max_retries INTEGER NOT NULL DEFAULT 1").execute(&pool).await.unwrap();
        sqlx::query("ALTER TABLE workflow_queue ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0").execute(&pool).await.unwrap();

        sqlx::query(
            r#"CREATE TABLE workflow_dependencies (
                queue_item_id INTEGER,
                depends_on_item_id INTEGER,
                PRIMARY KEY(queue_item_id, depends_on_item_id)
            )"#,
        )
        .execute(&pool)
        .await
        .unwrap();

        pool
    }

    #[tokio::test]
    async fn test_insert_and_get_queue_item() {
        let pool = setup_test_db_with_queue().await;
        let proj = create_test_project(&pool).await;
        let fid = create_feature(&pool, proj, "Feature", "ws-feature").await.unwrap();

        let item_id = insert_queue_item(&pool, fid, "feature_build", "prd", None, "ready", 0, None)
            .await
            .unwrap();

        let item = get_queue_item(&pool, item_id).await.unwrap().unwrap();
        assert_eq!(item.feature_id, fid);
        assert_eq!(item.workflow_type, "feature_build");
        assert_eq!(item.item_type, "prd");
        assert_eq!(item.status, "ready");
        assert_eq!(item.order_index, 0);
        assert!(item.phase_id.is_none());
    }

    #[tokio::test]
    async fn test_get_queue_item_not_found() {
        let pool = setup_test_db_with_queue().await;
        let item = get_queue_item(&pool, 9999).await.unwrap();
        assert!(item.is_none());
    }

    #[tokio::test]
    async fn test_insert_queue_item_with_phase() {
        let pool = setup_test_db_with_queue().await;
        let proj = create_test_project(&pool).await;
        let fid = create_feature(&pool, proj, "Feature", "ws-feature").await.unwrap();

        let item_id = insert_queue_item(&pool, fid, "feature_build", "execute", Some(42), "blocked", 1, Some(0))
            .await
            .unwrap();

        let item = get_queue_item(&pool, item_id).await.unwrap().unwrap();
        assert_eq!(item.phase_id, Some(42));
        assert_eq!(item.group_index, Some(0));
        assert_eq!(item.status, "blocked");
    }

    #[tokio::test]
    async fn test_get_queue_for_feature() {
        let pool = setup_test_db_with_queue().await;
        let proj = create_test_project(&pool).await;
        let fid = create_feature(&pool, proj, "Feature", "ws-feature").await.unwrap();

        insert_queue_item(&pool, fid, "feature_build", "prd", None, "ready", 0, None).await.unwrap();
        insert_queue_item(&pool, fid, "feature_build", "plan", None, "blocked", 1, None).await.unwrap();
        insert_queue_item(&pool, fid, "feature_build", "execute", Some(1), "blocked", 2, Some(0)).await.unwrap();

        let items = get_queue_for_feature(&pool, fid).await.unwrap();
        assert_eq!(items.len(), 3);
        // Verify ordering
        assert_eq!(items[0].order_index, 0);
        assert_eq!(items[1].order_index, 1);
        assert_eq!(items[2].order_index, 2);
    }

    #[tokio::test]
    async fn test_get_queue_for_feature_empty() {
        let pool = setup_test_db_with_queue().await;
        let proj = create_test_project(&pool).await;
        let fid = create_feature(&pool, proj, "Feature", "ws-feature").await.unwrap();

        let items = get_queue_for_feature(&pool, fid).await.unwrap();
        assert!(items.is_empty());
    }

    #[tokio::test]
    async fn test_get_ready_items() {
        let pool = setup_test_db_with_queue().await;
        let proj = create_test_project(&pool).await;
        let fid = create_feature(&pool, proj, "Feature", "ws-feature").await.unwrap();

        insert_queue_item(&pool, fid, "feature_build", "prd", None, "ready", 0, None).await.unwrap();
        insert_queue_item(&pool, fid, "feature_build", "plan", None, "blocked", 1, None).await.unwrap();
        insert_queue_item(&pool, fid, "feature_build", "execute", None, "ready", 2, None).await.unwrap();

        let ready = get_ready_items(&pool, fid).await.unwrap();
        assert_eq!(ready.len(), 2);
        assert!(ready.iter().all(|i| i.status == "ready"));
    }

    #[tokio::test]
    async fn test_mark_item_running() {
        let pool = setup_test_db_with_queue().await;
        let proj = create_test_project(&pool).await;
        let fid = create_feature(&pool, proj, "Feature", "ws-feature").await.unwrap();

        let item_id = insert_queue_item(&pool, fid, "feature_build", "prd", None, "ready", 0, None).await.unwrap();
        mark_item_running(&pool, item_id).await.unwrap();

        let item = get_queue_item(&pool, item_id).await.unwrap().unwrap();
        assert_eq!(item.status, "running");
        assert!(item.started_at.is_some());
    }

    #[tokio::test]
    async fn test_mark_item_completed() {
        let pool = setup_test_db_with_queue().await;
        let proj = create_test_project(&pool).await;
        let fid = create_feature(&pool, proj, "Feature", "ws-feature").await.unwrap();

        let item_id = insert_queue_item(&pool, fid, "feature_build", "prd", None, "running", 0, None).await.unwrap();
        mark_item_completed(&pool, item_id, Some(r#"{"ok": true}"#)).await.unwrap();

        let item = get_queue_item(&pool, item_id).await.unwrap().unwrap();
        assert_eq!(item.status, "completed");
        assert_eq!(item.result.as_deref(), Some(r#"{"ok": true}"#));
        assert!(item.ended_at.is_some());
    }

    #[tokio::test]
    async fn test_mark_item_completed_no_result() {
        let pool = setup_test_db_with_queue().await;
        let proj = create_test_project(&pool).await;
        let fid = create_feature(&pool, proj, "Feature", "ws-feature").await.unwrap();

        let item_id = insert_queue_item(&pool, fid, "feature_build", "prd", None, "running", 0, None).await.unwrap();
        mark_item_completed(&pool, item_id, None).await.unwrap();

        let item = get_queue_item(&pool, item_id).await.unwrap().unwrap();
        assert_eq!(item.status, "completed");
        assert!(item.result.is_none());
    }

    #[tokio::test]
    async fn test_mark_item_error() {
        let pool = setup_test_db_with_queue().await;
        let proj = create_test_project(&pool).await;
        let fid = create_feature(&pool, proj, "Feature", "ws-feature").await.unwrap();

        let item_id = insert_queue_item(&pool, fid, "feature_build", "prd", None, "running", 0, None).await.unwrap();
        mark_item_error(&pool, item_id, Some(r#"{"error": "failed"}"#)).await.unwrap();

        let item = get_queue_item(&pool, item_id).await.unwrap().unwrap();
        assert_eq!(item.status, "error");
        assert_eq!(item.result.as_deref(), Some(r#"{"error": "failed"}"#));
        assert!(item.ended_at.is_some());
    }

    #[tokio::test]
    async fn test_mark_item_skipped() {
        let pool = setup_test_db_with_queue().await;
        let proj = create_test_project(&pool).await;
        let fid = create_feature(&pool, proj, "Feature", "ws-feature").await.unwrap();

        let item_id = insert_queue_item(&pool, fid, "feature_build", "prd", None, "blocked", 0, None).await.unwrap();
        mark_item_skipped(&pool, item_id).await.unwrap();

        let item = get_queue_item(&pool, item_id).await.unwrap().unwrap();
        assert_eq!(item.status, "skipped");
        assert!(item.ended_at.is_some());
    }

    #[tokio::test]
    async fn test_update_item_pid() {
        let pool = setup_test_db_with_queue().await;
        let proj = create_test_project(&pool).await;
        let fid = create_feature(&pool, proj, "Feature", "ws-feature").await.unwrap();

        let item_id = insert_queue_item(&pool, fid, "feature_build", "prd", None, "running", 0, None).await.unwrap();
        update_item_pid(&pool, item_id, 12345).await.unwrap();

        let item = get_queue_item(&pool, item_id).await.unwrap().unwrap();
        assert_eq!(item.pid, Some(12345));
    }

    #[tokio::test]
    async fn test_insert_dependency_and_unblock() {
        let pool = setup_test_db_with_queue().await;
        let proj = create_test_project(&pool).await;
        let fid = create_feature(&pool, proj, "Feature", "ws-feature").await.unwrap();

        let item1 = insert_queue_item(&pool, fid, "feature_build", "prd", None, "ready", 0, None).await.unwrap();
        let item2 = insert_queue_item(&pool, fid, "feature_build", "plan", None, "blocked", 1, None).await.unwrap();

        insert_dependency(&pool, item2, item1).await.unwrap();

        // item2 should stay blocked because item1 is not completed
        let ready = unblock_ready_items(&pool, fid).await.unwrap();
        assert_eq!(ready.len(), 1); // only item1
        assert_eq!(ready[0].id, item1);

        // Complete item1
        mark_item_completed(&pool, item1, None).await.unwrap();

        // Now item2 should be unblocked
        let ready = unblock_ready_items(&pool, fid).await.unwrap();
        assert_eq!(ready.len(), 1);
        assert_eq!(ready[0].id, item2);
        assert_eq!(ready[0].status, "ready");
    }

    #[tokio::test]
    async fn test_unblock_with_skipped_dependency() {
        let pool = setup_test_db_with_queue().await;
        let proj = create_test_project(&pool).await;
        let fid = create_feature(&pool, proj, "Feature", "ws-feature").await.unwrap();

        let item1 = insert_queue_item(&pool, fid, "feature_build", "prd", None, "ready", 0, None).await.unwrap();
        let item2 = insert_queue_item(&pool, fid, "feature_build", "plan", None, "blocked", 1, None).await.unwrap();

        insert_dependency(&pool, item2, item1).await.unwrap();
        mark_item_skipped(&pool, item1).await.unwrap();

        let ready = unblock_ready_items(&pool, fid).await.unwrap();
        assert!(ready.iter().any(|i| i.id == item2));
    }

    #[tokio::test]
    async fn test_unblock_multiple_dependencies() {
        let pool = setup_test_db_with_queue().await;
        let proj = create_test_project(&pool).await;
        let fid = create_feature(&pool, proj, "Feature", "ws-feature").await.unwrap();

        let item1 = insert_queue_item(&pool, fid, "feature_build", "prd", None, "completed", 0, None).await.unwrap();
        let item2 = insert_queue_item(&pool, fid, "feature_build", "plan", None, "running", 1, None).await.unwrap();
        let item3 = insert_queue_item(&pool, fid, "feature_build", "execute", None, "blocked", 2, None).await.unwrap();

        // item3 depends on both item1 and item2
        insert_dependency(&pool, item3, item1).await.unwrap();
        insert_dependency(&pool, item3, item2).await.unwrap();

        // item2 still running, so item3 stays blocked
        let ready = unblock_ready_items(&pool, fid).await.unwrap();
        assert!(!ready.iter().any(|i| i.id == item3));

        // Complete item2
        mark_item_completed(&pool, item2, None).await.unwrap();

        let ready = unblock_ready_items(&pool, fid).await.unwrap();
        assert!(ready.iter().any(|i| i.id == item3));
    }

    #[tokio::test]
    async fn test_clear_queue_for_feature() {
        let pool = setup_test_db_with_queue().await;
        let proj = create_test_project(&pool).await;
        let fid = create_feature(&pool, proj, "Feature", "ws-feature").await.unwrap();

        let item1 = insert_queue_item(&pool, fid, "feature_build", "prd", None, "ready", 0, None).await.unwrap();
        let item2 = insert_queue_item(&pool, fid, "feature_build", "plan", None, "blocked", 1, None).await.unwrap();
        insert_dependency(&pool, item2, item1).await.unwrap();

        clear_queue_for_feature(&pool, fid).await.unwrap();

        let items = get_queue_for_feature(&pool, fid).await.unwrap();
        assert!(items.is_empty());

        // Dependencies should also be gone
        let dep_count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM workflow_dependencies")
            .fetch_one(&pool).await.unwrap();
        assert_eq!(dep_count.0, 0);
    }

    #[tokio::test]
    async fn test_clear_queue_isolates_features() {
        let pool = setup_test_db_with_queue().await;
        let proj = create_test_project(&pool).await;
        let fid1 = create_feature(&pool, proj, "Feature 1", "ws-feature").await.unwrap();
        let fid2 = create_feature(&pool, proj, "Feature 2", "ws-feature").await.unwrap();

        insert_queue_item(&pool, fid1, "feature_build", "prd", None, "ready", 0, None).await.unwrap();
        insert_queue_item(&pool, fid2, "feature_build", "prd", None, "ready", 0, None).await.unwrap();

        clear_queue_for_feature(&pool, fid1).await.unwrap();

        let items1 = get_queue_for_feature(&pool, fid1).await.unwrap();
        assert!(items1.is_empty());

        let items2 = get_queue_for_feature(&pool, fid2).await.unwrap();
        assert_eq!(items2.len(), 1);
    }

    #[tokio::test]
    async fn test_is_empty_session_no_messages() {
        let pool = setup_test_db().await;
        let proj = create_test_project(&pool).await;
        let fid = create_feature(&pool, proj, "Session", "ws-session").await.unwrap();

        // Session with no messages should be empty
        sqlx::query("INSERT INTO agent_sessions (feature_id, title, status) VALUES (?, 'sess', 'idle')")
            .bind(fid).execute(&pool).await.unwrap();

        let empty = is_empty(&pool, fid).await.unwrap();
        assert!(empty);
    }

    #[tokio::test]
    async fn test_set_feature_setting_upsert() {
        let pool = setup_test_db().await;
        let proj = create_test_project(&pool).await;
        let fid = create_feature(&pool, proj, "Feature", "ws-feature").await.unwrap();

        set_feature_setting(&pool, fid, "custom_key", "value1").await.unwrap();
        set_feature_setting(&pool, fid, "custom_key", "value2").await.unwrap();

        let settings = get_feature_settings(&pool, fid).await.unwrap();
        let custom = settings.iter().filter(|s| s.key == "custom_key").collect::<Vec<_>>();
        assert_eq!(custom.len(), 1);
        assert_eq!(custom[0].value, "value2");
    }

    #[tokio::test]
    async fn test_delete_feature_with_workflow_queue() {
        let pool = setup_test_db().await;
        // Recreate workflow_queue with FK constraints to mirror production schema
        sqlx::query("DROP TABLE workflow_queue").execute(&pool).await.unwrap();
        sqlx::query(
            r#"CREATE TABLE workflow_queue (
                id INTEGER PRIMARY KEY,
                feature_id INTEGER REFERENCES features(id),
                item_type TEXT NOT NULL DEFAULT 'execute',
                phase_id INTEGER REFERENCES phases(id),
                status TEXT NOT NULL DEFAULT 'pending',
                order_index INTEGER NOT NULL DEFAULT 0,
                agent_session_id INTEGER REFERENCES agent_sessions(id)
            )"#,
        ).execute(&pool).await.unwrap();
        sqlx::query("PRAGMA foreign_keys = ON").execute(&pool).await.unwrap();
        let proj = create_test_project(&pool).await;
        let fid = create_feature(&pool, proj, "Feature", "ws-feature").await.unwrap();

        // Create plan + phase
        let plan_id = sqlx::query("INSERT INTO plans (feature_id, title, status) VALUES (?, 'Plan', 'active')")
            .bind(fid).execute(&pool).await.unwrap().last_insert_rowid();
        let phase_id = sqlx::query("INSERT INTO phases (plan_id, step_number, title) VALUES (?, 1, 'Phase 1')")
            .bind(plan_id).execute(&pool).await.unwrap().last_insert_rowid();

        // Create session + message + claude_id
        let sess_id = sqlx::query("INSERT INTO agent_sessions (feature_id, title) VALUES (?, 'sess')")
            .bind(fid).execute(&pool).await.unwrap().last_insert_rowid();
        sqlx::query("INSERT INTO agent_messages (session_id, content) VALUES (?, 'hello')")
            .bind(sess_id).execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO session_claude_ids (session_id, claude_session_id) VALUES (?, 'cid-1')")
            .bind(sess_id).execute(&pool).await.unwrap();

        // Create workflow_queue referencing phase + session + feature
        sqlx::query(
            "INSERT INTO workflow_queue (feature_id, item_type, order_index, phase_id, agent_session_id) VALUES (?, 'execute', 0, ?, ?)"
        )
        .bind(fid).bind(phase_id).bind(sess_id)
        .execute(&pool).await.unwrap();

        // Delete should succeed despite FK constraints
        delete_feature(&pool, fid).await.unwrap();

        // Verify everything is gone
        let feature = get_by_id(&pool, fid).await.unwrap();
        assert!(feature.is_none());

        let wq: Vec<(i64,)> = sqlx::query_as("SELECT id FROM workflow_queue WHERE feature_id = ?")
            .bind(fid).fetch_all(&pool).await.unwrap();
        assert!(wq.is_empty());
    }

    #[tokio::test]
    async fn test_delete_feature_no_related_data() {
        let pool = setup_test_db().await;
        sqlx::query("PRAGMA foreign_keys = ON").execute(&pool).await.unwrap();
        let proj = create_test_project(&pool).await;
        let fid = create_feature(&pool, proj, "Empty Feature", "ws-feature").await.unwrap();

        delete_feature(&pool, fid).await.unwrap();

        let feature = get_by_id(&pool, fid).await.unwrap();
        assert!(feature.is_none());
    }

    // ── Draft Queue Item Tests ──────────────────────────────────────

    #[test]
    fn test_map_phase_type_to_item_type() {
        assert_eq!(map_phase_type_to_item_type(Some("setup")), "execute");
        assert_eq!(map_phase_type_to_item_type(Some("value")), "execute");
        assert_eq!(map_phase_type_to_item_type(Some("qa")), "qa");
        assert_eq!(map_phase_type_to_item_type(None), "execute");
        assert_eq!(map_phase_type_to_item_type(Some("unknown")), "execute");
    }

    #[tokio::test]
    async fn test_insert_draft_queue_item() {
        let pool = setup_test_db_with_queue().await;
        let proj = create_test_project(&pool).await;
        let fid = create_feature(&pool, proj, "Feature", "ws-feature").await.unwrap();

        let item_id = insert_queue_item(&pool, fid, "feature_build", "execute", Some(1), "draft", 0, Some(0))
            .await
            .unwrap();

        let item = get_queue_item(&pool, item_id).await.unwrap().unwrap();
        assert_eq!(item.status, "draft");
        assert_eq!(item.phase_id, Some(1));
        assert_eq!(item.item_type, "execute");
    }

    #[tokio::test]
    async fn test_draft_items_not_returned_by_get_ready_items() {
        let pool = setup_test_db_with_queue().await;
        let proj = create_test_project(&pool).await;
        let fid = create_feature(&pool, proj, "Feature", "ws-feature").await.unwrap();

        insert_queue_item(&pool, fid, "feature_build", "execute", Some(1), "draft", 0, Some(0))
            .await
            .unwrap();
        insert_queue_item(&pool, fid, "feature_build", "execute", Some(2), "ready", 1, Some(0))
            .await
            .unwrap();

        let ready = get_ready_items(&pool, fid).await.unwrap();
        assert_eq!(ready.len(), 1);
        assert_eq!(ready[0].status, "ready");
    }

    #[tokio::test]
    async fn test_upgrade_draft_items_to_ready() {
        let pool = setup_test_db_with_queue().await;
        let proj = create_test_project(&pool).await;
        let fid = create_feature(&pool, proj, "Feature", "ws-feature").await.unwrap();

        let id1 = insert_queue_item(&pool, fid, "feature_build", "execute", Some(1), "draft", 0, Some(0))
            .await.unwrap();
        let id2 = insert_queue_item(&pool, fid, "feature_build", "execute", Some(2), "draft", 1, Some(1))
            .await.unwrap();
        // A non-draft item should not be affected
        let id3 = insert_queue_item(&pool, fid, "feature_build", "execute", Some(3), "blocked", 2, Some(1))
            .await.unwrap();

        // Simulate the upgrade that re_populate_queue_for_new_phases does
        sqlx::query("UPDATE workflow_queue SET status = 'ready' WHERE feature_id = ? AND status = 'draft'")
            .bind(fid)
            .execute(&pool)
            .await
            .unwrap();

        let item1 = get_queue_item(&pool, id1).await.unwrap().unwrap();
        let item2 = get_queue_item(&pool, id2).await.unwrap().unwrap();
        let item3 = get_queue_item(&pool, id3).await.unwrap().unwrap();
        assert_eq!(item1.status, "ready");
        assert_eq!(item2.status, "ready");
        assert_eq!(item3.status, "blocked", "non-draft items should not be upgraded");
    }

    #[tokio::test]
    async fn test_clear_queue_removes_draft_items() {
        let pool = setup_test_db_with_queue().await;
        let proj = create_test_project(&pool).await;
        let fid = create_feature(&pool, proj, "Feature", "ws-feature").await.unwrap();

        insert_queue_item(&pool, fid, "feature_build", "execute", Some(1), "draft", 0, Some(0))
            .await.unwrap();
        insert_queue_item(&pool, fid, "feature_build", "execute", Some(2), "ready", 1, Some(0))
            .await.unwrap();

        clear_queue_for_feature(&pool, fid).await.unwrap();

        let items = get_queue_for_feature(&pool, fid).await.unwrap();
        assert!(items.is_empty(), "clear_queue should remove draft items too");
    }

    #[tokio::test]
    async fn test_unblock_does_not_affect_draft_items() {
        let pool = setup_test_db_with_queue().await;
        let proj = create_test_project(&pool).await;
        let fid = create_feature(&pool, proj, "Feature", "ws-feature").await.unwrap();

        let draft_id = insert_queue_item(&pool, fid, "feature_build", "execute", Some(1), "draft", 0, Some(0))
            .await.unwrap();

        // unblock_ready_items only upgrades 'blocked' → 'ready', not 'draft'
        unblock_ready_items(&pool, fid).await.unwrap();

        let item = get_queue_item(&pool, draft_id).await.unwrap().unwrap();
        assert_eq!(item.status, "draft", "unblock should not touch draft items");
    }
}

use std::collections::HashSet;
use std::path::{Path, PathBuf};

use sqlx::SqlitePool;
use tracing::{info, warn};

mod seed;

/// Inputs for a single startup migration pass.
pub struct MigrationContext<'a> {
    pub pool: &'a SqlitePool,
    /// Path to the SQLite file we'll back up before applying pending migrations.
    /// `None` skips backup (used in tests against `:memory:` or temp files).
    pub db_path: Option<&'a Path>,
    /// Version label used in the backup filename. Falls back to `"unknown"` if `None`.
    pub app_version: Option<&'a str>,
}

#[cfg(test)]
impl<'a> MigrationContext<'a> {
    /// Pool-only context, intended for tests that don't care about backups.
    pub fn pool_only(pool: &'a SqlitePool) -> Self {
        Self {
            pool,
            db_path: None,
            app_version: None,
        }
    }
}

/// Run database migrations defensively.
///
/// For existing databases (detected by the presence of the old Electron `migrations` table),
/// we seed sqlx's `_sqlx_migrations` table so the baseline is marked as already-applied.
/// For fresh databases, sqlx runs the baseline to create the full schema.
///
/// Returns an error if any migration fails — the caller must abort startup.
pub async fn run_migrations(ctx: &MigrationContext<'_>) -> anyhow::Result<()> {
    let migrator = sqlx::migrate!("./migrations");

    let has_old_migrations = sqlx::query_scalar::<_, i32>(
        "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='migrations'",
    )
    .fetch_one(ctx.pool)
    .await?
        > 0;

    if has_old_migrations {
        seed::seed_sqlx_migrations(ctx.pool, &migrator).await?;
    }

    if has_pending_migrations(ctx.pool, &migrator).await? {
        if let Some(db_path) = ctx.db_path {
            match backup_database(ctx.pool, db_path, ctx.app_version).await {
                Ok(Some(backup)) => {
                    emit_phase("backing_up", &backup.display().to_string());
                    info!(backup = %backup.display(), "pre-migration backup written");
                }
                Ok(None) => {}
                Err(error) => {
                    warn!("pre-migration backup failed: {error}");
                    emit_phase("backup_failed", &error.to_string());
                }
            }
        }
        emit_phase("migrating", "");
    }

    migrator.run(ctx.pool).await?;
    seed::repair_agent_sessions_pin_column(ctx.pool).await?;

    info!("Database migrations completed successfully");
    Ok(())
}

/// Marker line consumed by the Electron sidecar to drive the splash status.
/// One line, fixed prefix; keep the format stable — the parser in
/// `packages/desktop/electron/main/sidecar.ts::parsePhaseLine` matches it.
fn emit_phase(name: &str, detail: &str) {
    if detail.is_empty() {
        println!("CADENCR_PHASE {name}");
    } else {
        println!("CADENCR_PHASE {name} {detail}");
    }
}

async fn has_pending_migrations(
    pool: &SqlitePool,
    migrator: &sqlx::migrate::Migrator,
) -> anyhow::Result<bool> {
    let table_present = sqlx::query_scalar::<_, i32>(
        "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='_sqlx_migrations'",
    )
    .fetch_one(pool)
    .await?
        > 0;

    if !table_present {
        return Ok(true);
    }

    let applied: Vec<i64> = sqlx::query_scalar("SELECT version FROM _sqlx_migrations")
        .fetch_all(pool)
        .await?;
    let applied: HashSet<i64> = applied.into_iter().collect();
    for migration in migrator.iter() {
        if !applied.contains(&migration.version) {
            return Ok(true);
        }
    }
    Ok(false)
}

async fn backup_database(
    pool: &SqlitePool,
    db_path: &Path,
    app_version: Option<&str>,
) -> anyhow::Result<Option<PathBuf>> {
    if !db_path.is_file() {
        return Ok(None);
    }
    let dir = db_path
        .parent()
        .ok_or_else(|| anyhow::anyhow!("db path has no parent directory: {}", db_path.display()))?;
    let version = app_version.unwrap_or("unknown");
    let timestamp = chrono::Local::now().format("%Y-%m-%d-%H").to_string();
    let backup = dir.join(format!("{version}.{timestamp}.cadencr.backup.db"));
    if backup.exists() {
        return Ok(Some(backup));
    }
    // `VACUUM INTO` produces a single consistent snapshot that includes
    // anything pending in the WAL — a plain file copy of the `.db` would
    // miss uncommitted data in the `.db-wal` sibling. SQLite writes to a
    // staging path it owns and finalizes atomically; if the process is
    // killed mid-vacuum, only the partial staging file is left behind, never
    // a half-written file with the final name.
    let staging = dir.join(format!("{version}.{timestamp}.cadencr.backup.db.partial"));
    if staging.exists() {
        std::fs::remove_file(&staging)?;
    }
    // SQLite requires a string literal for VACUUM INTO; the path components
    // (`dir`, `version`, `timestamp`) are all under our control and contain
    // no quotes, so concatenation is safe — no SQL-injection vector.
    let staging_str = staging
        .to_str()
        .ok_or_else(|| anyhow::anyhow!("backup path is not valid UTF-8: {}", staging.display()))?;
    sqlx::query(&format!("VACUUM INTO '{staging_str}'"))
        .execute(pool)
        .await?;
    std::fs::rename(&staging, &backup)?;
    Ok(Some(backup))
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
    use sqlx::Row;
    use std::str::FromStr;

    async fn test_pool(path: &str) -> SqlitePool {
        let options = SqliteConnectOptions::from_str(&format!("sqlite:{path}"))
            .unwrap()
            .create_if_missing(true);
        SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(options)
            .await
            .unwrap()
    }

    #[tokio::test]
    async fn test_fresh_db() {
        let tmp = tempfile::NamedTempFile::new().unwrap();
        let path = tmp.path().to_str().unwrap();
        let pool = test_pool(path).await;

        run_migrations(&MigrationContext::pool_only(&pool))
            .await
            .unwrap();

        let tables: Vec<String> = sqlx::query_scalar(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE '_sqlx%' AND name != 'sqlite_sequence' ORDER BY name",
        )
        .fetch_all(&pool)
        .await
        .unwrap();

        for required in [
            "projects",
            "features",
            "agent_sessions",
            "agent_messages",
            "settings",
        ] {
            assert!(tables.contains(&required.to_string()), "missing {required}");
        }
    }

    #[tokio::test]
    async fn test_idempotent() {
        let tmp = tempfile::NamedTempFile::new().unwrap();
        let path = tmp.path().to_str().unwrap();
        let pool = test_pool(path).await;

        run_migrations(&MigrationContext::pool_only(&pool))
            .await
            .unwrap();
        run_migrations(&MigrationContext::pool_only(&pool))
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn backup_runs_when_pending_skips_when_current() {
        let dir = tempfile::tempdir().unwrap();
        let db = dir.path().join("cadencr.db");
        let pool = test_pool(db.to_str().unwrap()).await;
        let ctx = MigrationContext {
            pool: &pool,
            db_path: Some(&db),
            app_version: Some("9.9.9"),
        };

        run_migrations(&ctx).await.unwrap();
        let backups = std::fs::read_dir(dir.path())
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_name().to_string_lossy().starts_with("9.9.9."))
            .count();
        assert_eq!(backups, 1, "first run must back up");

        run_migrations(&ctx).await.unwrap();
        let backups_again = std::fs::read_dir(dir.path())
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_name().to_string_lossy().starts_with("9.9.9."))
            .count();
        assert_eq!(
            backups_again, 1,
            "no pending migrations means no second backup"
        );
    }

    #[tokio::test]
    async fn remove_ws_feature_migration_preserves_live_session_children() {
        const REMOVE_WS_FEATURE_VERSION: i64 = 20260514123657;

        let tmp = tempfile::NamedTempFile::new().unwrap();
        let path = tmp.path().to_str().unwrap();
        let pool = test_pool(path).await;
        create_pre_ws_feature_removal_schema(&pool).await;
        seed_applied_migrations_before(&pool, REMOVE_WS_FEATURE_VERSION).await;

        sqlx::raw_sql(
            r#"INSERT INTO projects (id, name, path) VALUES (1, 'p', '/tmp/p');
            INSERT INTO features (id, project_id, title, status, type, agent_runtime_session) VALUES
                (1, 1, 'Session 1', 'active', 'ws-session', 'opencode'),
                (2, 1, 'Hidden', 'archived', 'ws-session', NULL),
                (3, 1, 'Draft Legacy Session', 'draft', 'ws-session', NULL);
            INSERT INTO settings (key, value) VALUES
                ('model_qa', 'default'),
                ('agent_autonomy', '1');
            INSERT INTO project_settings (project_id, key, value) VALUES
                (1, 'parallel_execution', 'true');
            INSERT INTO feature_settings (feature_id, key, value) VALUES
                (1, 'worktree_path', '/tmp/p'),
                (1, 'model_qa', 'default');"#,
        )
        .execute(&pool)
        .await
        .unwrap();

        run_migrations(&MigrationContext::pool_only(&pool))
            .await
            .unwrap();

        let runtime: String =
            sqlx::query_scalar("SELECT agent_runtime_session FROM features WHERE id = 1")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(runtime, "opencode");

        let setting_count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM feature_settings WHERE feature_id = 1")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(setting_count, 1);

        assert!(table_has_column(&pool, "features", "status").await);
        let statuses: String = sqlx::query_scalar(
            "SELECT group_concat(id || ':' || status, ',') FROM features ORDER BY id",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(statuses, "1:active,2:archived,3:active");
        assert!(!table_has_column(&pool, "agent_sessions", "pending_plan_approval").await);
        for removed_feature_column in [
            "model_qa",
            "agent_runtime_qa",
            "agent_autonomy",
            "parallel_execution",
        ] {
            assert!(
                !table_has_column(&pool, "features", removed_feature_column).await,
                "{removed_feature_column} should be removed from features"
            );
        }
        for removed_project_column in [
            "model_qa",
            "agent_runtime_qa",
            "agent_autonomy",
            "parallel_execution",
            "qa_prompt",
        ] {
            assert!(
                !table_has_column(&pool, "projects", removed_project_column).await,
                "{removed_project_column} should be removed from projects"
            );
        }
        for table in ["settings", "project_settings", "feature_settings"] {
            let count: i64 = sqlx::query_scalar(&format!(
                "SELECT COUNT(*) FROM {table} WHERE key IN ('model_qa', 'agent_autonomy', 'parallel_execution')"
            ))
            .fetch_one(&pool)
            .await
            .unwrap();
            assert_eq!(count, 0, "{table} should not retain legacy EAV keys");
        }
        assert!(!table_exists(&pool, "workflow_queue").await);
    }

    async fn seed_applied_migrations_before(pool: &SqlitePool, version: i64) {
        sqlx::query(
            "CREATE TABLE _sqlx_migrations (
                version BIGINT PRIMARY KEY,
                description TEXT NOT NULL,
                installed_on TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                success BOOLEAN NOT NULL,
                checksum BLOB NOT NULL,
                execution_time BIGINT NOT NULL
            )",
        )
        .execute(pool)
        .await
        .unwrap();

        let migrator = sqlx::migrate!("./migrations");
        for migration in migrator
            .iter()
            .filter(|migration| migration.version < version)
        {
            sqlx::query(
                "INSERT INTO _sqlx_migrations
                 (version, description, installed_on, success, checksum, execution_time)
                 VALUES (?, ?, CURRENT_TIMESTAMP, TRUE, ?, 0)",
            )
            .bind(migration.version)
            .bind(&*migration.description)
            .bind(&*migration.checksum)
            .execute(pool)
            .await
            .unwrap();
        }
    }

    async fn table_exists(pool: &SqlitePool, table_name: &str) -> bool {
        let count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name = ?",
        )
        .bind(table_name)
        .fetch_one(pool)
        .await
        .unwrap();
        count > 0
    }

    async fn table_has_column(pool: &SqlitePool, table_name: &str, column_name: &str) -> bool {
        let escaped_table = table_name.replace('"', "\"\"");
        let rows = sqlx::query(&format!(r#"PRAGMA table_info("{escaped_table}")"#))
            .fetch_all(pool)
            .await
            .unwrap();
        rows.iter().any(|row| {
            let name: String = row.try_get("name").unwrap();
            name == column_name
        })
    }

    async fn create_pre_ws_feature_removal_schema(pool: &SqlitePool) {
        sqlx::raw_sql(
            r#"CREATE TABLE projects (
                id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, path TEXT NOT NULL,
                model_plan TEXT, model_brainstorm TEXT, model_execute TEXT, model_risk TEXT,
                model_review TEXT, model_session TEXT, model_qa TEXT, model_prd TEXT,
                "model_review-fixer" TEXT, model_retro TEXT, model_workflow TEXT,
                agent_runtime_plan TEXT, agent_runtime_prd TEXT, agent_runtime_execute TEXT,
                agent_runtime_risk TEXT, agent_runtime_review TEXT, "agent_runtime_review-fixer" TEXT,
                agent_runtime_session TEXT, agent_runtime_qa TEXT, agent_runtime_retro TEXT,
                agent_autonomy TEXT, parallel_execution TEXT DEFAULT NULL, qa_prompt TEXT
            );
            CREATE TABLE features (
                id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL REFERENCES projects(id),
                title TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft', type TEXT NOT NULL DEFAULT 'feature',
                label TEXT, model_plan TEXT, model_brainstorm TEXT, model_execute TEXT, model_risk TEXT,
                model_review TEXT, model_session TEXT, model_qa TEXT, model_prd TEXT,
                "model_review-fixer" TEXT, model_retro TEXT, model_workflow TEXT, prd TEXT,
                workflow_step TEXT, workflow_config TEXT, workflow_status TEXT NOT NULL DEFAULT 'idle',
                agent_runtime_plan TEXT, agent_runtime_prd TEXT, agent_runtime_execute TEXT,
                agent_runtime_risk TEXT, agent_runtime_review TEXT, "agent_runtime_review-fixer" TEXT,
                agent_runtime_session TEXT, agent_runtime_qa TEXT, agent_runtime_retro TEXT,
                agent_autonomy TEXT, parallel_execution TEXT DEFAULT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE TABLE workflow_queue (id INTEGER PRIMARY KEY, feature_id INTEGER NOT NULL REFERENCES features(id), agent_session_id INTEGER);
            CREATE TABLE workflow_dependencies (id INTEGER PRIMARY KEY, queue_item_id INTEGER NOT NULL REFERENCES workflow_queue(id), depends_on_item_id INTEGER NOT NULL REFERENCES workflow_queue(id));
            CREATE TABLE phases (id INTEGER PRIMARY KEY, plan_id INTEGER NOT NULL);
            CREATE TABLE plans (id INTEGER PRIMARY KEY, feature_id INTEGER NOT NULL REFERENCES features(id));
            CREATE TABLE agent_sessions (id INTEGER PRIMARY KEY, feature_id INTEGER NOT NULL REFERENCES features(id), pending_plan_approval TEXT, pending_prd_approval TEXT, plan_approval_result TEXT, prd_approval_result TEXT, run_id INTEGER, phase_id INTEGER, question_answer_result TEXT);
            CREATE TABLE session_runtime_ids (id INTEGER PRIMARY KEY, session_id INTEGER NOT NULL REFERENCES agent_sessions(id));
            CREATE TABLE agent_messages (id INTEGER PRIMARY KEY, session_id INTEGER NOT NULL REFERENCES agent_sessions(id));
            CREATE TABLE feature_settings (id INTEGER PRIMARY KEY, feature_id INTEGER NOT NULL REFERENCES features(id), key TEXT NOT NULL, value TEXT NOT NULL);
            CREATE TABLE project_settings (project_id INTEGER NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL);
            CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
            CREATE TABLE diff_comments (id INTEGER PRIMARY KEY, feature_id INTEGER NOT NULL REFERENCES features(id));
            CREATE TABLE diff_viewed_files (id INTEGER PRIMARY KEY, feature_id INTEGER NOT NULL REFERENCES features(id));
            CREATE TABLE custom_action_runs (id INTEGER PRIMARY KEY, feature_id INTEGER NOT NULL REFERENCES features(id));
            CREATE TABLE custom_action_variables (id INTEGER PRIMARY KEY, feature_id INTEGER NOT NULL REFERENCES features(id));
            CREATE TABLE custom_action_schedules (id INTEGER PRIMARY KEY, feature_id INTEGER NOT NULL REFERENCES features(id));
            CREATE INDEX idx_agent_sessions_feature_status ON agent_sessions(feature_id);"#,
        )
        .execute(pool)
        .await
        .unwrap();
    }
}

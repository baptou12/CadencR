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
            "plans",
            "phases",
            "agent_sessions",
            "agent_messages",
            "workflow_queue",
            "workflow_dependencies",
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
}

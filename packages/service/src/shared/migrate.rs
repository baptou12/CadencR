use sqlx::SqlitePool;
use tracing::info;

/// Run database migrations defensively.
///
/// For existing databases (detected by the presence of the old Electron `migrations` table),
/// we seed sqlx's `_sqlx_migrations` table so the baseline is marked as already-applied.
/// For fresh databases, sqlx runs the baseline to create the full schema.
///
/// Returns an error if any migration fails — the caller must abort startup.
pub async fn run_migrations(pool: &SqlitePool) -> anyhow::Result<()> {
    let migrator = sqlx::migrate!("./migrations");

    let has_old_migrations = sqlx::query_scalar::<_, i32>(
        "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='migrations'",
    )
    .fetch_one(pool)
    .await?
        > 0;

    if has_old_migrations {
        seed_sqlx_migrations(pool, &migrator).await?;
    }

    migrator.run(pool).await?;

    info!("Database migrations completed successfully");
    Ok(())
}

/// Seed the `_sqlx_migrations` table so sqlx considers existing migrations already applied.
/// This is a one-time operation for databases created by the Electron migration runner.
async fn seed_sqlx_migrations(
    pool: &SqlitePool,
    migrator: &sqlx::migrate::Migrator,
) -> anyhow::Result<()> {
    // If sqlx's table already exists, seeding was already done on a previous launch.
    let has_sqlx_table = sqlx::query_scalar::<_, i32>(
        "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='_sqlx_migrations'",
    )
    .fetch_one(pool)
    .await?
        > 0;

    if has_sqlx_table {
        return Ok(());
    }

    info!("Existing database detected — seeding sqlx migration history");

    // Create the tracking table with the exact schema sqlx expects.
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
    .await?;

    // Mark every embedded migration as already applied.
    for migration in migrator.iter() {
        sqlx::query(
            "INSERT INTO _sqlx_migrations (version, description, installed_on, success, checksum, execution_time)
             VALUES (?, ?, CURRENT_TIMESTAMP, TRUE, ?, 0)",
        )
        .bind(migration.version)
        .bind(&*migration.description)
        .bind(&*migration.checksum)
        .execute(pool)
        .await?;
    }

    info!(
        "Seeded {} migration(s) into _sqlx_migrations",
        migrator.iter().count()
    );
    Ok(())
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

        run_migrations(&pool).await.unwrap();

        // Verify core tables exist
        let tables: Vec<String> = sqlx::query_scalar(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE '_sqlx%' AND name != 'sqlite_sequence' ORDER BY name",
        )
        .fetch_all(&pool)
        .await
        .unwrap();

        assert!(tables.contains(&"projects".to_string()));
        assert!(tables.contains(&"features".to_string()));
        assert!(tables.contains(&"plans".to_string()));
        assert!(tables.contains(&"phases".to_string()));
        assert!(tables.contains(&"agent_sessions".to_string()));
        assert!(tables.contains(&"agent_messages".to_string()));
        assert!(tables.contains(&"workflow_queue".to_string()));
        assert!(tables.contains(&"workflow_dependencies".to_string()));
        assert!(tables.contains(&"settings".to_string()));
    }

    #[tokio::test]
    async fn test_existing_db_seeding() {
        let tmp = tempfile::NamedTempFile::new().unwrap();
        let path = tmp.path().to_str().unwrap();
        let pool = test_pool(path).await;

        // Simulate an existing DB: create the old migrations table and the full schema.
        // The old migrations table signals this is a pre-existing database.
        sqlx::query(
            "CREATE TABLE migrations (
                version INTEGER PRIMARY KEY,
                description TEXT NOT NULL,
                applied_at TEXT NOT NULL DEFAULT (datetime('now'))
            )",
        )
        .execute(&pool)
        .await
        .unwrap();

        sqlx::query("INSERT INTO migrations (version, description) VALUES (48, 'latest')")
            .execute(&pool)
            .await
            .unwrap();

        // Create just one table to prove the baseline DDL doesn't fail (IF NOT EXISTS).
        sqlx::query("CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
            .execute(&pool)
            .await
            .unwrap();

        run_migrations(&pool).await.unwrap();

        // _sqlx_migrations should exist with the baseline marked applied
        let count: i32 =
            sqlx::query_scalar("SELECT COUNT(*) FROM _sqlx_migrations WHERE success = TRUE")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert!(count >= 1);

        // Old migrations table should still be intact
        let old_count: i32 = sqlx::query_scalar("SELECT COUNT(*) FROM migrations")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(old_count, 1);
    }

    #[tokio::test]
    async fn test_idempotent() {
        let tmp = tempfile::NamedTempFile::new().unwrap();
        let path = tmp.path().to_str().unwrap();
        let pool = test_pool(path).await;

        run_migrations(&pool).await.unwrap();
        run_migrations(&pool).await.unwrap(); // Should not error
    }
}

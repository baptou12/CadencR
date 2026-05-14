//! Schema seeding for legacy databases and repair of columns sqlx skipped.
//!
//! Split from `mod.rs` to keep that file focused on the run-once orchestration
//! and to honor the project's 400-line file cap.

use sqlx::{Row, SqlitePool};
use tracing::info;

use super::support::table_exists;

/// Seed the `_sqlx_migrations` table so sqlx considers existing migrations already applied.
/// One-time operation for databases originally created by the Electron migration runner.
pub(super) async fn seed_sqlx_migrations(
    pool: &SqlitePool,
    migrator: &sqlx::migrate::Migrator,
) -> anyhow::Result<()> {
    if table_exists(pool, "_sqlx_migrations").await? {
        return Ok(());
    }

    info!("Existing database detected — seeding sqlx migration history");

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

/// Ensure `agent_sessions.is_pinned` exists even when migration history was
/// seeded for an older database and sqlx therefore skipped the add-column DDL.
pub(super) async fn repair_agent_sessions_pin_column(pool: &SqlitePool) -> anyhow::Result<()> {
    if !table_exists(pool, "agent_sessions").await? {
        return Ok(());
    }

    if !table_has_column(pool, "agent_sessions", "is_pinned").await? {
        info!("Repairing missing agent_sessions.is_pinned column");
        sqlx::query("ALTER TABLE agent_sessions ADD COLUMN is_pinned INTEGER NOT NULL DEFAULT 0")
            .execute(pool)
            .await?;
    }

    sqlx::query(
        "CREATE INDEX IF NOT EXISTS idx_agent_sessions_is_pinned ON agent_sessions(is_pinned)",
    )
    .execute(pool)
    .await?;
    Ok(())
}

async fn table_has_column(
    pool: &SqlitePool,
    table_name: &str,
    column_name: &str,
) -> anyhow::Result<bool> {
    let escaped_table = table_name.replace('"', "\"\"");
    let rows = sqlx::query(&format!(r#"PRAGMA table_info("{escaped_table}")"#))
        .fetch_all(pool)
        .await?;
    for row in rows {
        let name: String = row.try_get("name")?;
        if name == column_name {
            return Ok(true);
        }
    }
    Ok(false)
}

#[cfg(test)]
mod tests {
    use super::super::{run_migrations, MigrationContext};
    use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
    use sqlx::SqlitePool;
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
    async fn test_existing_db_seeding() {
        let tmp = tempfile::NamedTempFile::new().unwrap();
        let path = tmp.path().to_str().unwrap();
        let pool = test_pool(path).await;

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

        sqlx::query("CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
            .execute(&pool)
            .await
            .unwrap();

        run_migrations(&MigrationContext::pool_only(&pool))
            .await
            .unwrap();

        let count: i32 =
            sqlx::query_scalar("SELECT COUNT(*) FROM _sqlx_migrations WHERE success = TRUE")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert!(count >= 1);

        let old_count: i32 = sqlx::query_scalar("SELECT COUNT(*) FROM migrations")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(old_count, 1);
    }

    #[tokio::test]
    async fn test_existing_seeded_db_repairs_missing_pin_column() {
        let tmp = tempfile::NamedTempFile::new().unwrap();
        let path = tmp.path().to_str().unwrap();
        let pool = test_pool(path).await;

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
        sqlx::query(
            "CREATE TABLE agent_sessions (
                id INTEGER PRIMARY KEY,
                feature_id INTEGER NOT NULL,
                status TEXT NOT NULL
            )",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query("INSERT INTO agent_sessions (id, feature_id, status) VALUES (1, 1, 'idle')")
            .execute(&pool)
            .await
            .unwrap();

        run_migrations(&MigrationContext::pool_only(&pool))
            .await
            .unwrap();
        run_migrations(&MigrationContext::pool_only(&pool))
            .await
            .unwrap();

        assert!(
            super::table_has_column(&pool, "agent_sessions", "is_pinned")
                .await
                .unwrap()
        );
        let pinned: i64 = sqlx::query_scalar("SELECT is_pinned FROM agent_sessions WHERE id = 1")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(pinned, 0);
    }
}

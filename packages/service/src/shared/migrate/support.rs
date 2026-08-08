use std::collections::HashSet;
use std::path::{Path, PathBuf};

use sqlx::{AssertSqlSafe, Row, SqlitePool};

use crate::shared::startup_progress::run_phase;

pub(super) async fn has_pending_migrations(
    pool: &SqlitePool,
    migrator: &sqlx::migrate::Migrator,
) -> anyhow::Result<bool> {
    if !table_exists(pool, "_sqlx_migrations").await? {
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

pub(super) async fn is_upgrade_migration_pending(
    pool: &SqlitePool,
    version: i64,
) -> anyhow::Result<bool> {
    if !table_exists(pool, "_sqlx_migrations").await? {
        return Ok(false);
    }
    let applied: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM _sqlx_migrations WHERE version = ? AND success = TRUE",
    )
    .bind(version)
    .fetch_one(pool)
    .await?;
    Ok(applied == 0)
}

pub(crate) async fn table_exists(pool: &SqlitePool, table_name: &str) -> anyhow::Result<bool> {
    let count: i32 =
        sqlx::query_scalar("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name = ?")
            .bind(table_name)
            .fetch_one(pool)
            .await?;
    Ok(count > 0)
}

pub(super) async fn table_columns(
    pool: &SqlitePool,
    table_name: &str,
) -> anyhow::Result<HashSet<String>> {
    let escaped_table = table_name.replace('"', "\"\"");
    let rows = sqlx::query(AssertSqlSafe(format!(
        r#"PRAGMA table_info("{escaped_table}")"#
    )))
    .fetch_all(pool)
    .await?;
    let mut columns = HashSet::new();
    for row in rows {
        let name: String = row.try_get("name")?;
        columns.insert(name);
    }
    Ok(columns)
}

pub(super) async fn table_has_column(
    pool: &SqlitePool,
    table_name: &str,
    column_name: &str,
) -> anyhow::Result<bool> {
    Ok(table_columns(pool, table_name).await?.contains(column_name))
}

/// Fail before `VACUUM INTO` if the volume can't hold another copy.
///
/// Without this the snapshot runs until SQLite returns `SQLITE_FULL`, which
/// reads as "the backup failed" — indistinguishable from a permissions problem
/// and reported after minutes of I/O. Checking up front turns it into an
/// actionable message. The margin is the database's own size plus a little
/// headroom: the migration that follows also needs WAL space.
fn ensure_room_for_backup(db_bytes: u64, dir: &Path) -> anyhow::Result<()> {
    let Some(available) = crate::shared::disk_space::available_bytes(dir) else {
        // No answer from the platform is not a reason to block a launch; the
        // VACUUM will surface a real failure if there genuinely is no room.
        return Ok(());
    };
    let needed = db_bytes.saturating_add(db_bytes / 10);
    if available < needed {
        anyhow::bail!(
            "not enough free disk space for a pre-migration backup: {} available, {} needed in {}",
            crate::shared::disk_space::human_bytes(available),
            crate::shared::disk_space::human_bytes(needed),
            dir.display()
        );
    }
    Ok(())
}

pub(super) async fn backup_database(
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
    // Falling back to a literal like "unknown" would file every snapshot taken
    // outside a packaged build under one synthetic version, and rotation keeps
    // the newest snapshot *per version* — so the whole history would collapse to
    // a single file. The crate version is the honest answer and keeps versions
    // distinct.
    let version = app_version.unwrap_or(env!("CARGO_PKG_VERSION"));
    let timestamp = chrono::Local::now().format("%Y-%m-%d-%H").to_string();
    let name = super::backup_rotation::naming::backup_file_name(db_path, version, &timestamp)
        .ok_or_else(|| anyhow::anyhow!("unsafe database backup name or app version: {version}"))?;
    let backup = dir.join(&name);
    if backup.exists() {
        if !backup.is_file() {
            anyhow::bail!(
                "pre-migration backup path is not a regular file: {}",
                backup.display()
            );
        }
        return Ok(Some(backup));
    }

    // `VACUUM INTO` produces a single consistent snapshot that includes
    // anything pending in the WAL; a plain file copy of the `.db` would miss
    // uncommitted data in the `.db-wal` sibling.
    let staging = dir.join(format!("{name}.partial"));
    if staging.exists() {
        // A leftover from a backup that ran out of disk. It is a truncated
        // snapshot, never a restore candidate — `parse_snapshot` rejects the
        // `.partial` suffix precisely so it can't be mistaken for one.
        std::fs::remove_file(&staging)?;
    }
    let db_bytes = std::fs::metadata(db_path)?.len();
    ensure_room_for_backup(db_bytes, dir)?;

    let staging_str = staging
        .to_str()
        .ok_or_else(|| anyhow::anyhow!("backup path is not valid UTF-8: {}", staging.display()))?;
    let detail = format!(
        "Creating a {} safety copy before applying database updates.",
        crate::shared::disk_space::human_bytes(db_bytes)
    );
    run_phase(
        "backing_up",
        &detail,
        sqlx::query("VACUUM INTO ?").bind(staging_str).execute(pool),
    )
    .await?;
    std::fs::rename(&staging, &backup)?;
    Ok(Some(backup))
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::SqlitePoolOptions;

    #[tokio::test]
    async fn special_upgrade_copy_requires_an_existing_migration_history() {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        assert!(!is_upgrade_migration_pending(&pool, 42).await.unwrap());

        sqlx::query(
            "CREATE TABLE _sqlx_migrations (version BIGINT PRIMARY KEY, success BOOLEAN NOT NULL)",
        )
        .execute(&pool)
        .await
        .unwrap();
        assert!(is_upgrade_migration_pending(&pool, 42).await.unwrap());

        sqlx::query("INSERT INTO _sqlx_migrations (version, success) VALUES (42, TRUE)")
            .execute(&pool)
            .await
            .unwrap();
        assert!(!is_upgrade_migration_pending(&pool, 42).await.unwrap());
    }

    #[tokio::test]
    async fn unsafe_version_is_rejected_before_vacuum() {
        let dir = tempfile::tempdir().unwrap();
        let db_path = dir.path().join("source.db");
        let database_url = format!("sqlite://{}?mode=rwc", db_path.display());
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect(&database_url)
            .await
            .unwrap();
        sqlx::query("CREATE TABLE sample (value TEXT)")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO sample (value) VALUES ('preserved')")
            .execute(&pool)
            .await
            .unwrap();

        let error = backup_database(&pool, &db_path, Some("v'quoted"))
            .await
            .unwrap_err();
        assert!(error.to_string().contains("unsafe database backup name"));
    }
}

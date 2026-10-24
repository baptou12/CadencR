use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions};
use sqlx::SqlitePool;
use std::str::FromStr;

#[derive(Debug)]
pub enum QuickCheckError {
    Query(sqlx::Error),
    Corrupt(Vec<String>),
}

impl std::fmt::Display for QuickCheckError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Query(error) => write!(formatter, "database quick_check could not run: {error}"),
            Self::Corrupt(rows) => {
                write!(
                    formatter,
                    "database quick_check failed: {}",
                    rows.join("; ")
                )
            }
        }
    }
}

impl std::error::Error for QuickCheckError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Query(error) => Some(error),
            Self::Corrupt(_) => None,
        }
    }
}

pub async fn run_quick_check(pool: &SqlitePool) -> Result<(), QuickCheckError> {
    let rows = sqlx::query_scalar::<_, String>("PRAGMA quick_check")
        .fetch_all(pool)
        .await
        .map_err(QuickCheckError::Query)?;
    validate_quick_check(rows)
}

fn validate_quick_check(rows: Vec<String>) -> Result<(), QuickCheckError> {
    if rows.len() == 1 && rows[0] == "ok" {
        Ok(())
    } else {
        Err(QuickCheckError::Corrupt(rows))
    }
}

/// Secure the database in place before SQLite opens it. An existing database
/// is only opened and chmodded, never truncated, replaced, or deleted. SQLite
/// derives new WAL/SHM permissions from the main database's 0600 mode.
fn prepare_database(db_path: &str, create: bool) -> anyhow::Result<()> {
    if db_path == ":memory:" {
        return Ok(());
    }
    let path = std::path::Path::new(db_path);
    crate::remote::secure_fs::secure_app_home(path)?;
    if let Ok(data_dir) = crate::shared::app_paths::data_dir() {
        let database_dir = data_dir.join("database");
        if path.parent() == Some(database_dir.as_path()) {
            crate::remote::secure_fs::create_dir_owner_only(&database_dir)?;
        }
    }
    let fs = crate::remote::secure_fs::create_missing_dirs;
    if let Some(parent) = path.parent() {
        fs(parent)?;
    }
    crate::remote::secure_fs::open_owner_only(path, create)?;
    for suffix in ["-wal", "-shm", "-journal"] {
        let mut sibling = path.as_os_str().to_owned();
        sibling.push(suffix);
        let sibling = std::path::PathBuf::from(sibling);
        match std::fs::symlink_metadata(&sibling) {
            Ok(_) => crate::remote::secure_fs::ensure_owner_only(&sibling)?,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.into()),
        }
    }
    Ok(())
}

/// Create a read-only SQLite pool (max 4 connections, query_only pragma).
pub async fn create_read_pool(db_path: &str) -> Result<SqlitePool, sqlx::Error> {
    prepare_database(db_path, false)
        .map_err(|error| sqlx::Error::Io(std::io::Error::other(error.to_string())))?;
    let options = SqliteConnectOptions::from_str(&format!("sqlite:{db_path}"))?
        .journal_mode(SqliteJournalMode::Wal)
        .busy_timeout(std::time::Duration::from_millis(5000))
        .pragma("journal_size_limit", "67108864")
        .pragma("query_only", "true")
        .read_only(true);

    SqlitePoolOptions::new()
        .max_connections(4)
        .connect_with(options)
        .await
}

/// Create a read-write SQLite pool (max 1 connection to serialize writes).
pub async fn create_write_pool(db_path: &str) -> Result<SqlitePool, sqlx::Error> {
    prepare_database(db_path, true)
        .map_err(|error| sqlx::Error::Io(std::io::Error::other(error.to_string())))?;
    let options = SqliteConnectOptions::from_str(&format!("sqlite:{db_path}"))?
        .journal_mode(SqliteJournalMode::Wal)
        .busy_timeout(std::time::Duration::from_millis(5000))
        .pragma("journal_size_limit", "67108864")
        .create_if_missing(true);

    SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(options)
        .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(unix)]
    #[test]
    fn database_permissions_preserve_data_and_custom_parent_permissions() {
        use std::os::unix::fs::{MetadataExt, PermissionsExt};
        let dir = tempfile::tempdir().unwrap().keep();
        std::fs::set_permissions(dir.as_path(), std::fs::Permissions::from_mode(0o755)).unwrap();
        let path = dir.as_path().join("private.db");
        for suffix in ["", "-wal", "-shm", "-journal"] {
            let file = dir.as_path().join(format!("private.db{suffix}"));
            std::fs::write(&file, b"preserved").unwrap();
            std::fs::set_permissions(&file, std::fs::Permissions::from_mode(0o644)).unwrap();
        }
        let inode = std::fs::metadata(&path).unwrap().ino();
        prepare_database(path.to_str().unwrap(), true).unwrap();
        assert_eq!(std::fs::metadata(&path).unwrap().ino(), inode);
        for suffix in ["", "-wal", "-shm", "-journal"] {
            let file = dir.as_path().join(format!("private.db{suffix}"));
            assert_eq!(std::fs::read(&file).unwrap(), b"preserved");
            assert_eq!(
                std::fs::metadata(&file).unwrap().permissions().mode() & 0o777,
                0o600
            );
        }
        assert_eq!(
            std::fs::metadata(dir.as_path())
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o755
        );
    }

    #[tokio::test]
    async fn read_pool_does_not_create_missing_database() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("missing.db");
        assert!(create_read_pool(path.to_str().unwrap()).await.is_err());
        assert!(!path.exists());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn sqlite_creates_private_wal_and_shm_files() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap().keep();
        let path = dir.as_path().join("new.db");
        let pool = create_write_pool(path.to_str().unwrap()).await.unwrap();
        sqlx::query("CREATE TABLE secrets (value TEXT)")
            .execute(&pool)
            .await
            .unwrap();
        for suffix in ["", "-wal", "-shm"] {
            let file = dir.as_path().join(format!("new.db{suffix}"));
            assert_eq!(
                std::fs::metadata(file).unwrap().permissions().mode() & 0o777,
                0o600
            );
        }
        pool.close().await;
    }

    #[test]
    fn quick_check_reports_corruption_with_details() {
        let error = validate_quick_check(vec!["*** in database main ***".to_string()]).unwrap_err();

        assert!(matches!(error, QuickCheckError::Corrupt(_)));
        assert!(error.to_string().contains("quick_check failed"));
    }
}

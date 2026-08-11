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

/// Create a read-only SQLite pool (max 4 connections, query_only pragma).
pub async fn create_read_pool(db_path: &str) -> Result<SqlitePool, sqlx::Error> {
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

    #[test]
    fn quick_check_reports_corruption_with_details() {
        let error = validate_quick_check(vec!["*** in database main ***".to_string()]).unwrap_err();

        assert!(matches!(error, QuickCheckError::Corrupt(_)));
        assert!(error.to_string().contains("quick_check failed"));
    }
}

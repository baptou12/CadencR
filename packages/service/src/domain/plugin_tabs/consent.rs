//! Consent: the user accepted a tab's permissions as of one permissions hash.
//!
//! One row per plugin. Recording consent for a new hash replaces the old one,
//! so a widened manifest is consent-required again until the user re-accepts.

use std::collections::HashMap;

use axum::http::StatusCode;
use sqlx::SqlitePool;

use crate::error::AppError;

/// The hash the user last consented to, if any.
pub async fn consented_hash(
    pool: &SqlitePool,
    plugin_id: &str,
) -> Result<Option<String>, AppError> {
    Ok(
        sqlx::query_scalar("SELECT permissions_hash FROM plugin_tab_consents WHERE plugin_id = ?")
            .bind(plugin_id)
            .fetch_optional(pool)
            .await?,
    )
}

/// Every recorded consent, keyed by plugin id.
pub async fn consented_all(pool: &SqlitePool) -> Result<HashMap<String, String>, AppError> {
    let rows: Vec<(String, String)> =
        sqlx::query_as("SELECT plugin_id, permissions_hash FROM plugin_tab_consents")
            .fetch_all(pool)
            .await?;
    Ok(rows.into_iter().collect())
}

/// Refuse a consent for anything but the `current` hash: the user can only
/// agree to what they were shown, and the manifest may have changed since the
/// dialog opened.
pub fn require_current(plugin_id: &str, current: &str, submitted: &str) -> Result<(), AppError> {
    if submitted == current {
        return Ok(());
    }
    Err(AppError::coded(
        StatusCode::CONFLICT,
        "PLUGIN_TAB_CONSENT_STALE",
        format!(
            "custom tab `{plugin_id}` changed its permissions since they were shown; review them again"
        ),
    ))
}

/// Record consent at `hash`, replacing any older one.
pub async fn record(pool: &SqlitePool, plugin_id: &str, hash: &str) -> Result<(), AppError> {
    sqlx::query(
        "INSERT INTO plugin_tab_consents (plugin_id, permissions_hash, consented_at) \
         VALUES (?, ?, CURRENT_TIMESTAMP) \
         ON CONFLICT (plugin_id) DO UPDATE SET \
         permissions_hash = excluded.permissions_hash, consented_at = excluded.consented_at",
    )
    .bind(plugin_id)
    .bind(hash)
    .execute(pool)
    .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::plugin_tabs::test_support::pool;

    #[tokio::test]
    async fn records_only_the_current_hash_and_replaces_older_consent() {
        let pool = pool().await;
        assert_eq!(consented_hash(&pool, "graph").await.unwrap(), None);
        let stale = require_current("graph", "new", "old").unwrap_err();
        assert!(matches!(
            stale,
            AppError::Coded {
                code: "PLUGIN_TAB_CONSENT_STALE",
                ..
            }
        ));
        assert!(require_current("graph", "h1", "h1").is_ok());
        record(&pool, "graph", "h1").await.unwrap();
        record(&pool, "graph", "h2").await.unwrap();
        assert_eq!(
            consented_hash(&pool, "graph").await.unwrap().as_deref(),
            Some("h2")
        );
    }
}

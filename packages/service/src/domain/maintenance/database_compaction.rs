//! Conservative startup-only SQLite file compaction.
//!
//! Background maintenance shortens rows and drops index entries, but SQLite in
//! `auto_vacuum=NONE` keeps those pages on its freelist. `VACUUM` is the only
//! supported in-place operation that returns them to the filesystem. It runs
//! after the initial lossless optimization has finished, before the read pool
//! or HTTP server exists, and only when a prior maintenance pass requested it.

use std::path::Path;

use anyhow::Context as _;
use sqlx::SqlitePool;

use super::state;
use crate::shared::disk_space;

#[cfg(not(test))]
const MIN_RECLAIM_BYTES: u64 = 64 * 1024 * 1024;
#[cfg(test)]
const MIN_RECLAIM_BYTES: u64 = 1;
const MIN_RECLAIM_PERCENT: u64 = 5;

/// Compact the database if a completed maintenance sweep left enough free
/// pages to justify a rewrite. Returns bytes actually removed from the file.
///
/// The operation never swaps, renames, truncates, or removes the database from
/// application code. SQLite performs its transactional `VACUUM` internally;
/// on any preflight or execution failure the request remains set for a later
/// startup and the caller can continue using the original database.
pub async fn run_if_requested(pool: &SqlitePool, db_path: &Path) -> anyhow::Result<u64> {
    if state::get(pool, state::DATABASE_COMPACTION_REQUESTED)
        .await
        .as_deref()
        != Some("1")
    {
        return Ok(0);
    }

    // Background maintenance may already have requested compaction while its
    // resumable initial pass is still incomplete. Preserve that request and
    // let the application open; the next startup after completion will retry.
    if state::get(pool, state::INITIAL_OPTIMIZATION_COMPLETED)
        .await
        .as_deref()
        != Some("1")
    {
        tracing::info!("database compaction deferred until initial optimization completes");
        return Ok(0);
    }

    crate::shared::startup_progress::run_phase(
        "compacting_database",
        "Checking database integrity before reclaiming unused space.",
        ensure_healthy(pool),
    )
    .await?;
    let page_size = pragma_u64(pool, "PRAGMA page_size").await?;
    let page_count = pragma_u64(pool, "PRAGMA page_count").await?;
    let free_pages = pragma_u64(pool, "PRAGMA freelist_count").await?;
    let reclaimable = page_size.saturating_mul(free_pages);
    let allocated = page_size.saturating_mul(page_count);
    let reclaim_percent = reclaimable.saturating_mul(100) / allocated.max(1);

    if reclaimable < MIN_RECLAIM_BYTES || reclaim_percent < MIN_RECLAIM_PERCENT {
        state::set(pool, state::DATABASE_COMPACTION_REQUESTED, "0").await;
        return Ok(0);
    }

    let dir = db_path
        .parent()
        .ok_or_else(|| anyhow::anyhow!("database path has no parent: {}", db_path.display()))?;
    let db_bytes = std::fs::metadata(db_path)?.len();
    let available = disk_space::available_bytes(dir).ok_or_else(|| {
        anyhow::anyhow!(
            "cannot determine free disk space for database compaction in {}",
            dir.display()
        )
    })?;
    let needed = db_bytes.saturating_add(db_bytes / 10);
    if available < needed {
        anyhow::bail!(
            "not enough free disk space to compact the database safely: {} available, {} needed",
            disk_space::human_bytes(available),
            disk_space::human_bytes(needed)
        );
    }

    tracing::info!(
        reclaimable_bytes = reclaimable,
        "compacting SQLite freelist at startup"
    );
    let detail = format!(
        "Rewriting the database to reclaim {} of unused space. Conversations are preserved.",
        disk_space::human_bytes(reclaimable)
    );
    crate::shared::startup_progress::run_phase(
        "compacting_database",
        &detail,
        sqlx::query("VACUUM").execute(pool),
    )
    .await
    .context("SQLite VACUUM failed; the original database remains usable")?;
    crate::shared::startup_progress::run_phase(
        "compacting_database",
        "Verifying database integrity after reclaiming space.",
        ensure_healthy(pool),
    )
    .await?;

    state::set(pool, state::DATABASE_COMPACTION_REQUESTED, "0").await;
    let after = std::fs::metadata(db_path)?.len();
    Ok(db_bytes.saturating_sub(after))
}

async fn pragma_u64(pool: &SqlitePool, sql: &'static str) -> anyhow::Result<u64> {
    let value = sqlx::query_scalar::<_, i64>(sql).fetch_one(pool).await?;
    u64::try_from(value).context("SQLite returned a negative page statistic")
}

async fn ensure_healthy(pool: &SqlitePool) -> anyhow::Result<()> {
    let rows = sqlx::query_scalar::<_, String>("PRAGMA quick_check")
        .fetch_all(pool)
        .await?;
    if rows.len() == 1 && rows[0] == "ok" {
        return Ok(());
    }
    anyhow::bail!("database quick_check failed: {}", rows.join("; "))
}

#[cfg(test)]
mod tests {
    use std::str::FromStr;

    use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};

    use super::*;

    async fn file_pool(path: &Path) -> SqlitePool {
        let options = SqliteConnectOptions::from_str(&format!("sqlite:{}", path.display()))
            .unwrap()
            .create_if_missing(true);
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(options)
            .await
            .unwrap();
        sqlx::raw_sql(
            "CREATE TABLE maintenance_state (key TEXT PRIMARY KEY, value TEXT NOT NULL, \
             updated_at TEXT NOT NULL DEFAULT (datetime('now'))); \
             CREATE TABLE payloads (id INTEGER PRIMARY KEY, body BLOB NOT NULL); \
             CREATE TABLE payload_refs (\
                 id INTEGER PRIMARY KEY, \
                 payload_id INTEGER NOT NULL REFERENCES payloads(id), \
                 label TEXT NOT NULL\
             ); \
             CREATE INDEX idx_payload_refs_payload_id ON payload_refs(payload_id);",
        )
        .execute(&pool)
        .await
        .unwrap();
        pool
    }

    async fn seed_fragmented_payloads(pool: &SqlitePool) -> Vec<u8> {
        let payload = vec![0xAB; 128 * 1024];
        for id in 1..=24i64 {
            sqlx::query("INSERT INTO payloads (id, body) VALUES (?, ?)")
                .bind(id)
                .bind(&payload)
                .execute(pool)
                .await
                .unwrap();
        }
        sqlx::query("DELETE FROM payloads WHERE id <= 20")
            .execute(pool)
            .await
            .unwrap();
        payload
    }

    #[tokio::test]
    async fn vacuum_reclaims_only_free_pages_and_preserves_rows() {
        let tmp = tempfile::NamedTempFile::new().unwrap();
        let pool = file_pool(tmp.path()).await;
        let payload = seed_fragmented_payloads(&pool).await;
        for id in 21..=24i64 {
            sqlx::query("INSERT INTO payload_refs (id, payload_id, label) VALUES (?, ?, ?)")
                .bind(id)
                .bind(id)
                .bind(format!("reference-{id}"))
                .execute(&pool)
                .await
                .unwrap();
        }
        state::set(&pool, state::DATABASE_COMPACTION_REQUESTED, "1").await;
        state::set(&pool, state::INITIAL_OPTIMIZATION_COMPLETED, "1").await;
        let schema_before = sqlite_schema(&pool).await;

        let before = std::fs::metadata(tmp.path()).unwrap().len();
        let reclaimed = run_if_requested(&pool, tmp.path()).await.unwrap();
        let after = std::fs::metadata(tmp.path()).unwrap().len();

        assert!(reclaimed > 0);
        assert!(after < before);
        let remaining =
            sqlx::query_as::<_, (i64, Vec<u8>)>("SELECT id, body FROM payloads ORDER BY id")
                .fetch_all(&pool)
                .await
                .unwrap();
        assert_eq!(remaining.len(), 4);
        for (offset, (id, body)) in remaining.iter().enumerate() {
            assert_eq!(*id, 21 + offset as i64);
            assert_eq!(body, &payload);
        }
        let refs = sqlx::query_as::<_, (i64, i64, String)>(
            "SELECT id, payload_id, label FROM payload_refs ORDER BY id",
        )
        .fetch_all(&pool)
        .await
        .unwrap();
        assert_eq!(
            refs,
            (21..=24)
                .map(|id| (id, id, format!("reference-{id}")))
                .collect::<Vec<_>>()
        );
        assert_eq!(sqlite_schema(&pool).await, schema_before);
        let foreign_key_errors = sqlx::query_scalar::<_, String>("PRAGMA foreign_key_check")
            .fetch_all(&pool)
            .await
            .unwrap();
        assert!(foreign_key_errors.is_empty());
        assert_eq!(
            state::get(&pool, state::DATABASE_COMPACTION_REQUESTED)
                .await
                .as_deref(),
            Some("0")
        );
        ensure_healthy(&pool).await.unwrap();
    }

    async fn sqlite_schema(pool: &SqlitePool) -> Vec<(String, String, String)> {
        sqlx::query_as(
            "SELECT type, name, sql FROM sqlite_schema \
             WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name",
        )
        .fetch_all(pool)
        .await
        .unwrap()
    }

    #[tokio::test]
    async fn does_nothing_without_an_explicit_request() {
        let tmp = tempfile::NamedTempFile::new().unwrap();
        let pool = file_pool(tmp.path()).await;

        assert_eq!(run_if_requested(&pool, tmp.path()).await.unwrap(), 0);
    }

    #[tokio::test]
    async fn waits_for_initial_optimization_before_vacuuming() {
        let tmp = tempfile::NamedTempFile::new().unwrap();
        let pool = file_pool(tmp.path()).await;
        seed_fragmented_payloads(&pool).await;
        state::set(&pool, state::DATABASE_COMPACTION_REQUESTED, "1").await;
        let before = std::fs::metadata(tmp.path()).unwrap().len();

        assert_eq!(run_if_requested(&pool, tmp.path()).await.unwrap(), 0);
        assert_eq!(std::fs::metadata(tmp.path()).unwrap().len(), before);
        assert_eq!(
            state::get(&pool, state::DATABASE_COMPACTION_REQUESTED)
                .await
                .as_deref(),
            Some("1"),
            "the pending compaction must survive until the backfill finishes"
        );

        state::set(&pool, state::INITIAL_OPTIMIZATION_COMPLETED, "1").await;
        assert!(run_if_requested(&pool, tmp.path()).await.unwrap() > 0);
    }
}

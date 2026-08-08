use sqlx::SqlitePool;

use super::super::compaction;
use super::super::{StorageMaintenanceBroadcaster, StorageMaintenanceEvent};
use super::policy::PolicyGuard;
use super::queries::{DUE_FEATURES_SQL, FEATURE_MESSAGE_IDS_SQL, FEATURE_MESSAGE_SQL};

/// Message ids loaded per batch. Payloads are fetched one at a time after this
/// small id page, because the eligible rows can each be many megabytes.
pub(super) const MESSAGE_BATCH: i64 = 16;

/// Pause between batches, so a long sweep never monopolizes the single writer
/// while the user is driving an agent.
const BATCH_PAUSE: std::time::Duration = std::time::Duration::from_millis(50);

/// Compact every feature whose retention window has elapsed. Returns the number
/// of message rows rewritten.
pub async fn run(pool: &SqlitePool, events: &StorageMaintenanceBroadcaster) -> u64 {
    let Some((days, policy)) = PolicyGuard::configured() else {
        return 0;
    };
    run_with_days(pool, events, days, policy).await
}

async fn run_with_days(
    pool: &SqlitePool,
    events: &StorageMaintenanceBroadcaster,
    days: i64,
    policy: PolicyGuard,
) -> u64 {
    let due = match sqlx::query_scalar::<_, i64>(DUE_FEATURES_SQL)
        .bind(format!("-{days} days"))
        .bind(format!("-{days} days"))
        .fetch_all(pool)
        .await
    {
        Ok(ids) => ids,
        Err(e) => {
            tracing::warn!("retention: failed to list features due for compaction: {e}");
            events.emit(StorageMaintenanceEvent::Failed {
                completed_features: 0,
                failed_features: 0,
                rewritten_messages: 0,
            });
            return 0;
        }
    };
    if due.is_empty() {
        return 0;
    }

    events.emit(StorageMaintenanceEvent::Started {
        features: due.len() as u64,
        window_days: days,
    });

    let total_features = due.len() as u64;
    let mut rewritten = 0u64;
    let mut compacted_features = 0u64;
    let mut failed_features = 0u64;
    let mut cancelled = false;
    for feature_id in due {
        if !policy.is_current(days) {
            tracing::info!("retention: policy changed, stopping active sweep");
            cancelled = true;
            break;
        }
        match compact_feature_guarded(pool, feature_id, days, policy).await {
            Ok(rows) => {
                rewritten += rows;
                // A user can disable retention or increase the quiet period
                // while this feature is being walked. Do not stamp it complete
                // under a policy that is no longer the one they approved.
                if policy.is_current(days) {
                    match stamp_compacted(pool, feature_id, days).await {
                        Ok(true) => compacted_features += 1,
                        Ok(false) => tracing::info!(
                            feature_id,
                            "retention: feature became ineligible before completion stamp"
                        ),
                        Err(error) => {
                            failed_features += 1;
                            tracing::warn!(
                                feature_id,
                                "retention: failed to stamp compacted_at: {error}"
                            );
                        }
                    }
                } else {
                    tracing::info!("retention: policy changed, stopping active sweep");
                    cancelled = true;
                    break;
                }
            }
            // Leave `compacted_at` unset so the next sweep retries this feature.
            Err(e) => {
                failed_features += 1;
                tracing::warn!(feature_id, "retention: compaction failed: {e}");
            }
        }
    }

    let event = if cancelled {
        StorageMaintenanceEvent::Cancelled {
            completed_features: compacted_features,
            remaining_features: total_features.saturating_sub(compacted_features + failed_features),
            rewritten_messages: rewritten,
        }
    } else if failed_features == 0 {
        StorageMaintenanceEvent::Completed {
            features: compacted_features,
            rewritten_messages: rewritten,
        }
    } else {
        StorageMaintenanceEvent::Failed {
            completed_features: compacted_features,
            failed_features,
            rewritten_messages: rewritten,
        }
    };
    events.emit(event);

    if rewritten > 0 {
        tracing::info!(
            features = compacted_features,
            rows = rewritten,
            window_days = days,
            "compacted archived features; run VACUUM to reclaim the file space"
        );
    }
    rewritten
}

/// Walk one feature's tool messages, compacting each. Errors abort this feature
/// only — rows already rewritten stay rewritten, which is safe because the
/// transform is idempotent.
#[cfg(test)]
pub(super) async fn compact_feature(
    pool: &SqlitePool,
    feature_id: i64,
    days: i64,
) -> Result<u64, sqlx::Error> {
    compact_feature_guarded(pool, feature_id, days, PolicyGuard::testing(|_| true)).await
}

#[cfg(test)]
pub(super) async fn compact_feature_with_policy(
    pool: &SqlitePool,
    feature_id: i64,
    days: i64,
    check: fn(i64) -> bool,
) -> Result<u64, sqlx::Error> {
    compact_feature_guarded(pool, feature_id, days, PolicyGuard::testing(check)).await
}

async fn compact_feature_guarded(
    pool: &SqlitePool,
    feature_id: i64,
    days: i64,
    policy: PolicyGuard,
) -> Result<u64, sqlx::Error> {
    let mut cursor = 0i64;
    let mut rewritten = 0u64;

    loop {
        // The due list was snapshotted before the walk began, and a large
        // backlog takes minutes to work through. Re-check every batch so a
        // feature the user pulls back out of the archive mid-sweep stops being
        // compacted at the next batch boundary rather than at the end.
        if !policy.is_current(days) {
            tracing::info!(feature_id, "retention: policy changed, stopping feature");
            return Ok(rewritten);
        }
        if !still_eligible(pool, feature_id, days).await? {
            tracing::info!(
                feature_id,
                "retention: feature became active or received recent activity, stopping"
            );
            return Ok(rewritten);
        }

        let ids = sqlx::query_scalar::<_, i64>(FEATURE_MESSAGE_IDS_SQL)
            .bind(feature_id)
            .bind(cursor)
            .bind(MESSAGE_BATCH)
            .fetch_all(pool)
            .await?;
        if ids.is_empty() {
            return Ok(rewritten);
        }

        for id in ids {
            cursor = id;
            let Some(content) = sqlx::query_scalar::<_, String>(FEATURE_MESSAGE_SQL)
                .bind(id)
                .fetch_optional(pool)
                .await?
            else {
                continue;
            };
            let Some(compacted) = compaction::compact_bash_content_async(content).await else {
                continue;
            };
            if !policy.is_current(days) {
                tracing::info!(feature_id, "retention: policy changed, stopping feature");
                return Ok(rewritten);
            }
            if store_compacted_if_eligible(pool, feature_id, id, &compacted, days).await? {
                rewritten += 1;
            } else if !still_eligible(pool, feature_id, days).await? {
                tracing::info!(
                    feature_id,
                    "retention: feature became active or received recent activity before a message update, stopping"
                );
                return Ok(rewritten);
            }
        }

        tokio::time::sleep(BATCH_PAUSE).await;
    }
}

/// Persist one lossy rewrite only while its owning feature is still eligible.
///
/// The archive and latest-activity checks are part of the same SQLite statement
/// as the update. A separate preflight leaves a race where `update_status` can
/// restore the feature, or a schedule can add a message, before this write.
pub(super) async fn store_compacted_if_eligible(
    pool: &SqlitePool,
    feature_id: i64,
    message_id: i64,
    compacted: &str,
    days: i64,
) -> Result<bool, sqlx::Error> {
    sqlx::query(
        "UPDATE agent_messages SET content = ? \
         WHERE id = ? AND EXISTS ( \
           SELECT 1 FROM agent_sessions s \
           JOIN features f ON f.id = s.feature_id \
           WHERE s.id = agent_messages.session_id \
             AND f.id = ? AND f.status = 'archived' \
             AND f.archived_at <= datetime('now', ?) \
             AND NOT EXISTS ( \
               SELECT 1 FROM agent_sessions recent_s \
               JOIN agent_messages recent_m ON recent_m.session_id = recent_s.id \
               WHERE recent_s.feature_id = f.id \
                 AND recent_m.created_at > datetime('now', ?) \
             ) \
         )",
    )
    .bind(compacted)
    .bind(message_id)
    .bind(feature_id)
    .bind(format!("-{days} days"))
    .bind(format!("-{days} days"))
    .execute(pool)
    .await
    .map(|result| result.rows_affected() == 1)
}

async fn still_eligible(
    pool: &SqlitePool,
    feature_id: i64,
    days: i64,
) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM features f \
         WHERE f.id = ? AND f.status = 'archived' \
           AND f.archived_at <= datetime('now', ?) \
           AND NOT EXISTS ( \
             SELECT 1 FROM agent_sessions s \
             JOIN agent_messages m ON m.session_id = s.id \
             WHERE s.feature_id = f.id AND m.created_at > datetime('now', ?) \
           )",
    )
    .bind(feature_id)
    .bind(format!("-{days} days"))
    .bind(format!("-{days} days"))
    .fetch_one(pool)
    .await
    .map(|count| count > 0)
}

/// Stamp the feature only if it is still archived and still past both clocks.
///
/// A user can un-archive a feature while the sweep is walking it. `update_status`
/// clears `compacted_at` on the way out, so an unguarded stamp here would race
/// it and leave a stale timestamp on an active feature — which
/// `DUE_FEATURES_SQL` reads as "already done", permanently excluding the feature
/// from every future sweep.
pub(super) async fn stamp_compacted(
    pool: &SqlitePool,
    feature_id: i64,
    days: i64,
) -> Result<bool, sqlx::Error> {
    sqlx::query(
        "UPDATE features SET compacted_at = datetime('now') \
         WHERE id = ? AND status = 'archived' \
           AND archived_at <= datetime('now', ?) \
           AND NOT EXISTS ( \
             SELECT 1 FROM agent_sessions s \
             JOIN agent_messages m ON m.session_id = s.id \
             WHERE s.feature_id = features.id AND m.created_at > datetime('now', ?) \
           )",
    )
    .bind(feature_id)
    .bind(format!("-{days} days"))
    .bind(format!("-{days} days"))
    .execute(pool)
    .await
    .map(|result| result.rows_affected() == 1)
}

#[cfg(test)]
pub(super) async fn run_for_test(
    pool: &SqlitePool,
    events: &StorageMaintenanceBroadcaster,
    days: i64,
) -> u64 {
    run_with_days(pool, events, days, PolicyGuard::testing(|_| true)).await
}

#[cfg(test)]
pub(super) async fn run_for_test_with_policy(
    pool: &SqlitePool,
    events: &StorageMaintenanceBroadcaster,
    days: i64,
    check: fn(i64) -> bool,
) -> u64 {
    run_with_days(pool, events, days, PolicyGuard::testing(check)).await
}

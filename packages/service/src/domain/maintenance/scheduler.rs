use sqlx::SqlitePool;

use super::{
    run_cleanup_once, run_once, StorageMaintenanceBroadcaster, StorageMaintenanceRunGuard,
};

/// Delay before the first sweep, so maintenance never competes with session
/// restore, worktree scanning, and the rest of a cold launch.
const STARTUP_DELAY: std::time::Duration = std::time::Duration::from_secs(30);

/// Gap between sweeps. Long: the passes are cursor-based, so a sweep with
/// nothing to do is nearly free, and there is no urgency to reclaiming bytes.
const SWEEP_INTERVAL: std::time::Duration = std::time::Duration::from_secs(6 * 60 * 60);

/// Spawn the periodic maintenance loop. Detached: the caller doesn't wait on it
/// and it has no shutdown signal, because every pass is safe to abandon
/// mid-flight — the cursor simply stays where it was.
pub fn spawn(pool: SqlitePool, events: StorageMaintenanceBroadcaster) {
    tokio::spawn(async move {
        tokio::time::sleep(STARTUP_DELAY).await;
        loop {
            if let Some(_run) = events.try_begin_run() {
                run_once(&pool, &events).await;
            }
            tokio::time::sleep(SWEEP_INTERVAL).await;
        }
    });
}

/// Start a user-requested cleanup after the route has reserved the runner.
pub(super) fn spawn_cleanup(
    pool: SqlitePool,
    events: StorageMaintenanceBroadcaster,
    run: StorageMaintenanceRunGuard,
) {
    tokio::spawn(async move {
        run_cleanup_once(&pool, &events).await;
        drop(run);
    });
}

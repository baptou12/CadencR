use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use tokio::sync::Mutex;
use tokio::task::JoinHandle;
use tracing::{info, warn};

use super::models::TriggeredBy;
use super::repository;
use super::runner;
use crate::app_state::AppState;
use crate::error::AppError;

/// Owns one tokio task per `(action_id, feature_id)` schedule. Cheaply cloneable
/// because the inner state is behind an Arc.
///
/// We key the in-memory map by `(action_id, feature_id)` rather than the SQLite
/// row id so we can stop a tracked task even after the row has been deleted —
/// the disable path removes the row first, leaving no row id to recover.
#[derive(Clone, Default)]
pub struct CustomActionScheduler {
    inner: Arc<Mutex<HashMap<(i64, i64), Entry>>>,
}

#[derive(Debug)]
struct Entry {
    handle: JoinHandle<()>,
    interval_seconds: i64,
}

impl CustomActionScheduler {
    pub fn new() -> Self {
        Self::default()
    }

    /// Load every enabled schedule from the DB and start a tokio task for each.
    pub async fn bootstrap(&self, state: &AppState) {
        let schedules = match repository::list_enabled_schedules(&state.read_pool).await {
            Ok(s) => s,
            Err(e) => {
                warn!(error = %e, "failed to load custom action schedules at startup");
                return;
            }
        };
        info!(count = schedules.len(), "starting custom action schedulers");
        for sched in schedules {
            self.spawn_one(
                state.clone(),
                sched.action_id,
                sched.feature_id,
                sched.interval_seconds,
            )
            .await;
        }
    }

    /// Apply a `PUT /schedule` change. Idempotent; cheap when the new state
    /// already matches the running task's interval (we skip the abort+respawn
    /// so the user can't reset the timer mid-cycle by re-saving the same
    /// values).
    pub async fn apply_change(
        &self,
        state: &AppState,
        action_id: i64,
        feature_id: i64,
    ) -> Result<(), AppError> {
        let row = repository::get_schedule(&state.read_pool, action_id, feature_id).await?;
        let target = row.filter(|s| s.enabled).map(|s| s.interval_seconds);

        let key = (action_id, feature_id);
        let mut guard = self.inner.lock().await;
        let current = guard.get(&key).map(|e| e.interval_seconds);
        if current == target {
            return Ok(());
        }
        if let Some(prev) = guard.remove(&key) {
            prev.handle.abort();
        }
        drop(guard);

        if let Some(interval_seconds) = target {
            self.spawn_one(state.clone(), action_id, feature_id, interval_seconds)
                .await;
        }
        Ok(())
    }

    /// Cancel every task tied to `action_id`. Called after `DELETE
    /// /custom-actions/{id}` — the SQL cascade has already cleared the
    /// `custom_action_schedules` rows.
    pub async fn stop_for_action(&self, action_id: i64) {
        let mut guard = self.inner.lock().await;
        guard.retain(|(a, _), entry| {
            if *a == action_id {
                entry.handle.abort();
                false
            } else {
                true
            }
        });
    }

    async fn spawn_one(
        &self,
        state: AppState,
        action_id: i64,
        feature_id: i64,
        interval_seconds: i64,
    ) {
        let interval = Duration::from_secs(interval_seconds.max(5) as u64);
        let handle = tokio::spawn(async move {
            let mut ticker = tokio::time::interval(interval);
            ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
            // First tick is immediate; eat it so a freshly-enabled schedule
            // doesn't double-fire.
            ticker.tick().await;
            loop {
                ticker.tick().await;
                // Re-read each tick. Catches the race where the row is deleted
                // between abort scheduling and the next tick firing.
                let schedule =
                    match repository::get_schedule(&state.read_pool, action_id, feature_id).await {
                        Ok(Some(s)) if s.enabled => s,
                        Ok(_) => break,
                        Err(e) => {
                            warn!(error = %e, action_id, feature_id, "schedule lookup failed");
                            break;
                        }
                    };
                if let Err(e) =
                    repository::touch_schedule_last_run(&state.write_pool, schedule.id).await
                {
                    warn!(error = %e, schedule_id = schedule.id, "failed to mark last_run_at");
                }
                if let Err(e) =
                    runner::execute(&state, action_id, feature_id, TriggeredBy::Schedule).await
                {
                    warn!(error = %e, action_id, feature_id, "scheduled run failed");
                }
            }
        });
        // Defensive: if a parallel `spawn_one` raced past `apply_change`'s
        // skip-when-equal check, abort the displaced handle so we never leak.
        if let Some(prev) = self.inner.lock().await.insert(
            (action_id, feature_id),
            Entry {
                handle,
                interval_seconds,
            },
        ) {
            prev.handle.abort();
        }
    }

    #[cfg(test)]
    async fn tracked_keys(&self) -> Vec<(i64, i64)> {
        let mut keys: Vec<_> = self.inner.lock().await.keys().copied().collect();
        keys.sort();
        keys
    }
}

#[cfg(test)]
mod tests {
    use crate::app_state::AppState;
    use crate::domain::custom_actions::models::Scope;
    use crate::domain::custom_actions::repository;
    use sqlx::SqlitePool;

    async fn fixture() -> (AppState, i64, i64) {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        crate::shared::migrate::run_migrations(
            &crate::shared::migrate::MigrationContext::pool_only(&pool),
        )
        .await
        .unwrap();
        let state = AppState::with_pool(pool.clone());
        let project_id: i64 =
            sqlx::query_scalar("INSERT INTO projects (name, path) VALUES (?, ?) RETURNING id")
                .bind("p")
                .bind("/tmp/p")
                .fetch_one(&pool)
                .await
                .unwrap();
        let feature_id: i64 = sqlx::query_scalar(
            "INSERT INTO features (project_id, title) VALUES (?, ?) RETURNING id",
        )
        .bind(project_id)
        .bind("f")
        .fetch_one(&pool)
        .await
        .unwrap();
        let action_id =
            repository::insert(&pool, "n", "echo", None, Scope::Project, Some(project_id))
                .await
                .unwrap();
        (state, action_id, feature_id)
    }

    #[tokio::test]
    async fn apply_change_starts_then_stops_on_disable() {
        let (state, action_id, feature_id) = fixture().await;
        let scheduler = state.custom_action_scheduler.clone();

        repository::upsert_schedule(&state.write_pool, action_id, feature_id, 5, true)
            .await
            .unwrap();
        scheduler
            .apply_change(&state, action_id, feature_id)
            .await
            .unwrap();
        assert_eq!(
            scheduler.tracked_keys().await,
            vec![(action_id, feature_id)]
        );

        // Simulate the disable path: row deleted *before* apply_change is called
        // — the original bug was that we couldn't recover the row id to abort.
        repository::delete_schedule(&state.write_pool, action_id, feature_id)
            .await
            .unwrap();
        scheduler
            .apply_change(&state, action_id, feature_id)
            .await
            .unwrap();
        assert!(scheduler.tracked_keys().await.is_empty());
    }

    #[tokio::test]
    async fn apply_change_skips_no_op_when_interval_unchanged() {
        let (state, action_id, feature_id) = fixture().await;
        let scheduler = state.custom_action_scheduler.clone();

        repository::upsert_schedule(&state.write_pool, action_id, feature_id, 30, true)
            .await
            .unwrap();
        scheduler
            .apply_change(&state, action_id, feature_id)
            .await
            .unwrap();
        let first = scheduler.tracked_keys().await;

        // Re-applying with the same interval should be a no-op (no abort/respawn).
        scheduler
            .apply_change(&state, action_id, feature_id)
            .await
            .unwrap();
        let second = scheduler.tracked_keys().await;
        assert_eq!(first, second);
    }

    #[tokio::test]
    async fn apply_change_swaps_when_interval_changes() {
        let (state, action_id, feature_id) = fixture().await;
        let scheduler = state.custom_action_scheduler.clone();

        repository::upsert_schedule(&state.write_pool, action_id, feature_id, 5, true)
            .await
            .unwrap();
        scheduler
            .apply_change(&state, action_id, feature_id)
            .await
            .unwrap();

        repository::upsert_schedule(&state.write_pool, action_id, feature_id, 60, true)
            .await
            .unwrap();
        scheduler
            .apply_change(&state, action_id, feature_id)
            .await
            .unwrap();

        let entry_interval = scheduler
            .inner
            .lock()
            .await
            .get(&(action_id, feature_id))
            .unwrap()
            .interval_seconds;
        assert_eq!(entry_interval, 60);
    }

    #[tokio::test]
    async fn stop_for_action_aborts_every_feature() {
        let (state, action_id, feature_id) = fixture().await;
        let scheduler = state.custom_action_scheduler.clone();

        let other_feature: i64 = sqlx::query_scalar(
            "INSERT INTO features (project_id, title) VALUES (?, ?) RETURNING id",
        )
        .bind(1_i64)
        .bind("f2")
        .fetch_one(&state.write_pool)
        .await
        .unwrap();
        repository::upsert_schedule(&state.write_pool, action_id, feature_id, 5, true)
            .await
            .unwrap();
        repository::upsert_schedule(&state.write_pool, action_id, other_feature, 5, true)
            .await
            .unwrap();
        scheduler
            .apply_change(&state, action_id, feature_id)
            .await
            .unwrap();
        scheduler
            .apply_change(&state, action_id, other_feature)
            .await
            .unwrap();
        assert_eq!(scheduler.tracked_keys().await.len(), 2);

        scheduler.stop_for_action(action_id).await;
        assert!(scheduler.tracked_keys().await.is_empty());
    }
}

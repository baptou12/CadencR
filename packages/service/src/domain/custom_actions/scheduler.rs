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
}

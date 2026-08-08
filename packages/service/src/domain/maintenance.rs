//! Background storage maintenance.
//!
//! Cadencr's database grows without bound: every agent turn appends tool calls
//! and results verbatim, and nothing has ever removed any of it. On a real
//! installation that reached 5.5 GB, of which `agent_messages` was 3.6 GB and
//! its FTS index another 1.5 GB.
//!
//! This job runs the passes that keep that in check. Each pass is independent,
//! resumable, and best-effort — a failure costs disk space, never correctness,
//! so nothing here is allowed to fail startup or a turn.
//!
//! Passes are deliberately ordered cheapest-and-safest first:
//!
//! 1. [`tool_output_backfill`] — lossless. Drops `tool_call` output copies whose
//!    `tool_result` row holds the same bytes. Not gated on any user setting or
//!    retention window, because deleting a verified duplicate can't lose
//!    anything.
//! 2. [`image_backfill`] — lossless. Moves inline base64 images onto disk,
//!    leaving a reference. The bytes are still there, just not in SQLite.
//! 3. [`retention`] — the only lossy pass, and so the only one behind a user
//!    setting and a retention window. Trims oversized tool payloads on features
//!    archived long enough ago. It runs last so the lossless passes have
//!    already shrunk whatever they can, leaving it less to trim.
//!
//! Everything here runs on the write pool, so passes pause between batches
//! rather than holding SQLite's single writer for long stretches. The first
//! historical backfill and every later retention sweep publish determinate
//! progress for the desktop's global sidebar.

pub mod compaction;
pub mod database_compaction;
pub mod image_backfill;
pub mod retention;
pub mod state;
pub mod tool_output_backfill;

use sqlx::SqlitePool;
use std::sync::{Arc, RwLock};
use tokio::sync::broadcast;

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum StorageMaintenanceTask {
    Optimization,
    Cleanup,
}

/// User-visible lifecycle for initial lossless optimization and later cleanup.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(tag = "phase", rename_all = "snake_case")]
pub enum StorageMaintenanceEvent {
    Started {
        task: StorageMaintenanceTask,
        completed: u64,
        total: u64,
    },
    Progress {
        task: StorageMaintenanceTask,
        completed: u64,
        total: u64,
    },
    Completed {
        task: StorageMaintenanceTask,
        completed: u64,
        total: u64,
    },
    Cancelled {
        task: StorageMaintenanceTask,
        completed: u64,
        total: u64,
    },
    Failed {
        task: StorageMaintenanceTask,
        completed: u64,
        total: u64,
    },
}

/// Broadcast plus a reconnect snapshot for a sweep that is currently running.
#[derive(Clone)]
pub struct StorageMaintenanceBroadcaster {
    tx: broadcast::Sender<StorageMaintenanceEvent>,
    active: Arc<RwLock<Option<StorageMaintenanceEvent>>>,
}

impl StorageMaintenanceBroadcaster {
    pub fn new(capacity: usize) -> Self {
        let (tx, _) = broadcast::channel(capacity);
        Self {
            tx,
            active: Arc::new(RwLock::new(None)),
        }
    }

    pub fn subscribe(&self) -> broadcast::Receiver<StorageMaintenanceEvent> {
        self.tx.subscribe()
    }

    pub fn active(&self) -> Option<StorageMaintenanceEvent> {
        match self.active.read() {
            Ok(active) => active.clone(),
            Err(poisoned) => {
                tracing::warn!("storage maintenance state lock was poisoned; recovering");
                poisoned.into_inner().clone()
            }
        }
    }

    pub fn emit(&self, event: StorageMaintenanceEvent) {
        let active = matches!(
            event,
            StorageMaintenanceEvent::Started { .. } | StorageMaintenanceEvent::Progress { .. }
        )
        .then(|| event.clone());
        match self.active.write() {
            Ok(mut stored) => *stored = active,
            Err(poisoned) => {
                tracing::warn!("storage maintenance state lock was poisoned; recovering");
                *poisoned.into_inner() = active;
            }
        }
        // No connected desktop is a normal state during startup and shutdown.
        let _ = self.tx.send(event);
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct OptimizationPlan {
    high_water: i64,
    tool_start: i64,
    image_start: i64,
}

impl OptimizationPlan {
    async fn load(pool: &SqlitePool) -> Result<Self, sqlx::Error> {
        let high_water = sqlx::query_scalar::<_, Option<i64>>("SELECT MAX(id) FROM agent_messages")
            .fetch_one(pool)
            .await?
            .unwrap_or(0);
        Ok(Self {
            high_water,
            tool_start: state::get_i64(pool, state::TOOL_OUTPUT_BACKFILL_CURSOR, 0).await,
            image_start: state::get_i64(pool, state::IMAGE_BACKFILL_CURSOR, 0).await,
        })
    }

    fn total(self) -> u64 {
        remaining(self.tool_start, self.high_water) + remaining(self.image_start, self.high_water)
    }

    fn completed(self, tool_cursor: i64, image_cursor: i64) -> u64 {
        advanced(self.tool_start, tool_cursor, self.high_water)
            + advanced(self.image_start, image_cursor, self.high_water)
    }
}

fn remaining(start: i64, high_water: i64) -> u64 {
    (high_water.max(0) - start.max(0)).max(0) as u64
}

fn advanced(start: i64, cursor: i64, high_water: i64) -> u64 {
    remaining(start, cursor.min(high_water))
}

/// Delay before the first sweep, so maintenance never competes with session
/// restore, worktree scanning, and the rest of a cold launch.
const STARTUP_DELAY: std::time::Duration = std::time::Duration::from_secs(30);

/// Gap between sweeps. Long: the passes are cursor-based, so a sweep with
/// nothing to do is nearly free, and there is no urgency to reclaiming bytes.
const SWEEP_INTERVAL: std::time::Duration = std::time::Duration::from_secs(6 * 60 * 60);

/// Run every maintenance pass once.
pub async fn run_once(pool: &SqlitePool, events: &StorageMaintenanceBroadcaster) {
    let show_optimization = state::get(pool, state::INITIAL_OPTIMIZATION_COMPLETED)
        .await
        .as_deref()
        != Some("1");
    let optimization = if show_optimization {
        match OptimizationPlan::load(pool).await {
            Ok(plan) => Some(plan),
            Err(error) => {
                tracing::warn!("failed to prepare initial storage optimization: {error}");
                events.emit(StorageMaintenanceEvent::Failed {
                    task: StorageMaintenanceTask::Optimization,
                    completed: 0,
                    total: 0,
                });
                None
            }
        }
    } else {
        None
    };
    if let Some(plan) = optimization.filter(|plan| plan.total() > 0) {
        events.emit(StorageMaintenanceEvent::Started {
            task: StorageMaintenanceTask::Optimization,
            completed: 0,
            total: plan.total(),
        });
    }

    let stripped = tool_output_backfill::run_with_progress(pool, |cursor| {
        emit_optimization_progress(events, optimization, cursor, None);
    })
    .await;
    if stripped > 0 {
        tracing::info!(
            stripped,
            "storage maintenance: duplicated tool output removed"
        );
    }
    let tool_cursor = state::get_i64(pool, state::TOOL_OUTPUT_BACKFILL_CURSOR, 0).await;
    let offloaded = image_backfill::run_with_progress(pool, |cursor| {
        emit_optimization_progress(events, optimization, tool_cursor, Some(cursor));
    })
    .await;
    if offloaded > 0 {
        tracing::info!(
            offloaded,
            "storage maintenance: inline images moved to disk"
        );
    }
    finish_initial_optimization(pool, events, optimization).await;
    let compacted = retention::run(pool, events).await;
    if compacted > 0 {
        tracing::info!(
            compacted,
            "storage maintenance: archived features compacted"
        );
    }
    if stripped > 0 || offloaded > 0 || compacted > 0 {
        // `VACUUM` cannot run while the service is serving reads and writes.
        // Request one for the next startup, where only the write pool exists.
        state::set(pool, state::DATABASE_COMPACTION_REQUESTED, "1").await;
    }
}

fn emit_optimization_progress(
    events: &StorageMaintenanceBroadcaster,
    plan: Option<OptimizationPlan>,
    tool_cursor: i64,
    image_cursor: Option<i64>,
) {
    let Some(plan) = plan.filter(|plan| plan.total() > 0) else {
        return;
    };
    events.emit(StorageMaintenanceEvent::Progress {
        task: StorageMaintenanceTask::Optimization,
        completed: plan.completed(tool_cursor, image_cursor.unwrap_or(plan.image_start)),
        total: plan.total(),
    });
}

async fn finish_initial_optimization(
    pool: &SqlitePool,
    events: &StorageMaintenanceBroadcaster,
    plan: Option<OptimizationPlan>,
) {
    let Some(plan) = plan else { return };
    let tool_cursor = state::get_i64(pool, state::TOOL_OUTPUT_BACKFILL_CURSOR, 0).await;
    let image_cursor = state::get_i64(pool, state::IMAGE_BACKFILL_CURSOR, 0).await;
    let completed = plan.completed(tool_cursor, image_cursor);
    let total = plan.total();
    if completed >= total {
        state::set(pool, state::INITIAL_OPTIMIZATION_COMPLETED, "1").await;
        if total > 0 {
            events.emit(StorageMaintenanceEvent::Completed {
                task: StorageMaintenanceTask::Optimization,
                completed,
                total,
            });
        }
    } else if total > 0 {
        events.emit(StorageMaintenanceEvent::Failed {
            task: StorageMaintenanceTask::Optimization,
            completed,
            total,
        });
    }
}

/// Spawn the periodic maintenance loop. Detached: the caller doesn't wait on it
/// and it has no shutdown signal, because every pass is safe to abandon
/// mid-flight — the cursor simply stays where it was.
pub fn spawn(pool: SqlitePool, events: StorageMaintenanceBroadcaster) {
    tokio::spawn(async move {
        tokio::time::sleep(STARTUP_DELAY).await;
        loop {
            run_once(&pool, &events).await;
            tokio::time::sleep(SWEEP_INTERVAL).await;
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn optimization_plan_combines_both_cursor_ranges() {
        let plan = OptimizationPlan {
            high_water: 100,
            tool_start: 20,
            image_start: 40,
        };

        assert_eq!(plan.total(), 140);
        assert_eq!(plan.completed(60, 40), 40);
        assert_eq!(plan.completed(100, 80), 120);
        assert_eq!(plan.completed(120, 120), 140);
    }

    #[test]
    fn optimization_plan_ignores_cursors_past_the_current_high_water() {
        let plan = OptimizationPlan {
            high_water: 100,
            tool_start: 120,
            image_start: 140,
        };

        assert_eq!(plan.total(), 0);
        assert_eq!(plan.completed(150, 160), 0);
    }

    #[test]
    fn broadcaster_snapshots_latest_running_progress_only() {
        let events = StorageMaintenanceBroadcaster::new(4);
        events.emit(StorageMaintenanceEvent::Started {
            task: StorageMaintenanceTask::Optimization,
            completed: 0,
            total: 10,
        });
        events.emit(StorageMaintenanceEvent::Progress {
            task: StorageMaintenanceTask::Optimization,
            completed: 4,
            total: 10,
        });
        assert_eq!(
            events.active(),
            Some(StorageMaintenanceEvent::Progress {
                task: StorageMaintenanceTask::Optimization,
                completed: 4,
                total: 10,
            })
        );

        events.emit(StorageMaintenanceEvent::Completed {
            task: StorageMaintenanceTask::Optimization,
            completed: 10,
            total: 10,
        });
        assert!(events.active().is_none());
    }
}

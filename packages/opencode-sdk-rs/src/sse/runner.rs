use std::sync::Arc;
use std::time::Duration;

use tokio::time::sleep;
use tracing::warn;

use super::dispatcher::SseDispatcher;
use super::lifecycle::DispatcherStatus;
use super::stream::SseStream;
use crate::client::OpenCodeClient;

/// Watchdog: how long we tolerate a connected stream emitting nothing
/// (including SSE comment heartbeats) before treating it as stalled.
///
/// Per OpenCode upstream issue #17769, the server emits SSE heartbeats every
/// 30s. 60s gives a 2x margin for slow networks. Any inbound activity
/// (typed event OR `Event::Open` resurfacing as `ServerConnected`) resets
/// the deadline.
const HEARTBEAT_IDLE_DEADLINE: Duration = Duration::from_secs(60);

/// Backoff for reconnect attempts. Reset to `INITIAL` on the first event
/// after a successful connect, doubled on each failed attempt up to `MAX`.
const RECONNECT_BACKOFF_INITIAL: Duration = Duration::from_millis(250);
const RECONNECT_BACKOFF_MAX: Duration = Duration::from_secs(5);

/// After this many consecutive failed connects we publish
/// `DispatcherStatus::Failed` and switch to a slow permanent retry. The
/// service adapter uses the Failed signal to surface a hard error to the
/// UI (with a manual retry button) instead of leaving an infinite loader.
const FAILURE_THRESHOLD: u32 = 20;
const PERMANENT_RETRY_INTERVAL: Duration = Duration::from_secs(30);

/// Spawn the dispatcher's reconnect loop. Owns its own task; the dispatcher
/// itself only holds state (subscribers, lifecycle bus, etc.).
pub(super) fn spawn(
    dispatcher: Arc<SseDispatcher>,
    client: OpenCodeClient,
    directory: Option<String>,
) {
    tokio::spawn(async move {
        run(dispatcher, client, directory).await;
    });
}

async fn run(dispatcher: Arc<SseDispatcher>, client: OpenCodeClient, directory: Option<String>) {
    let mut should_reconcile = false;
    let mut consecutive_failures: u32 = 0;
    let mut backoff = RECONNECT_BACKOFF_INITIAL;
    let mut hard_failed = false;

    loop {
        // 1. Connect attempt.
        let stream = match client.event_stream_for_directory(directory.as_deref()) {
            Ok(stream) => stream,
            Err(error) => {
                let last_error = error.to_string();
                consecutive_failures = consecutive_failures.saturating_add(1);
                warn!(
                    error = %last_error,
                    attempt = consecutive_failures,
                    "opencode SSE connect failed"
                );
                dispatcher
                    .lifecycle
                    .publish(DispatcherStatus::Reconnecting {
                        attempt: consecutive_failures,
                        last_error: Some(last_error.clone()),
                    });
                if !hard_failed && consecutive_failures >= FAILURE_THRESHOLD {
                    hard_failed = true;
                    dispatcher
                        .lifecycle
                        .publish(DispatcherStatus::Failed { error: last_error });
                }
                let sleep_for = if hard_failed {
                    PERMANENT_RETRY_INTERVAL
                } else {
                    backoff
                };
                sleep(sleep_for).await;
                backoff = next_backoff(backoff);
                continue;
            }
        };

        // 2. Connected. Reset failure tracking and announce.
        consecutive_failures = 0;
        backoff = RECONNECT_BACKOFF_INITIAL;
        hard_failed = false;
        dispatcher.lifecycle.publish(DispatcherStatus::Connected);

        // 3. Reconcile after reconnect (if this isn't the first connect).
        if should_reconcile {
            run_reconcile(&dispatcher, &client, directory.as_deref()).await;
        }

        // 4. Read events until stream errors / ends / stalls.
        let exit_reason = run_event_loop(&dispatcher, stream).await;

        // 5. Drop all subscribers so service adapters auto-resubscribe on
        //    fresh connections. Without this the receivers block forever
        //    and the UI freezes silently — see plan finding #1.
        dispatcher.drop_all_subscribers().await;

        // 6. Announce reconnecting and back off before the next attempt.
        consecutive_failures = consecutive_failures.saturating_add(1);
        dispatcher
            .lifecycle
            .publish(DispatcherStatus::Reconnecting {
                attempt: consecutive_failures,
                last_error: Some(exit_reason),
            });
        should_reconcile = true;
        sleep(backoff).await;
        backoff = next_backoff(backoff);
    }
}

/// Inner read loop. Returns a human-readable exit reason on disconnect.
async fn run_event_loop(dispatcher: &Arc<SseDispatcher>, mut stream: SseStream) -> String {
    loop {
        match tokio::time::timeout(HEARTBEAT_IDLE_DEADLINE, stream.next()).await {
            Ok(Some(Ok(event))) => dispatcher.dispatch_live(event).await,
            Ok(Some(Err(error))) => {
                warn!(error = %error, "opencode SSE stream error");
                return format!("stream error: {error}");
            }
            Ok(None) => {
                warn!("opencode SSE stream ended (EOF)");
                return "stream ended (EOF)".to_string();
            }
            Err(_) => {
                let secs = HEARTBEAT_IDLE_DEADLINE.as_secs();
                warn!(
                    idle_secs = secs,
                    "opencode SSE stream stalled (no heartbeat)"
                );
                dispatcher
                    .lifecycle
                    .publish(DispatcherStatus::StalledNoHeartbeat {
                        since: HEARTBEAT_IDLE_DEADLINE,
                    });
                return format!("no heartbeat for {secs}s");
            }
        }
    }
}

async fn run_reconcile(
    dispatcher: &Arc<SseDispatcher>,
    client: &OpenCodeClient,
    directory: Option<&str>,
) {
    let root_session_ids = dispatcher.subscribed_root_session_ids().await;
    if root_session_ids.is_empty() {
        return;
    }

    let replay = dispatcher
        .reconnect_state
        .lock()
        .await
        .reconcile_subscribers(client, directory, &root_session_ids)
        .await;
    let replayed = replay.len();
    for event in replay {
        dispatcher.dispatch_event(event).await;
    }
    // PR-A only signals success at the dispatcher level. Per-session
    // ReconcileFailed/Succeeded is wired in PR-B once `reconcile_subscribers`
    // returns a Result; for now success of the batch is implied by reaching
    // here without a panic. We still emit a single ReconcileSucceeded so the
    // service adapter can clear any "degraded" UI banner.
    if !root_session_ids.is_empty() {
        let session_id = root_session_ids[0].clone();
        dispatcher
            .lifecycle
            .publish(DispatcherStatus::ReconcileSucceeded {
                session_id,
                replayed_events: replayed,
            });
    }
}

fn next_backoff(current: Duration) -> Duration {
    let next = current.saturating_mul(2);
    if next > RECONNECT_BACKOFF_MAX {
        RECONNECT_BACKOFF_MAX
    } else {
        next
    }
}

#[cfg(test)]
mod tests {
    use super::next_backoff;
    use std::time::Duration;

    #[test]
    fn next_backoff_doubles_then_caps() {
        assert_eq!(
            next_backoff(Duration::from_millis(250)),
            Duration::from_millis(500)
        );
        assert_eq!(
            next_backoff(Duration::from_millis(500)),
            Duration::from_secs(1)
        );
        assert_eq!(next_backoff(Duration::from_secs(1)), Duration::from_secs(2));
        assert_eq!(next_backoff(Duration::from_secs(2)), Duration::from_secs(4));
        assert_eq!(next_backoff(Duration::from_secs(4)), Duration::from_secs(5));
        assert_eq!(next_backoff(Duration::from_secs(5)), Duration::from_secs(5));
    }
}

//! Lifecycle plumbing for `stream_loop::spawn_event_loop`.
//!
//! Translates `opencode_sdk_rs::DispatcherStatus` events from the SDK
//! lifecycle bus into provider-neutral `RuntimeStreamStatus` events that
//! the WS bridge surfaces as `session.stream_status` envelopes. This is
//! the path that lets the UI render a "Reconnecting…" banner instead of
//! sitting on a silent loader (plan finding #1).
//!
//! Lives in its own module to keep `stream_loop.rs` under the project's
//! 400-line file-size cap (`.claude/rules/file-size.md`). Tests for the
//! mapping logic stay inline here per `inline-rust-tests.md`.

use opencode_sdk_rs::DispatcherStatus;
use tokio::sync::{broadcast, mpsc};

use crate::domain::agents::adapter::{RuntimeError, RuntimeEvent, RuntimeStreamStatus};

/// Read the next status event when a receiver is provided. Returns a
/// "never resolves" future when called without a receiver — the calling
/// `select!` arm in `stream_loop.rs` is gated by `status_rx.is_some()`
/// so this branch is unreachable in that case, but `select!` still
/// requires the future type.
pub(super) async fn recv_status(
    rx: Option<&mut broadcast::Receiver<DispatcherStatus>>,
) -> Result<DispatcherStatus, broadcast::error::RecvError> {
    match rx {
        Some(rx) => rx.recv().await,
        None => std::future::pending().await,
    }
}

/// Map a `DispatcherStatus` to a `RuntimeStreamStatus` (or terminal
/// error) and forward it to the WS bridge. Returns false if the bridge
/// has gone away (downstream receiver dropped) so the caller exits the
/// loop.
///
/// Mutable flags track:
/// - `was_degraded`: have we previously emitted a `Degraded`? Suppresses
///   duplicate `Recovered` emissions when the dispatcher cycles between
///   `Connected` and `ReconcileSucceeded` without ever degrading.
/// - `had_initial_connect`: is this the first ever `Connected`? The very
///   first connect at startup isn't a "recovery" — don't surface it.
pub(super) async fn forward_status(
    tx: &mpsc::Sender<Result<RuntimeEvent, RuntimeError>>,
    status: DispatcherStatus,
    was_degraded: &mut bool,
    had_initial_connect: &mut bool,
) -> bool {
    let event: Result<RuntimeEvent, RuntimeError> = match status {
        DispatcherStatus::Connected => {
            if !*had_initial_connect {
                *had_initial_connect = true;
                return true;
            }
            if !*was_degraded {
                return true;
            }
            *was_degraded = false;
            Ok(RuntimeEvent::stream_status_event(
                RuntimeStreamStatus::Recovered,
            ))
        }
        DispatcherStatus::Reconnecting {
            attempt,
            last_error,
        } => {
            *was_degraded = true;
            let reason = match last_error {
                Some(error) => format!("reconnecting (attempt {attempt}): {error}"),
                None => format!("reconnecting (attempt {attempt})"),
            };
            Ok(RuntimeEvent::stream_status_event(
                RuntimeStreamStatus::Degraded { reason },
            ))
        }
        DispatcherStatus::StalledNoHeartbeat { since } => {
            *was_degraded = true;
            Ok(RuntimeEvent::stream_status_event(
                RuntimeStreamStatus::Degraded {
                    reason: format!("no heartbeat for {}s", since.as_secs()),
                },
            ))
        }
        DispatcherStatus::ReconcileFailed { session_id, error } => {
            *was_degraded = true;
            Ok(RuntimeEvent::stream_status_event(
                RuntimeStreamStatus::Degraded {
                    reason: format!("reconcile failed for {session_id}: {error}"),
                },
            ))
        }
        DispatcherStatus::ReconcileSucceeded { .. } => {
            if !*was_degraded {
                return true;
            }
            *was_degraded = false;
            Ok(RuntimeEvent::stream_status_event(
                RuntimeStreamStatus::Recovered,
            ))
        }
        DispatcherStatus::Failed { error } => {
            // Hard failure — surface as a terminal error and stop the
            // loop. The service's stream_reader will turn this into a
            // `session.error` envelope; the UI shows a Retry button.
            let _ = tx
                .send(Err(RuntimeError::new(format!(
                    "OpenCode stream failed: {error}"
                ))))
                .await;
            return false;
        }
    };

    tx.send(event).await.is_ok()
}

#[cfg(test)]
mod tests {
    use super::{forward_status, RuntimeStreamStatus};
    use opencode_sdk_rs::DispatcherStatus;
    use tokio::sync::mpsc;

    #[tokio::test]
    async fn first_connected_is_silent_then_reconnecting_and_recovered_pair() {
        let (tx, mut rx) = mpsc::channel(8);
        let mut was_degraded = false;
        let mut had_initial = false;

        // Initial connect: silent (no event sent).
        assert!(
            forward_status(
                &tx,
                DispatcherStatus::Connected,
                &mut was_degraded,
                &mut had_initial
            )
            .await
        );
        assert!(rx.try_recv().is_err(), "first connect must not emit");
        assert!(had_initial);

        // Reconnecting → Degraded event.
        assert!(
            forward_status(
                &tx,
                DispatcherStatus::Reconnecting {
                    attempt: 1,
                    last_error: Some("boom".into())
                },
                &mut was_degraded,
                &mut had_initial
            )
            .await
        );
        let degraded = rx.recv().await.expect("degraded event");
        let degraded = degraded.expect("not an error");
        match degraded.stream_status() {
            Some(RuntimeStreamStatus::Degraded { reason }) => {
                assert!(reason.contains("attempt 1"), "got reason {reason}");
                assert!(reason.contains("boom"));
            }
            other => panic!("expected Degraded, got {other:?}"),
        }
        assert!(was_degraded);

        // Connected after degradation → Recovered.
        assert!(
            forward_status(
                &tx,
                DispatcherStatus::Connected,
                &mut was_degraded,
                &mut had_initial
            )
            .await
        );
        let recovered = rx.recv().await.expect("recovered event").expect("ok");
        assert!(matches!(
            recovered.stream_status(),
            Some(RuntimeStreamStatus::Recovered)
        ));
        assert!(!was_degraded);
    }

    #[tokio::test]
    async fn failed_emits_terminal_error_and_signals_loop_exit() {
        let (tx, mut rx) = mpsc::channel(4);
        let mut was_degraded = false;
        let mut had_initial = true;

        let keep_going = forward_status(
            &tx,
            DispatcherStatus::Failed {
                error: "permanent".into(),
            },
            &mut was_degraded,
            &mut had_initial,
        )
        .await;
        assert!(!keep_going, "Failed must stop the loop");

        let err = rx.recv().await.expect("error event").expect_err("err");
        assert!(err.to_string().contains("permanent"));
    }

    #[tokio::test]
    async fn stalled_and_reconcile_failed_both_emit_degraded() {
        let (tx, mut rx) = mpsc::channel(8);
        let mut was_degraded = false;
        let mut had_initial = true;

        forward_status(
            &tx,
            DispatcherStatus::StalledNoHeartbeat {
                since: std::time::Duration::from_secs(60),
            },
            &mut was_degraded,
            &mut had_initial,
        )
        .await;
        match rx.recv().await.unwrap().unwrap().stream_status() {
            Some(RuntimeStreamStatus::Degraded { reason }) => {
                assert!(reason.contains("60s"))
            }
            other => panic!("expected Degraded, got {other:?}"),
        }

        // Already degraded; ReconcileFailed should still emit (carries
        // a different reason that the UI tooltip should reflect).
        forward_status(
            &tx,
            DispatcherStatus::ReconcileFailed {
                session_id: "ses_x".into(),
                error: "503".into(),
            },
            &mut was_degraded,
            &mut had_initial,
        )
        .await;
        match rx.recv().await.unwrap().unwrap().stream_status() {
            Some(RuntimeStreamStatus::Degraded { reason }) => {
                assert!(reason.contains("ses_x"));
                assert!(reason.contains("503"));
            }
            other => panic!("expected Degraded, got {other:?}"),
        }
    }
}

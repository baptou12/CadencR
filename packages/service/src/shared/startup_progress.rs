use std::future::Future;
use std::io::Write as _;
use std::time::{Duration, Instant};

const HEARTBEAT_INTERVAL: Duration = Duration::from_secs(10);

/// Marker line consumed by the Electron sidecar to drive the splash status.
/// One line, fixed prefix; keep the format stable with `parsePhaseLine`.
pub(crate) fn emit_phase(name: &str, detail: &str) {
    let detail = detail.replace(['\r', '\n'], " ");
    if detail.is_empty() {
        println!("CADENCR_PHASE {name}");
    } else {
        println!("CADENCR_PHASE {name} {detail}");
    }
    // Production pipes stdout into Electron. Flush explicitly so a long SQLite
    // statement cannot leave the user looking at the preceding phase.
    if let Err(error) = std::io::stdout().flush() {
        tracing::warn!("failed to flush startup progress: {error}");
    }
}

/// Run one opaque startup operation while keeping the splash and watchdog live.
/// SQLite does not expose trustworthy percentage progress for VACUUM or a
/// migration statement, so report the exact operation plus honest elapsed time
/// instead of inventing a percentage.
pub(crate) async fn run_phase<T>(name: &str, detail: &str, future: impl Future<Output = T>) -> T {
    emit_phase(name, detail);
    let started = Instant::now();
    let mut heartbeat = tokio::time::interval(HEARTBEAT_INTERVAL);
    heartbeat.tick().await;
    tokio::pin!(future);
    loop {
        tokio::select! {
            result = &mut future => return result,
            _ = heartbeat.tick() => emit_phase(name, &elapsed_detail(detail, started.elapsed())),
        }
    }
}

fn elapsed_detail(detail: &str, elapsed: Duration) -> String {
    let seconds = elapsed.as_secs();
    let elapsed = if seconds < 60 {
        format!("{seconds}s")
    } else {
        format!("{}m {:02}s", seconds / 60, seconds % 60)
    };
    format!("{} Elapsed: {elapsed}.", detail.trim())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn elapsed_detail_is_honest_and_readable() {
        assert_eq!(
            elapsed_detail("Rebuilding search.", Duration::from_secs(9)),
            "Rebuilding search. Elapsed: 9s."
        );
        assert_eq!(
            elapsed_detail("Rebuilding search.", Duration::from_secs(125)),
            "Rebuilding search. Elapsed: 2m 05s."
        );
    }
}

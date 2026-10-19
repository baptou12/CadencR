//! What one tab's backend did in one conversation, across restarts: its
//! stderr tail, its last exit and recent crashes (for crash-loop protection).

use std::collections::VecDeque;
use std::sync::{Mutex, MutexGuard};
use std::time::{Duration, Instant};

use axum::http::StatusCode;
use chrono::{SecondsFormat, Utc};

use super::models::{PluginTabBackendState, PluginTabBackendStatus};
use crate::error::AppError;

/// Lines of stderr kept per backend.
pub const STDERR_TAIL_LINES: usize = 200;
/// Characters kept of one stderr line.
const MAX_STDERR_LINE_CHARS: usize = 2000;
/// Crashes within [`CRASH_WINDOW`] after which Cadencr stops restarting it.
pub const MAX_CRASHES: usize = 3;
pub const CRASH_WINDOW: Duration = Duration::from_secs(60);

#[derive(Debug, Clone)]
pub(super) struct ExitRecord {
    pub code: Option<i32>,
    pub reason: String,
    pub crashed: bool,
}

#[derive(Default)]
struct State {
    stderr: VecDeque<String>,
    starts: u32,
    started_at: Option<String>,
    exited_at: Option<String>,
    last_exit: Option<ExitRecord>,
    crashes: VecDeque<Instant>,
}

#[derive(Default)]
pub(super) struct History {
    state: Mutex<State>,
}

fn now() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true)
}

impl History {
    pub fn push_stderr(&self, line: impl Into<String>) {
        let mut line: String = line.into();
        if line.chars().count() > MAX_STDERR_LINE_CHARS {
            line = line.chars().take(MAX_STDERR_LINE_CHARS).collect::<String>() + "…";
        }
        let mut state = self.lock();
        state.stderr.push_back(line);
        while state.stderr.len() > STDERR_TAIL_LINES {
            state.stderr.pop_front();
        }
    }

    /// A new run starts; returns its number, which its exit is recorded with.
    pub fn record_start(&self) -> u32 {
        let mut state = self.lock();
        state.starts += 1;
        state.started_at = Some(now());
        state.exited_at = None;
        state.last_exit = None;
        state.starts
    }

    /// Run `run` ended. A run replaced meanwhile (its permissions changed and
    /// a new one started) only leaves a log line: the status is the new run's.
    pub fn record_exit(&self, run: u32, exit: ExitRecord) {
        let mut state = self.lock();
        if run != state.starts {
            drop(state);
            self.push_stderr(format!("[cadencr] the previous run ended: {}", exit.reason));
            return;
        }
        if exit.crashed {
            state.crashes.push_back(Instant::now());
        }
        state.exited_at = Some(now());
        state.last_exit = Some(exit);
    }

    /// Forget recent crashes: the user asked for a fresh start.
    pub fn reset_crashes(&self) {
        self.lock().crashes.clear();
    }

    /// 503 `PLUGIN_BACKEND_CRASHING` after [`MAX_CRASHES`] crashes within
    /// [`CRASH_WINDOW`]; the Activity dialog's **Restart** clears it.
    pub fn check_not_crash_looping(&self) -> Result<(), AppError> {
        let mut state = self.lock();
        while state
            .crashes
            .front()
            .is_some_and(|at| at.elapsed() > CRASH_WINDOW)
        {
            state.crashes.pop_front();
        }
        if state.crashes.len() < MAX_CRASHES {
            return Ok(());
        }
        let reason = state
            .last_exit
            .as_ref()
            .map_or_else(String::new, |exit| format!(" (last: {})", exit.reason));
        Err(AppError::coded(
            StatusCode::SERVICE_UNAVAILABLE,
            "PLUGIN_BACKEND_CRASHING",
            format!(
                "the tab's backend crashed {MAX_CRASHES} times in a minute{reason}; restart it from the tab's Activity"
            ),
        ))
    }

    /// The status, given the pid of the run live right now, if any.
    pub fn status(&self, live_pid: Option<u32>) -> PluginTabBackendStatus {
        let state = self.lock();
        let exit = state.last_exit.as_ref();
        let status = match (live_pid, exit) {
            (Some(_), _) => PluginTabBackendState::Running,
            (None, Some(exit)) if exit.crashed => PluginTabBackendState::Crashed,
            (None, _) => PluginTabBackendState::Stopped,
        };
        PluginTabBackendStatus {
            state: status,
            pid: live_pid,
            started_at: state.started_at.clone(),
            exited_at: state.exited_at.clone(),
            exit_code: exit.and_then(|exit| exit.code),
            exit_reason: exit.map(|exit| exit.reason.clone()),
            starts: state.starts,
            stderr_tail: state.stderr.iter().cloned().collect(),
        }
    }

    fn lock(&self) -> MutexGuard<'_, State> {
        // Every update is a few field writes; a panic mid-way leaves a
        // readable state.
        self.state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn crash() -> ExitRecord {
        ExitRecord {
            code: Some(1),
            reason: "exited with status 1".into(),
            crashed: true,
        }
    }

    #[test]
    fn crash_loops_stop_restarts_until_reset() {
        let history = History::default();
        for _ in 0..MAX_CRASHES - 1 {
            let run = history.record_start();
            history.record_exit(run, crash());
        }
        assert!(history.check_not_crash_looping().is_ok());
        let run = history.record_start();
        history.record_exit(run, crash());
        let error = history.check_not_crash_looping().unwrap_err();
        assert!(matches!(
            error,
            AppError::Coded {
                code: "PLUGIN_BACKEND_CRASHING",
                ..
            }
        ));
        history.reset_crashes();
        assert!(history.check_not_crash_looping().is_ok());
    }

    #[test]
    fn status_reflects_the_last_run_and_keeps_a_bounded_tail() {
        let history = History::default();
        assert_eq!(history.status(None).state, PluginTabBackendState::Stopped);
        let run = history.record_start();
        assert_eq!(
            history.status(Some(42)).state,
            PluginTabBackendState::Running
        );
        history.record_exit(run, crash());
        let status = history.status(None);
        assert_eq!(status.state, PluginTabBackendState::Crashed);
        assert_eq!((status.exit_code, status.starts), (Some(1), 1));
        for n in 0..STDERR_TAIL_LINES + 3 {
            history.push_stderr(format!("line {n}"));
        }
        history.push_stderr("x".repeat(MAX_STDERR_LINE_CHARS + 10));
        let tail = history.status(None).stderr_tail;
        assert_eq!(tail.len(), STDERR_TAIL_LINES);
        assert_eq!(tail[0], "line 4");
        assert!(tail.last().unwrap().ends_with('…'));
    }

    #[test]
    fn a_replaced_run_does_not_overwrite_the_live_one() {
        let history = History::default();
        let old = history.record_start();
        history.record_start();
        let stopped = ExitRecord {
            code: Some(0),
            reason: "its permissions changed".into(),
            crashed: false,
        };
        history.record_exit(old, stopped);
        let status = history.status(Some(7));
        assert_eq!(status.state, PluginTabBackendState::Running);
        assert_eq!((status.exited_at, status.exit_reason), (None, None));
        assert_eq!(
            status.stderr_tail,
            ["[cadencr] the previous run ended: its permissions changed"]
        );
    }
}

use std::collections::HashMap;
use std::time::Duration;

use tokio::io::{AsyncReadExt, BufReader};
use tokio::process::Command;

use super::models::TriggeredBy;
use super::repository;
use super::service;
use crate::app_state::AppState;
use crate::error::AppError;

/// Hard upper bound per run. SIGKILLs the child if it overruns.
pub const RUN_TIMEOUT: Duration = Duration::from_secs(5 * 60);

/// Outcome of a single command run, persisted in `custom_action_runs`.
pub struct RunOutcome {
    pub run_id: i64,
    pub exit_code: Option<i64>,
    pub stdout: String,
    pub stderr: String,
    pub ended_at: String,
}

/// Execute `action_id` for `feature_id`, blocking until completion (or timeout).
///
/// - Resolves CWD via `git::service::resolve_feature_git_path` so the command
///   runs in the feature's worktree (or project root fallback) — same path as
///   the legacy Open in Zed/Terminal buttons.
/// - Substitutes `${VAR}` placeholders from `custom_action_variables` for the
///   `(action_id, feature_id)` pair.
/// - Persists exit code + captured streams in `custom_action_runs`.
pub async fn execute(
    state: &AppState,
    action_id: i64,
    feature_id: i64,
    triggered_by: TriggeredBy,
) -> Result<RunOutcome, AppError> {
    let action = repository::get(&state.read_pool, action_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("Custom action {action_id} not found")))?;

    let cwd = crate::domain::git::service::resolve_feature_git_path(state, feature_id)
        .await?
        .ok_or_else(|| {
            AppError::BadRequest(
                "Feature has no working directory yet — set up a worktree or open a project."
                    .into(),
            )
        })?;

    let vars = repository::list_variables(&state.read_pool, action_id, feature_id).await?;
    let values: HashMap<String, String> = vars.into_iter().map(|v| (v.var_name, v.value)).collect();
    let interpolated = service::interpolate(&action.command, &values)?;

    let run_id =
        repository::insert_run(&state.write_pool, action_id, feature_id, triggered_by).await?;

    let raw = run_shell(&interpolated, &cwd).await;
    let ended_at = repository::finalize_run(
        &state.write_pool,
        run_id,
        raw.exit_code,
        &raw.stdout,
        &raw.stderr,
    )
    .await?;

    Ok(RunOutcome {
        run_id,
        exit_code: raw.exit_code,
        stdout: raw.stdout,
        stderr: raw.stderr,
        ended_at,
    })
}

struct RawRunOutcome {
    exit_code: Option<i64>,
    stdout: String,
    stderr: String,
}

/// Spawn `$SHELL -c <command>` in `cwd`, drain stdout/stderr concurrently to
/// avoid pipe-buffer deadlocks, and enforce [`RUN_TIMEOUT`] with SIGKILL.
async fn run_shell(command: &str, cwd: &str) -> RawRunOutcome {
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_string());
    let mut child = match Command::new(&shell)
        .args(["-c", command])
        .current_dir(cwd)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
    {
        Ok(c) => c,
        Err(e) => {
            return RawRunOutcome {
                exit_code: Some(-1),
                stdout: String::new(),
                stderr: format!("Failed to spawn `{shell} -c <command>`: {e}"),
            };
        }
    };

    let stdout_handle = child.stdout.take().map(|s| {
        tokio::spawn(async move {
            let mut buf = String::new();
            let _ = BufReader::new(s).read_to_string(&mut buf).await;
            buf
        })
    });
    let stderr_handle = child.stderr.take().map(|s| {
        tokio::spawn(async move {
            let mut buf = String::new();
            let _ = BufReader::new(s).read_to_string(&mut buf).await;
            buf
        })
    });

    let (timed_out, exit_code) = match tokio::time::timeout(RUN_TIMEOUT, child.wait()).await {
        Ok(Ok(status)) => (false, status.code().map(i64::from)),
        Ok(Err(_)) => (false, Some(-1)),
        Err(_) => {
            let _ = child.kill().await;
            (true, Some(-1))
        }
    };

    let stdout = match stdout_handle {
        Some(h) => h.await.unwrap_or_default(),
        None => String::new(),
    };
    let mut stderr = match stderr_handle {
        Some(h) => h.await.unwrap_or_default(),
        None => String::new(),
    };
    if timed_out {
        stderr.push_str(&format!(
            "\n[cadencr] Command timed out after {} seconds and was killed.",
            RUN_TIMEOUT.as_secs()
        ));
    }

    RawRunOutcome {
        exit_code,
        stdout,
        stderr,
    }
}

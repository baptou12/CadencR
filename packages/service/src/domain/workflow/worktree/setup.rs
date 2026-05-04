//! Run the project's `setup_worktree` commands inside a freshly-created
//! worktree, streaming each line to the WS so the user sees progress live.

use std::path::PathBuf;
use std::sync::Arc;

use sqlx::SqlitePool;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

use crate::domain::workflow::engine::WsSender;

use super::db::set_setting;
use super::envelope::send_envelope;

/// Persist setup error state and notify the frontend via WebSocket.
async fn report_setup_error(
    write_pool: &SqlitePool,
    feature_id: i64,
    log_lines: &tokio::sync::Mutex<Vec<String>>,
    ws_sender: &WsSender,
    error: &str,
) {
    let _ = set_setting(write_pool, feature_id, "worktree_setup_step", "setup_error").await;
    let _ = set_setting(write_pool, feature_id, "worktree_setup_error", error).await;
    let log = log_lines.lock().await.join("\n");
    let _ = set_setting(write_pool, feature_id, "worktree_setup_log", &log).await;
    send_envelope(
        ws_sender,
        "workflow",
        "worktree.setup_error",
        serde_json::json!({
            "feature_id": feature_id,
            "error": error,
            "output": log,
        }),
    );
}

/// Run setup commands in the worktree (fire-and-forget via tokio::spawn).
pub async fn run_setup_commands(
    read_pool: SqlitePool,
    write_pool: SqlitePool,
    feature_id: i64,
    worktree_path: PathBuf,
    ws_sender: WsSender,
) {
    // 1. Query setup commands
    let commands_str = match sqlx::query_as::<_, (String,)>(
        "SELECT value FROM project_settings WHERE project_id = \
         (SELECT project_id FROM features WHERE id = ?) AND key = 'setup_worktree'",
    )
    .bind(feature_id)
    .fetch_optional(&read_pool)
    .await
    {
        Ok(Some(row)) if !row.0.trim().is_empty() => row.0,
        Ok(_) => {
            // No setup commands
            let _ = set_setting(&write_pool, feature_id, "worktree_setup_step", "ready").await;
            let _ = set_setting(&write_pool, feature_id, "worktree_setup_error", "").await;
            let _ = set_setting(&write_pool, feature_id, "worktree_setup_log", "").await;
            send_envelope(
                &ws_sender,
                "workflow",
                "worktree.ready",
                serde_json::json!({
                    "feature_id": feature_id,
                }),
            );
            return;
        }
        Err(e) => {
            let error = format!("Failed to query setup commands: {e}");
            let _ = set_setting(
                &write_pool,
                feature_id,
                "worktree_setup_step",
                "setup_error",
            )
            .await;
            let _ = set_setting(&write_pool, feature_id, "worktree_setup_error", &error).await;
            send_envelope(
                &ws_sender,
                "workflow",
                "worktree.setup_error",
                serde_json::json!({
                    "feature_id": feature_id,
                    "error": error,
                }),
            );
            return;
        }
    };

    let _ = set_setting(
        &write_pool,
        feature_id,
        "worktree_setup_step",
        "setup_running",
    )
    .await;
    let _ = set_setting(&write_pool, feature_id, "worktree_setup_error", "").await;
    let _ = set_setting(&write_pool, feature_id, "worktree_setup_log", "").await;

    // 2. Send setup_running
    send_envelope(
        &ws_sender,
        "workflow",
        "worktree.setup_running",
        serde_json::json!({
            "feature_id": feature_id,
        }),
    );

    // 4. Parse and run each command, accumulating output log
    let commands: Vec<&str> = commands_str
        .lines()
        .filter(|l| !l.trim().is_empty())
        .collect();
    let log_lines = Arc::new(tokio::sync::Mutex::new(Vec::<String>::new()));
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "sh".to_string());
    for cmd in commands {
        if !run_one_command(
            &write_pool,
            feature_id,
            &worktree_path,
            &ws_sender,
            &shell,
            cmd,
            &log_lines,
        )
        .await
        {
            return;
        }
    }

    // 6. Success — persist log and mark ready
    let log = log_lines.lock().await.join("\n");
    let _ = set_setting(&write_pool, feature_id, "worktree_setup_log", &log).await;
    let _ = set_setting(&write_pool, feature_id, "worktree_setup_step", "ready").await;
    let _ = set_setting(&write_pool, feature_id, "worktree_setup_error", "").await;
    send_envelope(
        &ws_sender,
        "workflow",
        "worktree.ready",
        serde_json::json!({
            "feature_id": feature_id,
        }),
    );
}

/// Spawn `cmd` via the user's shell inside `worktree_path`, streaming each
/// stdout/stderr line to the WS *and* into `log_lines` for the final log
/// payload. Returns `true` on success and `false` after reporting the
/// failure (caller should bail out so it doesn't keep running follow-ups).
async fn run_one_command(
    write_pool: &SqlitePool,
    feature_id: i64,
    worktree_path: &std::path::Path,
    ws_sender: &WsSender,
    shell: &str,
    cmd: &str,
    log_lines: &Arc<tokio::sync::Mutex<Vec<String>>>,
) -> bool {
    // Log the command being run
    let cmd_line = format!("$ {cmd}");
    log_lines.lock().await.push(cmd_line.clone());
    send_envelope(
        ws_sender,
        "workflow",
        "worktree.setup_output",
        serde_json::json!({
            "feature_id": feature_id,
            "line": cmd_line,
        }),
    );

    let mut child = match Command::new(shell)
        .args(["-i", "-c", cmd])
        .current_dir(worktree_path)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
    {
        Ok(c) => c,
        Err(e) => {
            let error = format!("Failed to spawn command `{cmd}`: {e}");
            report_setup_error(write_pool, feature_id, log_lines, ws_sender, &error).await;
            return false;
        }
    };

    let stdout_handle = spawn_stream_reader(child.stdout.take(), feature_id, ws_sender, log_lines);
    let stderr_handle = spawn_stream_reader(child.stderr.take(), feature_id, ws_sender, log_lines);

    if let Some(h) = stdout_handle {
        let _ = h.await;
    }
    if let Some(h) = stderr_handle {
        let _ = h.await;
    }

    match child.wait().await {
        Ok(status) if status.success() => {
            log_lines.lock().await.push(String::new());
            true
        }
        Ok(status) => {
            let error = format!("Command `{cmd}` exited with status {status}");
            report_setup_error(write_pool, feature_id, log_lines, ws_sender, &error).await;
            false
        }
        Err(e) => {
            let error = format!("Failed to wait on command `{cmd}`: {e}");
            report_setup_error(write_pool, feature_id, log_lines, ws_sender, &error).await;
            false
        }
    }
}

/// Spawn a tokio task that drains a child's stdout/stderr line-by-line,
/// pushes each line into `log_lines` and broadcasts a `worktree.setup_output`
/// envelope. Returns `None` when the child didn't expose the requested
/// stream (caller skips the `await` in that case).
fn spawn_stream_reader<R>(
    stream: Option<R>,
    feature_id: i64,
    ws_sender: &WsSender,
    log_lines: &Arc<tokio::sync::Mutex<Vec<String>>>,
) -> Option<tokio::task::JoinHandle<()>>
where
    R: tokio::io::AsyncRead + Send + Unpin + 'static,
{
    let stream = stream?;
    let ws = ws_sender.clone();
    let log = Arc::clone(log_lines);
    Some(tokio::spawn(async move {
        let reader = BufReader::new(stream);
        let mut lines = reader.lines();
        while let Ok(Some(line)) = lines.next_line().await {
            log.lock().await.push(line.clone());
            send_envelope(
                &ws,
                "workflow",
                "worktree.setup_output",
                serde_json::json!({
                    "feature_id": feature_id,
                    "line": line,
                }),
            );
        }
    }))
}

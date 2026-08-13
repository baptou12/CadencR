//! Run the project's `setup_worktree` commands inside a freshly-created
//! worktree, streaming each line to the WS so the user sees progress live.

use std::path::PathBuf;
use std::sync::Arc;

use sqlx::SqlitePool;

use crate::domain::workflow::ws_sender::WsSender;
use crate::shared::setup_log::setup_log_for_transport;

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
    let display_log = setup_log_for_transport(log);
    send_envelope(
        ws_sender,
        "workflow",
        "worktree.setup_error",
        serde_json::json!({
            "feature_id": feature_id,
            "error": error,
            "output": display_log,
        }),
    );
}

/// Resolve the project's `setup_worktree` commands for a feature.
///
/// `setup_worktree` is a project setting and now lives in the JSON settings store
/// (the legacy `project_settings` row is kept only as a backup). Returns `None`
/// when no non-empty setup script is configured.
async fn resolve_setup_commands(
    read_pool: &SqlitePool,
    feature_id: i64,
) -> Result<Option<String>, String> {
    let project_id = sqlx::query_as::<_, (i64,)>("SELECT project_id FROM features WHERE id = ?")
        .bind(feature_id)
        .fetch_optional(read_pool)
        .await
        .map_err(|e| format!("Failed to look up project for feature: {e}"))?
        .map(|r| r.0)
        .ok_or_else(|| format!("Feature {feature_id} not found"))?;

    let value = crate::domain::settings_store::project_get(read_pool, project_id, "setup_worktree")
        .await
        .map_err(|e| format!("Failed to query setup commands: {e}"))?
        .filter(|v| !v.trim().is_empty());
    Ok(value)
}

/// Run setup commands in the worktree (fire-and-forget via tokio::spawn).
pub async fn run_setup_commands(
    read_pool: SqlitePool,
    write_pool: SqlitePool,
    feature_id: i64,
    worktree_path: PathBuf,
    ws_sender: WsSender,
) {
    // 1. Resolve setup commands from the project's JSON settings.
    let commands_str = match resolve_setup_commands(&read_pool, feature_id).await {
        Ok(Some(commands)) => commands,
        Ok(None) => {
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
        Err(error) => {
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

    run_resolved_setup_commands(
        &write_pool,
        feature_id,
        worktree_path,
        &ws_sender,
        &commands_str,
    )
    .await;
}

async fn run_resolved_setup_commands(
    write_pool: &SqlitePool,
    feature_id: i64,
    worktree_path: PathBuf,
    ws_sender: &WsSender,
    commands_str: &str,
) {
    let commands = commands_str
        .lines()
        .filter(|l| !l.trim().is_empty())
        .collect::<Vec<_>>();
    let log_lines = Arc::new(tokio::sync::Mutex::new(Vec::<String>::new()));

    let script = build_setup_script(&commands);
    let (output_tx, mut output_rx) = crate::shared::terminal_shell::terminal_output_channel();
    let output_log = Arc::clone(&log_lines);
    let output_ws = ws_sender.clone();
    let output_task = tokio::spawn(async move {
        while let Some(line) = output_rx.recv().await {
            emit_setup_line(feature_id, &output_ws, &output_log, line).await;
        }
    });

    let result = crate::shared::terminal_shell::run_terminal_shell_script(
        &script,
        &worktree_path,
        output_tx,
    )
    .await;
    let _ = output_task.await;
    match result {
        Ok(exit) if exit.success() => {}
        Ok(exit) => {
            let error = format!(
                "Setup script exited with status {} (cwd: {}, PATH: {})",
                exit.exit_code,
                worktree_path.display(),
                std::env::var("PATH").unwrap_or_else(|_| "<unset>".to_string())
            );
            report_setup_error(write_pool, feature_id, &log_lines, ws_sender, &error).await;
            return;
        }
        Err(error) => {
            report_setup_error(write_pool, feature_id, &log_lines, ws_sender, &error).await;
            return;
        }
    }

    // 6. Success — persist log and mark ready
    let log = log_lines.lock().await.join("\n");
    let _ = set_setting(write_pool, feature_id, "worktree_setup_log", &log).await;
    let _ = set_setting(write_pool, feature_id, "worktree_setup_step", "ready").await;
    let _ = set_setting(write_pool, feature_id, "worktree_setup_error", "").await;
    send_envelope(
        ws_sender,
        "workflow",
        "worktree.ready",
        serde_json::json!({
            "feature_id": feature_id,
        }),
    );
}

fn build_setup_script(commands: &[&str]) -> String {
    let mut script = String::from("set -e\n");
    for command in commands {
        script.push_str("printf '%s\\n' ");
        script.push_str(&cli_discovery::shell_quote(std::ffi::OsStr::new(&format!(
            "$ {command}"
        ))));
        script.push('\n');
        script.push_str(command);
        script.push('\n');
    }
    script
}

async fn emit_setup_line(
    feature_id: i64,
    ws_sender: &WsSender,
    log_lines: &Arc<tokio::sync::Mutex<Vec<String>>>,
    line: String,
) {
    log_lines.lock().await.push(line.clone());
    send_envelope(
        ws_sender,
        "workflow",
        "worktree.setup_output",
        serde_json::json!({
            "feature_id": feature_id,
            "line": line,
        }),
    );
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::shared::test_env::EnvVarGuard;
    use sqlx::sqlite::SqlitePoolOptions;
    use std::os::unix::fs::PermissionsExt;

    #[test]
    fn build_setup_script_prints_commands_with_shell_quoting() {
        let script = build_setup_script(&["echo it's ok"]);

        assert!(script.contains("printf '%s\\n' '$ echo it'\\''s ok'"));
        assert!(script.contains("\necho it's ok\n"));
    }

    async fn setup_pool(command: &str) -> SqlitePool {
        let pool = SqlitePoolOptions::new()
            .connect(":memory:")
            .await
            .expect("pool");
        sqlx::query("CREATE TABLE features (id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL)")
            .execute(&pool)
            .await
            .expect("features table");
        // `projects` is needed so the settings store can resolve the project's
        // JSON file path. A unique name keeps this test's file from colliding
        // with other tests sharing the process-wide settings dir fallback.
        sqlx::query("CREATE TABLE projects (id INTEGER PRIMARY KEY, name TEXT NOT NULL, path TEXT NOT NULL DEFAULT '')")
            .execute(&pool)
            .await
            .expect("projects table");
        sqlx::query(
            "CREATE TABLE feature_settings (feature_id INTEGER, key TEXT, value TEXT, PRIMARY KEY(feature_id, key))",
        )
        .execute(&pool)
        .await
        .expect("feature_settings table");
        sqlx::query("INSERT INTO projects (id, name) VALUES (7, 'worktree-setup-test-project')")
            .execute(&pool)
            .await
            .expect("project row");
        sqlx::query("INSERT INTO features (id, project_id) VALUES (1, 7)")
            .execute(&pool)
            .await
            .expect("feature row");
        // Seed the setup script through the JSON settings store (the same path
        // production reads from), not the legacy `project_settings` table.
        crate::domain::settings_store::project_set(&pool, 7, "setup_worktree", command)
            .await
            .expect("setup setting");
        pool
    }

    #[tokio::test]
    async fn run_setup_commands_uses_terminal_like_shell_setup() {
        let _guard = crate::shared::test_env::async_env_lock().lock().await;
        let temp = tempfile::tempdir().expect("tempdir");
        let shell = temp.path().join("fake-shell.sh");
        std::fs::write(
            &shell,
            r#"#!/bin/sh
interactive=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    -l) shift ;;
    -i) interactive=1; shift ;;
    -c) shift; script="$1"; shift; break ;;
    *) break ;;
  esac
done

if [ "$interactive" = "1" ] && [ -t 0 ]; then
  init='nvm() { echo "nvm initialized"; PATH="$(pwd)/bin:$PATH"; export PATH; };'
  exec /bin/sh -c "$init $script"
fi

exec /bin/sh -c "$script"
"#,
        )
        .expect("write fake shell");
        let mut perms = std::fs::metadata(&shell).expect("metadata").permissions();
        perms.set_mode(0o755);
        std::fs::set_permissions(&shell, perms).expect("chmod");

        let _shell_guard = EnvVarGuard::set("SHELL", shell.to_string_lossy().as_ref());
        let worktree = temp.path().join("worktree");
        std::fs::create_dir(&worktree).expect("worktree dir");
        let bin = worktree.join("bin");
        std::fs::create_dir(&bin).expect("bin dir");
        let pnpm = bin.join("pnpm");
        std::fs::write(&pnpm, "#!/bin/sh\nprintf 'pnpm ok' > setup.out\n")
            .expect("write fake pnpm");
        let mut pnpm_perms = std::fs::metadata(&pnpm)
            .expect("pnpm metadata")
            .permissions();
        pnpm_perms.set_mode(0o755);
        std::fs::set_permissions(&pnpm, pnpm_perms).expect("chmod pnpm");

        let pool = setup_pool("nvm use\npnpm install").await;
        let (tx, _rx) = tokio::sync::mpsc::unbounded_channel();

        run_setup_commands(pool.clone(), pool.clone(), 1, worktree.clone(), tx).await;

        let step = super::super::db::get_setting(&pool, 1, "worktree_setup_step").await;
        assert_eq!(step.as_deref(), Some("ready"));
        assert_eq!(
            std::fs::read_to_string(worktree.join("setup.out")).expect("setup output"),
            "pnpm ok"
        );
    }
}

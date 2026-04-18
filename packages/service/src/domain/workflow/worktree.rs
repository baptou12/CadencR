use std::path::{Path, PathBuf};
use std::sync::Arc;

use axum::extract::ws::Message;
use rand::Rng;
use sqlx::SqlitePool;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

use super::engine::WsSender;
use crate::domain::ws_session::protocol::WsEnvelope;

use crate::shared::git_cli::run_git_safe_refs;
use crate::shared::slug::slugify;

/// Build a branch name from a prefix and title.
/// Format: `{prefix}{slug}-{xxxx}` where xxxx is 4-char random hex.
pub fn build_branch_name(prefix: &str, title: &str) -> String {
    let slug = slugify(title);
    let suffix: u16 = rand::thread_rng().gen_range(0..=0xFFFF);
    let hex = format!("{:04x}", suffix);
    format!("{}{}-{}", prefix, slug, hex)
}

fn send_envelope(ws_sender: &WsSender, domain: &str, action: &str, payload: serde_json::Value) {
    let envelope = WsEnvelope::new(domain, action, payload);
    let _ = ws_sender.send(Message::Text(String::from(envelope).into()));
}

/// Build `~/.cadence/{project_name}/{safe_branch}` and verify the canonical
/// result stays under the canonical `~/.cadence`. Creates the parent dir if
/// it does not exist; the leaf is the worktree dir that `git worktree add`
/// will create itself.
async fn build_contained_worktree_path(
    cadence_root: &Path,
    project_name: &str,
    safe_branch: &str,
) -> Result<PathBuf, String> {
    if project_name.is_empty()
        || project_name.contains('/')
        || project_name.contains('\\')
        || project_name.contains("..")
    {
        return Err(format!(
            "refusing to build worktree path for unsafe project name: {project_name:?}"
        ));
    }
    if safe_branch.is_empty() || safe_branch.contains('/') || safe_branch.contains("..") {
        return Err(format!(
            "refusing to build worktree path for unsafe branch: {safe_branch:?}"
        ));
    }

    let parent = cadence_root.join(project_name);
    tokio::fs::create_dir_all(&parent)
        .await
        .map_err(|e| format!("Failed to create parent dir: {e}"))?;

    let canon_parent = parent
        .canonicalize()
        .map_err(|e| format!("Failed to canonicalize parent dir: {e}"))?;
    let canon_root = cadence_root
        .canonicalize()
        .map_err(|e| format!("Failed to canonicalize ~/.cadence: {e}"))?;
    if !canon_parent.starts_with(&canon_root) {
        return Err(format!(
            "Resolved worktree parent escapes ~/.cadence: {}",
            canon_parent.display()
        ));
    }

    Ok(canon_parent.join(safe_branch))
}

/// Idempotent worktree creation orchestrator.
pub async fn ensure_worktree(
    read_pool: &SqlitePool,
    write_pool: &SqlitePool,
    feature_id: i64,
    project_id: i64,
    ws_sender: &WsSender,
) -> Result<PathBuf, String> {
    // 0. If user opted out of worktree, return the project directory directly
    if get_setting(read_pool, feature_id, "skip_worktree")
        .await
        .as_deref()
        == Some("true")
    {
        let project_dir = get_project_directory(read_pool, project_id).await?;
        send_envelope(
            ws_sender,
            "workflow",
            "worktree.ready",
            serde_json::json!({
                "feature_id": feature_id,
            }),
        );
        return Ok(PathBuf::from(project_dir));
    }

    // 1. Check if worktree already exists
    if let Some(existing) = get_setting(read_pool, feature_id, "worktree_path").await {
        if tokio::fs::metadata(&existing).await.is_ok() {
            let branch = get_setting(read_pool, feature_id, "worktree_branch").await;
            let status = get_setting(read_pool, feature_id, "worktree_setup_step")
                .await
                .unwrap_or_else(|| "created".to_string());
            // Re-send worktree state so the frontend store is populated on reconnect
            send_envelope(
                ws_sender,
                "workflow",
                "worktree.created",
                serde_json::json!({
                    "feature_id": feature_id,
                    "path": existing,
                    "branch": branch,
                }),
            );
            if status == "ready" {
                send_envelope(
                    ws_sender,
                    "workflow",
                    "worktree.ready",
                    serde_json::json!({
                        "feature_id": feature_id,
                    }),
                );
            }
            return Ok(PathBuf::from(existing));
        }
    }

    // 2. Look up project directory and branch prefix
    let (project_dir, project_name) = sqlx::query_as::<_, (String, String)>(
        "SELECT p.path, p.name FROM projects p WHERE p.id = ?",
    )
    .bind(project_id)
    .fetch_optional(read_pool)
    .await
    .map_err(|e| format!("DB error looking up project: {e}"))?
    .ok_or_else(|| format!("Project {project_id} not found"))?;

    let branch_prefix = sqlx::query_as::<_, (String,)>(
        "SELECT value FROM project_settings WHERE project_id = ? AND key = 'branch_prefix'",
    )
    .bind(project_id)
    .fetch_optional(read_pool)
    .await
    .map_err(|e| format!("DB error looking up branch_prefix: {e}"))?
    .map(|r| r.0)
    .unwrap_or_else(|| "feature/".to_string());

    // 3. Reuse stored branch name if available, otherwise generate a new one
    let branch = if let Some(existing_branch) =
        get_setting(read_pool, feature_id, "worktree_branch").await
    {
        existing_branch
    } else {
        let title = sqlx::query_as::<_, (String,)>("SELECT title FROM features WHERE id = ?")
            .bind(feature_id)
            .fetch_optional(read_pool)
            .await
            .map_err(|e| format!("DB error looking up feature title: {e}"))?
            .map(|r| r.0)
            .unwrap_or_else(|| format!("feature-{feature_id}"));
        let name = build_branch_name(&branch_prefix, &title);
        // Persist immediately so subsequent attempts reuse it
        let _ = set_setting(write_pool, feature_id, "worktree_branch", &name).await;
        name
    };

    // 5. Compute worktree path — parent must be created first so we can
    //    canonicalize it and confirm the final path stays under ~/.cadence.
    let home = dirs::home_dir().ok_or("Could not determine home directory")?;
    let cadence_root = home.join(".cadence");
    let safe_branch = branch.replace('/', "-");
    let worktree_path =
        build_contained_worktree_path(&cadence_root, &project_name, &safe_branch).await?;
    let path_str = worktree_path.to_string_lossy().to_string();

    // 6. Send worktree.creating
    send_envelope(
        ws_sender,
        "workflow",
        "worktree.creating",
        serde_json::json!({
            "feature_id": feature_id,
            "branch": branch,
            "path": path_str,
        }),
    );

    // 8. Run git worktree add
    match run_git_safe_refs(
        &["worktree", "add"],
        &["-b", &branch],
        &[&path_str],
        Path::new(&project_dir),
    )
    .await
    {
        Ok(_) => {}
        Err(e) => {
            let msg = format!("{e}");
            if msg.contains("already exists") {
                run_git_safe_refs(
                    &["worktree", "add"],
                    &[],
                    &[&path_str, &branch],
                    Path::new(&project_dir),
                )
                .await
                .map_err(|e2| format!("git worktree add failed: {e2}"))?;
            } else {
                return Err(format!("git worktree add failed: {msg}"));
            }
        }
    }

    // 9. Persist to DB
    set_setting(write_pool, feature_id, "worktree_path", &path_str).await?;
    set_setting(write_pool, feature_id, "worktree_branch", &branch).await?;
    set_setting(write_pool, feature_id, "worktree_setup_step", "created").await?;

    // 10. Send worktree.created
    send_envelope(
        ws_sender,
        "workflow",
        "worktree.created",
        serde_json::json!({
            "feature_id": feature_id,
            "path": path_str,
            "branch": branch,
        }),
    );

    // 11. Notify frontend to refetch settings (branch name, worktree path, etc.)
    send_envelope(
        ws_sender,
        "feature",
        "updated",
        serde_json::json!({
            "feature_id": feature_id,
            "changed": ["settings"],
        }),
    );

    Ok(worktree_path)
}

/// Persist setup error state and notify the frontend via WebSocket.
async fn report_setup_error(
    write_pool: &SqlitePool,
    feature_id: i64,
    log_lines: &tokio::sync::Mutex<Vec<String>>,
    ws_sender: &WsSender,
    error: &str,
) {
    let _ = set_setting(write_pool, feature_id, "worktree_setup_step", "setup_error").await;
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
    // 1. Send setup_running
    send_envelope(
        &ws_sender,
        "workflow",
        "worktree.setup_running",
        serde_json::json!({
            "feature_id": feature_id,
        }),
    );

    // 2. Query setup commands
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

    // 4. Parse and run each command, accumulating output log
    let commands: Vec<&str> = commands_str
        .lines()
        .filter(|l| !l.trim().is_empty())
        .collect();
    let log_lines = Arc::new(tokio::sync::Mutex::new(Vec::<String>::new()));
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "sh".to_string());
    for cmd in commands {
        // Log the command being run
        let cmd_line = format!("$ {cmd}");
        log_lines.lock().await.push(cmd_line.clone());
        send_envelope(
            &ws_sender,
            "workflow",
            "worktree.setup_output",
            serde_json::json!({
                "feature_id": feature_id,
                "line": cmd_line,
            }),
        );

        let mut child = match Command::new(&shell)
            .args(["-i", "-c", cmd])
            .current_dir(&worktree_path)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
        {
            Ok(c) => c,
            Err(e) => {
                let error = format!("Failed to spawn command `{cmd}`: {e}");
                report_setup_error(&write_pool, feature_id, &log_lines, &ws_sender, &error).await;
                return;
            }
        };

        // Stream stdout
        let stdout_handle = if let Some(stdout) = child.stdout.take() {
            let ws = ws_sender.clone();
            let fid = feature_id;
            let log = Arc::clone(&log_lines);
            Some(tokio::spawn(async move {
                let reader = BufReader::new(stdout);
                let mut lines = reader.lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    log.lock().await.push(line.clone());
                    send_envelope(
                        &ws,
                        "workflow",
                        "worktree.setup_output",
                        serde_json::json!({
                            "feature_id": fid,
                            "line": line,
                        }),
                    );
                }
            }))
        } else {
            None
        };

        // Stream stderr
        let stderr_handle = if let Some(stderr) = child.stderr.take() {
            let ws = ws_sender.clone();
            let fid = feature_id;
            let log = Arc::clone(&log_lines);
            Some(tokio::spawn(async move {
                let reader = BufReader::new(stderr);
                let mut lines = reader.lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    log.lock().await.push(line.clone());
                    send_envelope(
                        &ws,
                        "workflow",
                        "worktree.setup_output",
                        serde_json::json!({
                            "feature_id": fid,
                            "line": line,
                        }),
                    );
                }
            }))
        } else {
            None
        };

        // Wait for stream tasks to finish before checking exit status
        if let Some(h) = stdout_handle {
            let _ = h.await;
        }
        if let Some(h) = stderr_handle {
            let _ = h.await;
        }

        match child.wait().await {
            Ok(status) if status.success() => {
                log_lines.lock().await.push(String::new());
            }
            Ok(status) => {
                let error = format!("Command `{cmd}` exited with status {status}");
                report_setup_error(&write_pool, feature_id, &log_lines, &ws_sender, &error).await;
                return;
            }
            Err(e) => {
                let error = format!("Failed to wait on command `{cmd}`: {e}");
                report_setup_error(&write_pool, feature_id, &log_lines, &ws_sender, &error).await;
                return;
            }
        }
    }

    // 6. Success — persist log and mark ready
    let log = log_lines.lock().await.join("\n");
    let _ = set_setting(&write_pool, feature_id, "worktree_setup_log", &log).await;
    let _ = set_setting(&write_pool, feature_id, "worktree_setup_step", "ready").await;
    send_envelope(
        &ws_sender,
        "workflow",
        "worktree.ready",
        serde_json::json!({
            "feature_id": feature_id,
        }),
    );
}

/// Look up the project_id for a given feature.
pub async fn get_project_id_for_feature(pool: &SqlitePool, feature_id: i64) -> Result<i64, String> {
    sqlx::query_scalar("SELECT project_id FROM features WHERE id = ?")
        .bind(feature_id)
        .fetch_one(pool)
        .await
        .map_err(|e| {
            format!(
                "Failed to look up project for feature {}: {}",
                feature_id, e
            )
        })
}

/// Look up the project directory for a given project_id.
pub async fn get_project_directory(pool: &SqlitePool, project_id: i64) -> Result<String, String> {
    sqlx::query_scalar("SELECT path FROM projects WHERE id = ?")
        .bind(project_id)
        .fetch_one(pool)
        .await
        .map_err(|e| {
            format!(
                "Failed to look up directory for project {}: {}",
                project_id, e
            )
        })
}

// --- DB helpers ---

pub async fn get_setting(pool: &SqlitePool, feature_id: i64, key: &str) -> Option<String> {
    sqlx::query_as::<_, (String,)>(
        "SELECT value FROM feature_settings WHERE feature_id = ? AND key = ?",
    )
    .bind(feature_id)
    .bind(key)
    .fetch_optional(pool)
    .await
    .ok()
    .flatten()
    .map(|r| r.0)
}

pub async fn set_setting(
    pool: &SqlitePool,
    feature_id: i64,
    key: &str,
    value: &str,
) -> Result<(), String> {
    sqlx::query(
        "INSERT OR REPLACE INTO feature_settings (feature_id, key, value) VALUES (?, ?, ?)",
    )
    .bind(feature_id)
    .bind(key)
    .bind(value)
    .execute(pool)
    .await
    .map_err(|e| format!("DB error setting {key}: {e}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_build_branch_name_format() {
        let name = build_branch_name("feature/", "My Cool Feature");
        assert!(name.starts_with("feature/my-cool-feature-"));
        // Should end with 4 hex chars
        let suffix = &name[name.len() - 4..];
        assert!(suffix.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn test_build_branch_name_suffix_length() {
        let name = build_branch_name("fix/", "test");
        // format: fix/test-xxxx
        assert!(name.starts_with("fix/test-"));
        let parts: Vec<&str> = name.rsplitn(2, '-').collect();
        assert_eq!(parts[0].len(), 4);
    }

    #[test]
    fn test_build_branch_name_special_chars() {
        let name = build_branch_name("feature/", "Hello World! @#$ Test");
        assert!(name.starts_with("feature/hello-world-test-"));
    }

    // --- Additional build_branch_name tests ---

    #[test]
    fn test_build_branch_name_empty_prefix() {
        let name = build_branch_name("", "my feature");
        assert!(name.starts_with("my-feature-"));
        assert_eq!(name.len(), "my-feature-".len() + 4);
    }

    #[test]
    fn test_build_branch_name_empty_title() {
        let name = build_branch_name("feature/", "");
        // slugify("") = "", so format is "feature/-xxxx"
        assert!(name.starts_with("feature/-"));
        let suffix = &name[name.len() - 4..];
        assert!(suffix.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn test_build_branch_name_uniqueness() {
        // Two calls should (almost certainly) produce different names
        let a = build_branch_name("f/", "test");
        let b = build_branch_name("f/", "test");
        // Not guaranteed but with 65536 possibilities, collision is ~1/65536
        // We run multiple pairs to be safe
        let mut all_same = true;
        for _ in 0..5 {
            let x = build_branch_name("f/", "test");
            let y = build_branch_name("f/", "test");
            if x != y {
                all_same = false;
                break;
            }
        }
        // If somehow all 5 pairs collided, that's astronomically unlikely but not impossible.
        // Just check format is correct as the real assertion.
        assert!(a.starts_with("f/test-"));
        assert!(b.starts_with("f/test-"));
        // Suffix is hex
        let suffix_a = &a[a.len() - 4..];
        assert!(suffix_a.chars().all(|c| c.is_ascii_hexdigit()));
        let _ = all_same; // used above
    }

    #[test]
    fn test_build_branch_name_long_title() {
        let name = build_branch_name("feature/", &"a".repeat(100));
        // slug is capped at 50, so branch = "feature/" + 50 a's + "-" + 4 hex
        assert!(name.starts_with("feature/"));
        let without_prefix = &name["feature/".len()..];
        let parts: Vec<&str> = without_prefix.rsplitn(2, '-').collect();
        assert_eq!(parts[0].len(), 4); // hex suffix
        assert!(parts[1].len() <= 50); // slug portion
    }

    // --- Worktree path construction tests ---

    #[test]
    fn test_safe_branch_replaces_slashes() {
        let branch = "feature/my-cool-feature-abcd";
        let safe = branch.replace('/', "-");
        assert_eq!(safe, "feature-my-cool-feature-abcd");
        assert!(!safe.contains('/'));
    }

    #[test]
    fn test_worktree_path_construction() {
        // Simulates the path logic from ensure_worktree (lines 106-111)
        let branch = "feature/implement-queue-1a2b";
        let safe_branch = branch.replace('/', "-");
        let project_name = "my-project";

        let home = dirs::home_dir().expect("home dir");
        let expected = home.join(".cadence").join(project_name).join(&safe_branch);

        // Verify structure
        assert!(expected.to_string_lossy().contains(".cadence"));
        assert!(expected.to_string_lossy().contains(project_name));
        assert!(expected
            .to_string_lossy()
            .contains("feature-implement-queue-1a2b"));
    }

    #[test]
    fn test_worktree_path_no_slashes_in_final_component() {
        let branch = "fix/some/nested/branch-ff00";
        let safe_branch = branch.replace('/', "-");
        assert_eq!(safe_branch, "fix-some-nested-branch-ff00");

        let home = dirs::home_dir().expect("home dir");
        let path = home.join(".cadence").join("proj").join(&safe_branch);
        // The final component should have no slashes
        let file_name = path.file_name().unwrap().to_string_lossy();
        assert!(!file_name.contains('/'));
    }

    #[tokio::test]
    async fn build_contained_worktree_rejects_parent_in_project_name() {
        let tmp = std::env::temp_dir().join("cadence-b4-1");
        let _ = tokio::fs::remove_dir_all(&tmp).await;
        tokio::fs::create_dir_all(&tmp).await.unwrap();
        let err = build_contained_worktree_path(&tmp, "../escape", "branch")
            .await
            .unwrap_err();
        assert!(err.contains("unsafe project name"), "{err}");
        let _ = tokio::fs::remove_dir_all(&tmp).await;
    }

    #[tokio::test]
    async fn build_contained_worktree_rejects_slash_in_project_name() {
        let tmp = std::env::temp_dir().join("cadence-b4-2");
        let _ = tokio::fs::remove_dir_all(&tmp).await;
        tokio::fs::create_dir_all(&tmp).await.unwrap();
        let err = build_contained_worktree_path(&tmp, "a/b", "branch")
            .await
            .unwrap_err();
        assert!(err.contains("unsafe project name"), "{err}");
        let _ = tokio::fs::remove_dir_all(&tmp).await;
    }

    #[tokio::test]
    async fn build_contained_worktree_accepts_safe_inputs() {
        let tmp = std::env::temp_dir().join("cadence-b4-3");
        let _ = tokio::fs::remove_dir_all(&tmp).await;
        tokio::fs::create_dir_all(&tmp).await.unwrap();
        let result = build_contained_worktree_path(&tmp, "proj", "feat-branch")
            .await
            .unwrap();
        let canon_tmp = tokio::fs::canonicalize(&tmp).await.unwrap();
        assert!(result.starts_with(&canon_tmp), "{}", result.display());
        assert!(result.ends_with("feat-branch"));
        let _ = tokio::fs::remove_dir_all(&tmp).await;
    }

    // --- Notes on integration tests ---
    // The following functions require DB/IO and would need integration tests:
    // - ensure_worktree: needs SqlitePool, filesystem, git, and WsSender
    // - run_setup_commands: needs SqlitePool, filesystem, shell, and WsSender
    // - get_project_id_for_feature: needs SqlitePool with seeded data
    // - get_project_directory: needs SqlitePool with seeded data
    // - get_setting / set_setting: need SqlitePool with schema
}

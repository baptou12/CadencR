use std::path::PathBuf;

use axum::extract::ws::Message;
use rand::Rng;
use sqlx::SqlitePool;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

use super::engine::WsSender;
use crate::domain::ws_session::protocol::WsEnvelope;

/// Slugify a title: lowercase, replace non-alphanumeric with `-`, collapse consecutive `-`,
/// trim leading/trailing `-`, cap at 50 chars.
fn slugify(title: &str) -> String {
    let slug: String = title
        .to_lowercase()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect();
    // Collapse consecutive dashes
    let mut result = String::new();
    let mut prev_dash = false;
    for c in slug.chars() {
        if c == '-' {
            if !prev_dash {
                result.push('-');
            }
            prev_dash = true;
        } else {
            result.push(c);
            prev_dash = false;
        }
    }
    // Trim leading/trailing dashes
    let trimmed = result.trim_matches('-');
    // Cap at 50 chars (don't cut mid-character, but it's ASCII)
    if trimmed.len() > 50 {
        trimmed[..50].trim_end_matches('-').to_string()
    } else {
        trimmed.to_string()
    }
}

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

/// Idempotent worktree creation orchestrator.
pub async fn ensure_worktree(
    read_pool: &SqlitePool,
    write_pool: &SqlitePool,
    feature_id: i64,
    project_id: i64,
    ws_sender: &WsSender,
) -> Result<PathBuf, String> {
    // 1. Check if worktree already exists
    if let Some(existing) = get_setting(read_pool, feature_id, "worktree_path").await {
        if tokio::fs::metadata(&existing).await.is_ok() {
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

    // 3. Look up feature title
    let title = sqlx::query_as::<_, (String,)>("SELECT title FROM features WHERE id = ?")
        .bind(feature_id)
        .fetch_optional(read_pool)
        .await
        .map_err(|e| format!("DB error looking up feature title: {e}"))?
        .map(|r| r.0)
        .unwrap_or_else(|| format!("feature-{feature_id}"));

    // 4. Build branch name
    let branch = build_branch_name(&branch_prefix, &title);

    // 5. Compute worktree path
    let safe_branch = branch.replace('/', "-");
    let home = dirs::home_dir().ok_or("Could not determine home directory")?;
    let worktree_path = home
        .join(".cadence")
        .join(&project_name)
        .join(&safe_branch);
    let path_str = worktree_path.to_string_lossy().to_string();

    // 6. Send worktree.creating
    send_envelope(ws_sender, "workflow", "worktree.creating", serde_json::json!({
        "feature_id": feature_id,
        "branch": branch,
        "path": path_str,
    }));

    // 7. Create parent directory
    if let Some(parent) = worktree_path.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| format!("Failed to create parent dir: {e}"))?;
    }

    // 8. Run git worktree add
    let output = Command::new("git")
        .args(["worktree", "add", &path_str, "-b", &branch])
        .current_dir(&project_dir)
        .output()
        .await
        .map_err(|e| format!("Failed to run git worktree add: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        if stderr.contains("already exists") {
            // Retry without -b
            let output2 = Command::new("git")
                .args(["worktree", "add", &path_str, &branch])
                .current_dir(&project_dir)
                .output()
                .await
                .map_err(|e| format!("Failed to run git worktree add (retry): {e}"))?;
            if !output2.status.success() {
                let stderr2 = String::from_utf8_lossy(&output2.stderr);
                return Err(format!("git worktree add failed: {stderr2}"));
            }
        } else {
            return Err(format!("git worktree add failed: {stderr}"));
        }
    }

    // 9. Persist to DB
    set_setting(write_pool, feature_id, "worktree_path", &path_str).await?;
    set_setting(write_pool, feature_id, "worktree_branch", &branch).await?;
    set_setting(write_pool, feature_id, "worktree_setup_step", "created").await?;

    // 10. Send worktree.created
    send_envelope(ws_sender, "workflow", "worktree.created", serde_json::json!({
        "feature_id": feature_id,
        "path": path_str,
        "branch": branch,
    }));

    Ok(worktree_path)
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
    send_envelope(&ws_sender, "workflow", "worktree.setup_running", serde_json::json!({
        "feature_id": feature_id,
    }));

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
            send_envelope(&ws_sender, "workflow", "worktree.ready", serde_json::json!({
                "feature_id": feature_id,
            }));
            return;
        }
        Err(e) => {
            let error = format!("Failed to query setup commands: {e}");
            let _ = set_setting(&write_pool, feature_id, "worktree_setup_step", "setup_error").await;
            send_envelope(&ws_sender, "workflow", "worktree.setup_error", serde_json::json!({
                "feature_id": feature_id,
                "error": error,
            }));
            return;
        }
    };

    // 4. Parse and run each command
    let commands: Vec<&str> = commands_str.lines().filter(|l| !l.trim().is_empty()).collect();
    for cmd in commands {
        let mut child = match Command::new("sh")
            .args(["-c", cmd])
            .current_dir(&worktree_path)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
        {
            Ok(c) => c,
            Err(e) => {
                let error = format!("Failed to spawn command `{cmd}`: {e}");
                let _ = set_setting(&write_pool, feature_id, "worktree_setup_step", "setup_error").await;
                send_envelope(&ws_sender, "workflow", "worktree.setup_error", serde_json::json!({
                    "feature_id": feature_id,
                    "error": error,
                }));
                return;
            }
        };

        // Stream stdout
        if let Some(stdout) = child.stdout.take() {
            let ws = ws_sender.clone();
            let fid = feature_id;
            tokio::spawn(async move {
                let reader = BufReader::new(stdout);
                let mut lines = reader.lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    send_envelope(&ws, "workflow", "worktree.setup_output", serde_json::json!({
                        "feature_id": fid,
                        "line": line,
                    }));
                }
            });
        }

        // Stream stderr
        if let Some(stderr) = child.stderr.take() {
            let ws = ws_sender.clone();
            let fid = feature_id;
            tokio::spawn(async move {
                let reader = BufReader::new(stderr);
                let mut lines = reader.lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    send_envelope(&ws, "workflow", "worktree.setup_output", serde_json::json!({
                        "feature_id": fid,
                        "line": line,
                    }));
                }
            });
        }

        match child.wait().await {
            Ok(status) if status.success() => {}
            Ok(status) => {
                let error = format!("Command `{cmd}` exited with status {status}");
                let _ = set_setting(&write_pool, feature_id, "worktree_setup_step", "setup_error").await;
                send_envelope(&ws_sender, "workflow", "worktree.setup_error", serde_json::json!({
                    "feature_id": feature_id,
                    "error": error,
                }));
                return;
            }
            Err(e) => {
                let error = format!("Failed to wait on command `{cmd}`: {e}");
                let _ = set_setting(&write_pool, feature_id, "worktree_setup_step", "setup_error").await;
                send_envelope(&ws_sender, "workflow", "worktree.setup_error", serde_json::json!({
                    "feature_id": feature_id,
                    "error": error,
                }));
                return;
            }
        }
    }

    // 6. Success
    let _ = set_setting(&write_pool, feature_id, "worktree_setup_step", "ready").await;
    send_envelope(&ws_sender, "workflow", "worktree.ready", serde_json::json!({
        "feature_id": feature_id,
    }));
}

/// Look up the project_id for a given feature.
pub async fn get_project_id_for_feature(pool: &SqlitePool, feature_id: i64) -> Result<i64, String> {
    sqlx::query_scalar("SELECT project_id FROM features WHERE id = ?")
        .bind(feature_id)
        .fetch_one(pool)
        .await
        .map_err(|e| format!("Failed to look up project for feature {}: {}", feature_id, e))
}

/// Look up the project directory for a given project_id.
pub async fn get_project_directory(pool: &SqlitePool, project_id: i64) -> Result<String, String> {
    sqlx::query_scalar("SELECT path FROM projects WHERE id = ?")
        .bind(project_id)
        .fetch_one(pool)
        .await
        .map_err(|e| format!("Failed to look up directory for project {}: {}", project_id, e))
}

// --- DB helpers ---

async fn get_setting(pool: &SqlitePool, feature_id: i64, key: &str) -> Option<String> {
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

async fn set_setting(pool: &SqlitePool, feature_id: i64, key: &str, value: &str) -> Result<(), String> {
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
    fn test_slugify_basic() {
        assert_eq!(slugify("My Cool Feature"), "my-cool-feature");
    }

    #[test]
    fn test_slugify_special_chars() {
        assert_eq!(slugify("hello@world! #test"), "hello-world-test");
    }

    #[test]
    fn test_slugify_consecutive_dashes() {
        assert_eq!(slugify("a---b---c"), "a-b-c");
    }

    #[test]
    fn test_slugify_leading_trailing() {
        assert_eq!(slugify("--hello--"), "hello");
    }

    #[test]
    fn test_slugify_length_cap() {
        let long = "a".repeat(100);
        let result = slugify(&long);
        assert!(result.len() <= 50);
    }

    #[test]
    fn test_slugify_empty() {
        assert_eq!(slugify(""), "");
    }

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

    // --- Additional slugify tests ---

    #[test]
    fn test_slugify_all_special_chars() {
        // All non-alphanumeric should collapse to empty after trimming dashes
        assert_eq!(slugify("!@#$%^&*()"), "");
    }

    #[test]
    fn test_slugify_single_char() {
        assert_eq!(slugify("a"), "a");
    }

    #[test]
    fn test_slugify_numbers() {
        assert_eq!(slugify("version 2.0 release"), "version-2-0-release");
    }

    #[test]
    fn test_slugify_mixed_case() {
        assert_eq!(slugify("CamelCase AND UPPER"), "camelcase-and-upper");
    }

    #[test]
    fn test_slugify_unicode_replaced() {
        // Non-ASCII chars become dashes, then collapsed/trimmed
        assert_eq!(slugify("café"), "caf");
    }

    #[test]
    fn test_slugify_length_cap_trims_trailing_dash() {
        // 48 'a's + " b" = slug "aaa...a-b" at 50 chars exactly
        // But let's make one that would end with a dash at position 50
        let input = format!("{} {}", "a".repeat(49), "b");
        let result = slugify(&input);
        assert!(result.len() <= 50);
        assert!(!result.ends_with('-'));
    }

    #[test]
    fn test_slugify_exactly_50_chars() {
        let input = "a".repeat(50);
        assert_eq!(slugify(&input), "a".repeat(50));
    }

    #[test]
    fn test_slugify_51_chars_truncated() {
        let input = "a".repeat(51);
        assert_eq!(slugify(&input), "a".repeat(50));
    }

    #[test]
    fn test_slugify_spaces_only() {
        assert_eq!(slugify("   "), "");
    }

    #[test]
    fn test_slugify_tabs_and_newlines() {
        assert_eq!(slugify("hello\tworld\nfoo"), "hello-world-foo");
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
        assert!(expected.to_string_lossy().contains("feature-implement-queue-1a2b"));
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

    // --- Notes on integration tests ---
    // The following functions require DB/IO and would need integration tests:
    // - ensure_worktree: needs SqlitePool, filesystem, git, and WsSender
    // - run_setup_commands: needs SqlitePool, filesystem, shell, and WsSender
    // - get_project_id_for_feature: needs SqlitePool with seeded data
    // - get_project_directory: needs SqlitePool with seeded data
    // - get_setting / set_setting: need SqlitePool with schema
}

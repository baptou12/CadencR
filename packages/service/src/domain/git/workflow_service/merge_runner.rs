//! Low-level `git merge` invocation + failure parser used by
//! [`super::merge`]. Lives in its own file so the parent stays under the
//! 400-line cap (see `.claude/rules/file-size.md`).
//!
//! Why this exists at all: the shared `run_git*` helpers throw away stdout
//! on failure. That works for most commands, but `git merge` emits the
//! actionable conflict detail on **stdout** (`CONFLICT (content): Merge
//! conflict in <path>`) while stderr only carries a one-liner summary that
//! is sometimes empty depending on git version / config. Dropping stdout
//! produced the bug this module fixes: the merge dialog rendered
//! `Merge failed: git merge … failed:` with nothing after the colon.

use std::path::Path;

use tokio::process::Command;

use super::merge::MergeMode;
use crate::domain::git::commands::parse_conflict_files;
use crate::domain::git::models::MergeResult;
use crate::error::AppError;
use crate::shared::git_cli::guard_positionals;

/// Outcome of a single `git merge` invocation. The `Failed` variant carries
/// both streams because conflicts land on stdout while the
/// "Automatic merge failed" summary lands on stderr — sometimes only one is
/// populated.
pub(super) enum MergeOutcome {
    Succeeded,
    Failed { stdout: String, stderr: String },
}

pub(super) async fn invoke_merge(
    repo: &Path,
    source_branch: &str,
    mode: MergeMode,
) -> Result<MergeOutcome, AppError> {
    guard_positionals(&[source_branch])?;
    let mut args: Vec<&str> = Vec::with_capacity(mode.flags().len() + 2);
    args.push("merge");
    args.extend_from_slice(mode.flags());
    args.push(source_branch);

    let output = Command::new("git")
        .args(&args)
        .current_dir(repo)
        .output()
        .await
        .map_err(|e| AppError::GitCommandError(format!("Failed to spawn git merge: {e}")))?;

    if output.status.success() {
        return Ok(MergeOutcome::Succeeded);
    }
    Ok(MergeOutcome::Failed {
        stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
        stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
    })
}

/// Build the user-facing `MergeResult` for a failed merge. Prefers a
/// structured conflict message (with file list) when stdout shows
/// `CONFLICT` lines, and falls back to whichever output stream is
/// non-empty — never returning an empty `failed:` tail.
pub(super) fn build_failure_result(
    stdout: &str,
    stderr: &str,
    source_branch: &str,
    target_branch: &str,
) -> MergeResult {
    let conflict_files = parse_conflict_files(stdout);
    if !conflict_files.is_empty() {
        let joined = conflict_files.join(", ");
        let plural = if conflict_files.len() == 1 { "" } else { "s" };
        let message = format!(
            "Merge conflict in {joined}. Resolve the conflict{plural} in '{target_branch}', \
             commit the result, then try merging '{source_branch}' again.",
        );
        return MergeResult {
            success: false,
            error: Some(message),
            conflict_files: Some(conflict_files),
        };
    }

    let combined = combine_outputs(stdout, stderr);
    let message = if combined.is_empty() {
        format!("git merge {source_branch} failed with no output — run it manually to see why.")
    } else {
        format!("git merge {source_branch} failed: {combined}")
    };
    MergeResult {
        success: false,
        error: Some(message),
        conflict_files: None,
    }
}

fn combine_outputs(stdout: &str, stderr: &str) -> String {
    let stdout = stdout.trim();
    let stderr = stderr.trim();
    match (stdout.is_empty(), stderr.is_empty()) {
        (true, true) => String::new(),
        (false, true) => stdout.to_string(),
        (true, false) => stderr.to_string(),
        (false, false) => format!("{stderr} ({stdout})"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn failure_with_conflicts_lists_files_and_is_actionable() {
        let result = build_failure_result(
            "CONFLICT (content): Merge conflict in foo.txt\n",
            "",
            "feature/x",
            "main",
        );
        assert!(!result.success);
        let err = result.error.expect("error message");
        assert!(err.contains("foo.txt"), "{err}");
        assert!(err.contains("'main'"), "{err}");
        assert!(err.contains("'feature/x'"), "{err}");
        assert_eq!(
            result.conflict_files.as_deref(),
            Some(&["foo.txt".to_string()][..])
        );
    }

    #[test]
    fn failure_without_output_still_produces_a_message() {
        // Regression: the original bug. Empty stdout + empty stderr used to
        // render `git merge … failed:` with nothing after the colon.
        let result = build_failure_result("", "", "feature/x", "main");
        let err = result.error.expect("error message");
        assert!(!err.trim_end().ends_with(':'), "{err}");
        assert!(err.contains("feature/x"), "{err}");
        assert!(result.conflict_files.is_none());
    }

    #[test]
    fn failure_falls_back_to_stderr_when_no_conflicts_present() {
        let result = build_failure_result(
            "",
            "fatal: refusing to merge unrelated histories",
            "feature/x",
            "main",
        );
        let err = result.error.expect("error message");
        assert!(
            err.contains("refusing to merge unrelated histories"),
            "{err}"
        );
        assert!(result.conflict_files.is_none());
    }

    #[test]
    fn combine_outputs_handles_each_empty_combination() {
        assert_eq!(combine_outputs("", ""), "");
        assert_eq!(combine_outputs("out", ""), "out");
        assert_eq!(combine_outputs("", "err"), "err");
        assert_eq!(combine_outputs("out", "err"), "err (out)");
    }
}

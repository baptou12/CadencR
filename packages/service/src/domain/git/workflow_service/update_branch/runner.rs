use std::path::Path;

use crate::domain::git::models::{GitOperationKind, GitOperationResponse, UpdateBranchStrategy};
use crate::error::AppError;
use crate::shared::git_cli::{git_output_error, guard_positionals, run_git_output_with_env};

use super::operation::detect_active_git_operation;

pub(super) async fn start(
    worktree: &Path,
    strategy: UpdateBranchStrategy,
    target: &str,
) -> Result<GitOperationResponse, AppError> {
    guard_positionals(&[target])?;
    let (args, expected) = match strategy {
        UpdateBranchStrategy::Rebase => (vec!["rebase", target], GitOperationKind::Rebase),
        UpdateBranchStrategy::Merge => {
            (vec!["merge", "--no-edit", target], GitOperationKind::Merge)
        }
    };
    run_recoverable(worktree, &args, expected).await
}

pub(super) async fn continue_operation(
    worktree: &Path,
    operation: GitOperationKind,
) -> Result<GitOperationResponse, AppError> {
    let args = match operation {
        GitOperationKind::Rebase => ["rebase", "--continue"],
        GitOperationKind::Merge => ["merge", "--continue"],
    };
    run_recoverable(worktree, &args, operation).await
}

pub(super) async fn abort(
    worktree: &Path,
    operation: GitOperationKind,
) -> Result<GitOperationResponse, AppError> {
    let args = match operation {
        GitOperationKind::Rebase => ["rebase", "--abort"],
        GitOperationKind::Merge => ["merge", "--abort"],
    };
    let output = invoke(worktree, &args).await?;
    if !output.status.success() {
        return Err(git_output_error(&args, &output));
    }
    Ok(GitOperationResponse::Completed)
}

async fn run_recoverable(
    worktree: &Path,
    args: &[&str],
    expected: GitOperationKind,
) -> Result<GitOperationResponse, AppError> {
    let output = invoke(worktree, args).await?;
    if output.status.success() {
        return Ok(GitOperationResponse::Completed);
    }

    let primary = git_output_error(args, &output);
    let active = detect_active_git_operation(worktree)
        .await
        .map_err(|inspection| inspection_error(&primary, inspection))?;
    if active != Some(expected) {
        return Err(primary);
    }
    let conflict_files = unmerged_paths(worktree)
        .await
        .map_err(|inspection| inspection_error(&primary, inspection))?;
    if !conflict_files.is_empty() {
        return Ok(GitOperationResponse::Conflicts { conflict_files });
    }
    Err(primary)
}

async fn invoke(worktree: &Path, args: &[&str]) -> Result<std::process::Output, AppError> {
    run_git_output_with_env(
        args,
        worktree,
        &[("GIT_EDITOR", "true"), ("GIT_SEQUENCE_EDITOR", "true")],
    )
    .await
}

async fn unmerged_paths(worktree: &Path) -> Result<Vec<String>, AppError> {
    let args = ["diff", "--name-only", "--diff-filter=U", "-z"];
    let output = run_git_output_with_env(&args, worktree, &[("GIT_OPTIONAL_LOCKS", "0")]).await?;
    if !output.status.success() {
        return Err(git_output_error(&args, &output));
    }

    let mut paths = Vec::new();
    for bytes in output.stdout.split(|byte| *byte == 0) {
        if bytes.is_empty() {
            continue;
        }
        let path = String::from_utf8_lossy(bytes).into_owned();
        paths.push(path);
    }
    Ok(paths)
}

fn inspection_error(primary: &AppError, inspection: AppError) -> AppError {
    AppError::GitCommandError(format!(
        "{primary}; conflict-state inspection also failed: {inspection}"
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::git::workflow_service::update_branch::test_support::RepoFixture;

    #[tokio::test]
    async fn merge_conflicts_are_returned_and_left_active() {
        let fixture = RepoFixture::new();
        fixture.create_conflicting_histories();

        let response = start(&fixture.feature, UpdateBranchStrategy::Merge, "main")
            .await
            .unwrap();

        assert_eq!(
            response,
            GitOperationResponse::Conflicts {
                conflict_files: vec!["conflict.txt".into()]
            }
        );
        assert_eq!(
            detect_active_git_operation(&fixture.feature).await.unwrap(),
            Some(GitOperationKind::Merge)
        );
    }

    #[tokio::test]
    async fn merge_continue_and_abort_use_the_active_operation() {
        let fixture = RepoFixture::new();
        fixture.create_conflicting_histories();
        assert!(matches!(
            start(&fixture.feature, UpdateBranchStrategy::Merge, "main")
                .await
                .unwrap(),
            GitOperationResponse::Conflicts { .. }
        ));
        fixture.write_feature("conflict.txt", "resolved\n");
        fixture.git_feature(&["add", "conflict.txt"]);

        assert_eq!(
            continue_operation(&fixture.feature, GitOperationKind::Merge)
                .await
                .unwrap(),
            GitOperationResponse::Completed
        );
        assert_eq!(
            detect_active_git_operation(&fixture.feature).await.unwrap(),
            None
        );

        let abort_fixture = RepoFixture::new();
        abort_fixture.create_conflicting_histories();
        assert!(matches!(
            start(&abort_fixture.feature, UpdateBranchStrategy::Merge, "main")
                .await
                .unwrap(),
            GitOperationResponse::Conflicts { .. }
        ));
        assert_eq!(
            abort(&abort_fixture.feature, GitOperationKind::Merge)
                .await
                .unwrap(),
            GitOperationResponse::Completed
        );
        assert_eq!(
            detect_active_git_operation(&abort_fixture.feature)
                .await
                .unwrap(),
            None
        );
    }

    #[tokio::test]
    async fn rebase_can_conflict_again_on_a_later_commit_then_continue() {
        let fixture = RepoFixture::new();
        fixture.create_two_commit_rebase_conflict();

        assert!(matches!(
            start(&fixture.feature, UpdateBranchStrategy::Rebase, "main")
                .await
                .unwrap(),
            GitOperationResponse::Conflicts { .. }
        ));
        fixture.write_feature("first.txt", "resolved first\n");
        fixture.git_feature(&["add", "first.txt"]);
        let second = continue_operation(&fixture.feature, GitOperationKind::Rebase)
            .await
            .unwrap();
        assert_eq!(
            second,
            GitOperationResponse::Conflicts {
                conflict_files: vec!["second.txt".into()]
            }
        );

        fixture.write_feature("second.txt", "resolved second\n");
        fixture.git_feature(&["add", "second.txt"]);
        assert_eq!(
            continue_operation(&fixture.feature, GitOperationKind::Rebase)
                .await
                .unwrap(),
            GitOperationResponse::Completed
        );
    }

    #[tokio::test]
    async fn rebase_abort_restores_the_feature_tip() {
        let fixture = RepoFixture::new();
        fixture.create_conflicting_histories();
        let before = fixture.rev_parse_feature("feature/test");
        assert!(matches!(
            start(&fixture.feature, UpdateBranchStrategy::Rebase, "main")
                .await
                .unwrap(),
            GitOperationResponse::Conflicts { .. }
        ));

        abort(&fixture.feature, GitOperationKind::Rebase)
            .await
            .unwrap();

        assert_eq!(fixture.rev_parse_feature("HEAD"), before);
        assert_eq!(
            detect_active_git_operation(&fixture.feature).await.unwrap(),
            None
        );
    }

    #[tokio::test]
    async fn continue_overrides_hostile_editor_configuration() {
        let fixture = RepoFixture::new();
        fixture.create_conflicting_histories();
        let marker = fixture.root.path().join("editor-ran");
        let editor = format!("touch {}; exit 1", marker.display());
        fixture.git_feature(&["config", "core.editor", &editor]);
        fixture.git_feature(&["config", "sequence.editor", &editor]);
        assert!(matches!(
            start(&fixture.feature, UpdateBranchStrategy::Rebase, "main")
                .await
                .unwrap(),
            GitOperationResponse::Conflicts { .. }
        ));
        fixture.write_feature("conflict.txt", "resolved\n");
        fixture.git_feature(&["add", "conflict.txt"]);

        let response = continue_operation(&fixture.feature, GitOperationKind::Rebase)
            .await
            .unwrap();

        assert_eq!(response, GitOperationResponse::Completed);
        assert!(!marker.exists(), "configured editor must not run");
    }
}

use std::path::Path;
use std::time::Duration;

use crate::domain::git::models::GitOperationKind;
use crate::error::AppError;
use crate::shared::git_cli::git_output_error;

use super::super::operation::detect_active_git_operation;

const RETRY_LIMIT: usize = 6;
const BASE_DELAY_MS: u64 = 25;

pub(super) async fn invoke_with_index_lock_recovery<'a>(
    worktree: &Path,
    initial_args: &[&'a str],
    expected: GitOperationKind,
) -> Result<(Vec<&'a str>, std::process::Output), AppError> {
    let active_before = detect_active_git_operation(worktree).await?;
    let mut args = initial_args.to_vec();
    let mut resumed_created_operation = false;

    for retry in 0..=RETRY_LIMIT {
        let output = super::invoke(worktree, &args).await?;
        if output.status.success() || !is_lock_contention(&output) || retry == RETRY_LIMIT {
            return Ok((args, output));
        }

        if !resumed_created_operation && active_before != Some(expected) {
            let primary = git_output_error(&args, &output);
            match detect_active_git_operation(worktree).await {
                Ok(Some(active)) if active == expected => {
                    args = super::control_args(expected, "--continue").to_vec();
                    resumed_created_operation = true;
                }
                Ok(_) => {}
                Err(inspection) => return Err(super::inspection_error(&primary, inspection)),
            }
        }
        tokio::time::sleep(retry_delay(retry)).await;
    }
    unreachable!("bounded index-lock retry loop always returns")
}

fn is_lock_contention(output: &std::process::Output) -> bool {
    let stderr = String::from_utf8_lossy(&output.stderr);
    let stdout = String::from_utf8_lossy(&output.stdout);
    [stderr.as_ref(), stdout.as_ref()]
        .iter()
        .any(|text| text.contains("index.lock") && text.contains("File exists"))
}

fn retry_delay(retry: usize) -> Duration {
    Duration::from_millis(BASE_DELAY_MS * (1_u64 << retry.min(RETRY_LIMIT)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::git::models::{GitOperationResponse, UpdateBranchStrategy};
    use crate::domain::git::workflow_service::update_branch::runner::{
        continue_operation, run_recoverable, start,
    };
    use crate::domain::git::workflow_service::update_branch::test_support::RepoFixture;

    async fn staged_first_rebase_conflict() -> RepoFixture {
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
        fixture
    }

    #[tokio::test]
    async fn continue_waits_for_a_transient_index_lock() {
        let fixture = staged_first_rebase_conflict().await;
        let lock_path = String::from_utf8(
            fixture
                .git_output_feature(&["rev-parse", "--git-path", "index.lock"])
                .stdout,
        )
        .unwrap();
        let lock_path = std::path::PathBuf::from(lock_path.trim());
        std::fs::write(&lock_path, b"transient test lock").unwrap();
        let release = tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(75)).await;
            std::fs::remove_file(lock_path).unwrap();
        });

        let response = continue_operation(&fixture.feature, GitOperationKind::Rebase)
            .await
            .unwrap();
        release.await.unwrap();

        assert_eq!(
            response,
            GitOperationResponse::Conflicts {
                conflict_files: vec!["second.txt".into()]
            }
        );
    }

    #[tokio::test]
    async fn lock_failure_resumes_only_the_rebase_created_by_the_invocation() {
        let fixture = RepoFixture::new();
        fixture.create_two_commit_rebase_conflict();
        fixture.git_feature(&[
            "config",
            "alias.create-rebase-lock",
            "!git rebase main >/dev/null 2>&1 || :; printf 'resolved first\\n' > first.txt; git add first.txt; echo 'Unable to create index.lock: File exists' >&2; exit 1",
        ]);

        let response = run_recoverable(
            &fixture.feature,
            &["create-rebase-lock"],
            GitOperationKind::Rebase,
        )
        .await
        .unwrap();

        assert_eq!(
            response,
            GitOperationResponse::Conflicts {
                conflict_files: vec!["second.txt".into()]
            }
        );
    }

    #[tokio::test]
    async fn unrelated_lock_output_does_not_resume_a_preexisting_rebase() {
        let fixture = staged_first_rebase_conflict().await;
        fixture.git_feature(&[
            "config",
            "alias.fail-index-lock",
            "!echo 'Unable to create index.lock: File exists' >&2; exit 1",
        ]);

        let error = run_recoverable(
            &fixture.feature,
            &["fail-index-lock"],
            GitOperationKind::Rebase,
        )
        .await
        .unwrap_err();

        assert!(error.to_string().contains("fail-index-lock"), "{error}");
        assert_eq!(
            detect_active_git_operation(&fixture.feature).await.unwrap(),
            Some(GitOperationKind::Rebase)
        );
    }
}

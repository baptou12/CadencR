use std::future::Future;
use std::path::Path;

use crate::domain::git::models::{
    ConflictContentResponse, ConflictContentSnapshot, ConflictIndexEntryContent,
    ConflictUnavailableReason,
};
use crate::error::AppError;

use super::content::{read_index_entry, read_result};
use super::fingerprint::{read_conflict_fingerprint, ConflictStageFingerprint};
use super::presentation::presentation_for;

pub async fn get_conflict_content(
    repo: &Path,
    file_path: &str,
) -> Result<ConflictContentResponse, AppError> {
    get_conflict_content_with_hook(repo, file_path, || async {}).await
}

async fn get_conflict_content_with_hook<F, Fut>(
    repo: &Path,
    file_path: &str,
    before_recheck: F,
) -> Result<ConflictContentResponse, AppError>
where
    F: FnOnce() -> Fut,
    Fut: Future<Output = ()>,
{
    let before = match read_conflict_fingerprint(repo, file_path).await {
        Ok(Some(fingerprint)) => fingerprint,
        Ok(None) => return Ok(unavailable(file_path, ConflictUnavailableReason::Resolved)),
        Err(_) => {
            return Ok(unavailable(
                file_path,
                ConflictUnavailableReason::RepositoryUnavailable,
            ));
        }
    };

    let (base, stage_2, stage_3, result) = tokio::join!(
        read_optional_entry(repo, before.base.as_ref()),
        read_optional_entry(repo, before.stage_2.as_ref()),
        read_optional_entry(repo, before.stage_3.as_ref()),
        read_result(repo, file_path),
    );
    before_recheck().await;

    let after = match read_conflict_fingerprint(repo, file_path).await {
        Ok(Some(fingerprint)) => fingerprint,
        Ok(None) => return Ok(unavailable(file_path, ConflictUnavailableReason::Resolved)),
        Err(_) => {
            return Ok(unavailable(
                file_path,
                ConflictUnavailableReason::RepositoryUnavailable,
            ));
        }
    };
    if before != after {
        return Ok(unavailable(file_path, ConflictUnavailableReason::Stale));
    }

    let presentation = presentation_for(&before, [&base, &stage_2, &stage_3], result.as_ref());
    Ok(ConflictContentResponse::Available {
        snapshot: ConflictContentSnapshot {
            file_path: before.file_path,
            conflict_kind: before.conflict_kind,
            operation: before.operation,
            presentation,
            base,
            stage_2,
            stage_3,
            result,
        },
    })
}

async fn read_optional_entry(
    repo: &Path,
    stage: Option<&ConflictStageFingerprint>,
) -> Option<ConflictIndexEntryContent> {
    match stage {
        Some(stage) => Some(read_index_entry(repo, stage).await),
        None => None,
    }
}

fn unavailable(file_path: &str, reason: ConflictUnavailableReason) -> ConflictContentResponse {
    ConflictContentResponse::Unavailable {
        file_path: file_path.to_string(),
        reason,
    }
}

#[cfg(test)]
mod tests {
    use std::io::Write;
    use std::path::{Path, PathBuf};
    use std::process::{Command, Stdio};

    use super::*;
    use crate::domain::git::commands::conflict_content::presentation::guidance;
    use crate::domain::git::file_size::LARGE_FILE_BYTES;
    use crate::domain::git::models::{
        ConflictContent, ConflictFallbackReason, ConflictFileKind, ConflictKind,
        ConflictUnavailableReason,
    };

    struct Repo {
        _root: tempfile::TempDir,
        path: PathBuf,
    }

    impl Repo {
        fn new() -> Self {
            let root = tempfile::tempdir().unwrap();
            let path = root.path().join("repo");
            std::fs::create_dir(&path).unwrap();
            for args in [
                &["init", "-q", "-b", "main"][..],
                &["config", "user.email", "test@example.com"],
                &["config", "user.name", "Test"],
                &["config", "commit.gpgsign", "false"],
            ] {
                git(&path, args);
            }
            std::fs::write(path.join("seed.txt"), "seed\n").unwrap();
            git(&path, &["add", "seed.txt"]);
            git(&path, &["commit", "-q", "-m", "seed"]);
            Self { _root: root, path }
        }

        fn install(&self, path: &str, stages: &[(u8, &[u8], &str)], result: Option<&[u8]>) {
            let rows = stages
                .iter()
                .map(|(stage, bytes, mode)| {
                    let blob = self.write_blob(bytes);
                    format!("{mode} {blob} {stage}\t{path}\n")
                })
                .collect::<String>();
            let mut child = Command::new("git")
                .args(["update-index", "--index-info"])
                .current_dir(&self.path)
                .env("GIT_CONFIG_NOSYSTEM", "1")
                .env("GIT_CONFIG_GLOBAL", "/dev/null")
                .stdin(Stdio::piped())
                .spawn()
                .unwrap();
            child
                .stdin
                .take()
                .unwrap()
                .write_all(rows.as_bytes())
                .unwrap();
            assert!(child.wait().unwrap().success());
            let result_path = self.path.join(path);
            if let Some(parent) = result_path.parent() {
                std::fs::create_dir_all(parent).unwrap();
            }
            match result {
                Some(bytes) => std::fs::write(result_path, bytes).unwrap(),
                None if result_path.exists() => std::fs::remove_file(result_path).unwrap(),
                None => {}
            }
        }

        fn write_blob(&self, bytes: &[u8]) -> String {
            let mut child = Command::new("git")
                .args(["hash-object", "-w", "--stdin"])
                .current_dir(&self.path)
                .env("GIT_CONFIG_NOSYSTEM", "1")
                .env("GIT_CONFIG_GLOBAL", "/dev/null")
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .spawn()
                .unwrap();
            child.stdin.take().unwrap().write_all(bytes).unwrap();
            let output = child.wait_with_output().unwrap();
            assert!(output.status.success());
            String::from_utf8(output.stdout).unwrap().trim().to_string()
        }
    }

    fn git(repo: &Path, args: &[&str]) {
        let output = Command::new("git")
            .args(args)
            .current_dir(repo)
            .env("GIT_CONFIG_NOSYSTEM", "1")
            .env("GIT_CONFIG_GLOBAL", "/dev/null")
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "git {} failed: {}",
            args.join(" "),
            String::from_utf8_lossy(&output.stderr)
        );
    }

    fn available(response: ConflictContentResponse) -> ConflictContentSnapshot {
        match response {
            ConflictContentResponse::Available { snapshot } => snapshot,
            other => panic!("expected available response, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn reads_all_seven_unmerged_shapes_and_unusual_literal_paths() {
        let cases = [
            ("DD", ConflictKind::Dd, vec![1]),
            ("AU", ConflictKind::Au, vec![2]),
            ("UD", ConflictKind::Ud, vec![1, 2]),
            ("UA", ConflictKind::Ua, vec![3]),
            ("DU", ConflictKind::Du, vec![1, 3]),
            ("AA", ConflictKind::Aa, vec![2, 3]),
            ("UU", ConflictKind::Uu, vec![1, 2, 3]),
        ];
        for (xy, expected, present) in cases {
            let repo = Repo::new();
            let path = format!("-literal [x] {xy}\tname.txt");
            let stages = present
                .iter()
                .map(|stage| (*stage, b"text\n".as_slice(), "100644"))
                .collect::<Vec<_>>();
            let result = (xy != "DD").then_some(b"result\n".as_slice());
            repo.install(&path, &stages, result);

            let snapshot = available(get_conflict_content(&repo.path, &path).await.unwrap());
            assert_eq!(snapshot.conflict_kind, expected, "{xy}");
            assert_eq!(snapshot.base.is_some(), present.contains(&1), "{xy}");
            assert_eq!(snapshot.stage_2.is_some(), present.contains(&2), "{xy}");
            assert_eq!(snapshot.stage_3.is_some(), present.contains(&3), "{xy}");
        }
    }

    #[tokio::test]
    async fn classifies_binary_large_missing_and_unsupported_content() {
        let binary = Repo::new();
        binary.install(
            "binary.dat",
            &[(2, b"ours\0", "100644"), (3, b"theirs\0", "100644")],
            Some(b"result\0"),
        );
        let snapshot = available(
            get_conflict_content(&binary.path, "binary.dat")
                .await
                .unwrap(),
        );
        assert_eq!(
            snapshot.presentation,
            guidance(ConflictFallbackReason::Binary)
        );

        let large = Repo::new();
        let bytes = vec![b'x'; LARGE_FILE_BYTES as usize];
        large.install(
            "large.txt",
            &[(2, &bytes, "100644"), (3, b"small\n", "100644")],
            Some(b"result\n"),
        );
        let snapshot = available(
            get_conflict_content(&large.path, "large.txt")
                .await
                .unwrap(),
        );
        assert_eq!(
            snapshot.presentation,
            guidance(ConflictFallbackReason::Large)
        );
        assert!(matches!(
            snapshot.stage_2.unwrap().content,
            ConflictContent::Large
        ));

        let unsupported = Repo::new();
        unsupported.install(
            "link",
            &[(2, b"target-a", "120000"), (3, b"target-b", "120000")],
            Some(b"target-result"),
        );
        let snapshot = available(
            get_conflict_content(&unsupported.path, "link")
                .await
                .unwrap(),
        );
        assert_eq!(
            snapshot.stage_2.unwrap().file_kind,
            ConflictFileKind::Symlink
        );
        assert_eq!(
            snapshot.presentation,
            guidance(ConflictFallbackReason::Unavailable)
        );
    }

    #[tokio::test]
    async fn reports_resolved_and_changed_conflict_races() {
        let resolved = Repo::new();
        resolved.install(
            "race.txt",
            &[(2, b"ours\n", "100644"), (3, b"theirs\n", "100644")],
            Some(b"result\n"),
        );
        let response = get_conflict_content_with_hook(&resolved.path, "race.txt", || async {
            git(&resolved.path, &["add", "--", "race.txt"]);
        })
        .await
        .unwrap();
        assert_eq!(
            response,
            unavailable("race.txt", ConflictUnavailableReason::Resolved)
        );

        let stale = Repo::new();
        stale.install(
            "race.txt",
            &[(2, b"ours\n", "100644"), (3, b"theirs\n", "100644")],
            Some(b"result\n"),
        );
        let response = get_conflict_content_with_hook(&stale.path, "race.txt", || async {
            stale.install(
                "race.txt",
                &[(2, b"changed\n", "100644"), (3, b"theirs\n", "100644")],
                Some(b"result\n"),
            );
        })
        .await
        .unwrap();
        assert_eq!(
            response,
            unavailable("race.txt", ConflictUnavailableReason::Stale)
        );
    }

    #[tokio::test]
    async fn reports_repository_unavailable_without_exposing_git_errors() {
        let not_a_repo = tempfile::tempdir().unwrap();
        let response = get_conflict_content(not_a_repo.path(), "conflict.txt")
            .await
            .unwrap();
        assert_eq!(
            response,
            unavailable(
                "conflict.txt",
                ConflictUnavailableReason::RepositoryUnavailable
            )
        );
    }

    #[tokio::test]
    async fn reads_conflict_from_the_selected_linked_worktree() {
        let repo = Repo::new();
        git(&repo.path, &["branch", "feature"]);
        let linked = repo._root.path().join("linked");
        git(
            &repo.path,
            &["worktree", "add", "-q", linked.to_str().unwrap(), "feature"],
        );
        let linked_repo = Repo {
            _root: tempfile::tempdir().unwrap(),
            path: linked,
        };
        linked_repo.install(
            "linked.txt",
            &[(2, b"ours\n", "100644"), (3, b"theirs\n", "100644")],
            Some(b"result\n"),
        );

        let snapshot = available(
            get_conflict_content(&linked_repo.path, "linked.txt")
                .await
                .unwrap(),
        );
        assert_eq!(snapshot.file_path, "linked.txt");
        assert!(snapshot.stage_2.is_some());
        assert!(get_conflict_content(&repo.path, "linked.txt")
            .await
            .is_ok_and(|response| response
                == unavailable("linked.txt", ConflictUnavailableReason::Resolved)));
    }
}

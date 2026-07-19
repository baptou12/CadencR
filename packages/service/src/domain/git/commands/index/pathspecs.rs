use std::path::Path;

use crate::domain::git::models::FileStageState;
use crate::domain::git::porcelain::{parse_porcelain_v2_entries, PorcelainFileEntry};
use crate::error::AppError;
use crate::shared::git_cli::run_git_background;

struct MutationTarget {
    pathspecs: Vec<String>,
    stage_state: FileStageState,
}

pub(super) async fn mutation_pathspecs(
    repo: &Path,
    file_path: &str,
) -> Result<Vec<String>, AppError> {
    Ok(mutation_target(repo, file_path).await?.pathspecs)
}

pub(super) async fn reset_pathspecs(repo: &Path, file_path: &str) -> Result<Vec<String>, AppError> {
    let target = mutation_target(repo, file_path).await?;
    validate_reset_target(file_path, &target)?;
    Ok(target.pathspecs)
}

async fn mutation_target(repo: &Path, file_path: &str) -> Result<MutationTarget, AppError> {
    let porcelain = run_git_background(
        &["status", "--porcelain=v2", "-z", "--untracked-files=all"],
        repo,
    )
    .await?;
    let entries = parse_porcelain_v2_entries(&porcelain);
    let mut matches = entries
        .iter()
        .filter(|entry| mutation_paths(entry).any(|path| path == file_path));
    let Some(entry) = matches.next() else {
        if path_is_directory_prefix(repo, file_path, &entries) {
            return Err(AppError::BadRequest(format!(
                "file path {file_path:?} is a directory or directory prefix; select exactly one changed file"
            )));
        }
        return Err(unmatched_row_error(repo, file_path));
    };
    if matches.next().is_some() {
        return Err(AppError::BadRequest(format!(
            "file path {file_path:?} matches multiple Git status rows; refresh status and select one current path"
        )));
    }

    let paths = mutation_paths(entry).collect::<Vec<_>>();
    if entries.iter().any(|candidate| {
        !std::ptr::eq(candidate, entry)
            && paths.iter().any(|path| path_selects_entry(path, candidate))
    }) {
        return Err(AppError::BadRequest(format!(
            "file path {file_path:?} overlaps multiple Git status rows; refresh status and select one changed file"
        )));
    }

    Ok(MutationTarget {
        pathspecs: paths.into_iter().map(literal_pathspec).collect(),
        stage_state: entry.stage_state,
    })
}

fn validate_reset_target(file_path: &str, target: &MutationTarget) -> Result<(), AppError> {
    if target.stage_state == FileStageState::Conflicted {
        return Err(AppError::BadRequest(format!(
            "cannot unstage unresolved conflict {file_path:?}; resolve the conflict in the worktree and stage the resolution instead"
        )));
    }
    Ok(())
}

fn path_is_directory_prefix(repo: &Path, file_path: &str, entries: &[PorcelainFileEntry]) -> bool {
    repo.join(file_path).is_dir()
        || entries
            .iter()
            .any(|entry| path_selects_entry(file_path, entry))
}

fn is_descendant(candidate: &str, parent: &str) -> bool {
    Path::new(candidate)
        .strip_prefix(parent)
        .is_ok_and(|suffix| !suffix.as_os_str().is_empty())
}

fn path_selects_entry(path: &str, entry: &PorcelainFileEntry) -> bool {
    mutation_paths(entry).any(|candidate| candidate == path || is_descendant(candidate, path))
}

fn mutation_paths(entry: &PorcelainFileEntry) -> impl Iterator<Item = &str> {
    let rename_source = entry
        .status_code
        .starts_with('R')
        .then_some(entry.old_path.as_deref())
        .flatten()
        .filter(|old_path| *old_path != entry.path);
    std::iter::once(entry.path.as_str()).chain(rename_source)
}

fn unmatched_row_error(repo: &Path, file_path: &str) -> AppError {
    if std::fs::symlink_metadata(repo.join(file_path)).is_ok() {
        return AppError::BadRequest(format!(
            "file path {file_path:?} is clean or ignored; select a changed file from Git status"
        ));
    }
    AppError::BadRequest(format!(
        "file path {file_path:?} does not exist and has no Git status row"
    ))
}

fn literal_pathspec(file_path: &str) -> String {
    format!(":(literal){file_path}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn copied_row_mutates_only_its_destination() {
        let output = concat!(
            "2 C. N... 100644 100644 100644 abc def C100 copied.txt\0",
            "source.txt\0",
        );
        let entries = parse_porcelain_v2_entries(output);

        assert_eq!(
            mutation_paths(&entries[0]).collect::<Vec<_>>(),
            ["copied.txt"]
        );
    }

    #[test]
    fn reset_rejects_every_unmerged_xy_kind() {
        for xy in ["DD", "AU", "UD", "UA", "DU", "AA", "UU"] {
            let path = format!("conflict-{xy}.txt");
            let output = format!("u {xy} N... 100644 100644 100644 100644 a b c {path}\n");
            let entry = parse_porcelain_v2_entries(&output).remove(0);
            let target = MutationTarget {
                pathspecs: mutation_paths(&entry).map(literal_pathspec).collect(),
                stage_state: entry.stage_state,
            };

            let error = validate_reset_target(&path, &target).unwrap_err();

            let AppError::BadRequest(message) = error else {
                panic!("expected BadRequest for {xy}");
            };
            assert!(
                message.contains("cannot unstage unresolved conflict"),
                "{xy}: {message}"
            );
            assert!(message.contains("resolve the conflict"), "{xy}: {message}");
            assert!(message.contains("stage the resolution"), "{xy}: {message}");
        }
    }
}

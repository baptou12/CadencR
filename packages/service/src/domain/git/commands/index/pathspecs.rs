use std::path::Path;

use crate::domain::git::porcelain::{parse_porcelain_v2_entries, PorcelainFileEntry};
use crate::error::AppError;
use crate::shared::git_cli::run_git_background;

pub(super) async fn mutation_pathspecs(
    repo: &Path,
    file_path: &str,
) -> Result<Vec<String>, AppError> {
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

    Ok(paths.into_iter().map(literal_pathspec).collect())
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
}

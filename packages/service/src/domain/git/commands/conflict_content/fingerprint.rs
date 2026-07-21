use std::path::Path;

use crate::domain::git::models::{ConflictKind, GitOperationKind};
use crate::domain::git::workflow_service::detect_active_git_operation;
use crate::error::AppError;
use crate::shared::git_cli::{git_output_error, run_git_output_with_env};

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct ConflictStageFingerprint {
    pub(super) mode: String,
    pub(super) object_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct ConflictFingerprint {
    pub(super) file_path: String,
    pub(super) conflict_kind: ConflictKind,
    pub(super) operation: Option<GitOperationKind>,
    pub(super) submodule_state: String,
    pub(super) worktree_mode: String,
    pub(super) base: Option<ConflictStageFingerprint>,
    pub(super) stage_2: Option<ConflictStageFingerprint>,
    pub(super) stage_3: Option<ConflictStageFingerprint>,
}

struct ParsedUnmergedRow<'a> {
    conflict_kind: ConflictKind,
    submodule_state: &'a str,
    worktree_mode: &'a str,
    base: Option<ConflictStageFingerprint>,
    stage_2: Option<ConflictStageFingerprint>,
    stage_3: Option<ConflictStageFingerprint>,
    path: &'a [u8],
}

pub(super) async fn read_conflict_fingerprint(
    repo: &Path,
    file_path: &str,
) -> Result<Option<ConflictFingerprint>, AppError> {
    let args = ["status", "--porcelain=v2", "-z", "--untracked-files=no"];
    let output = run_git_output_with_env(&args, repo, &[("GIT_OPTIONAL_LOCKS", "0")]).await?;
    if !output.status.success() {
        return Err(git_output_error(&args, &output));
    }

    let mut matched: Option<ParsedUnmergedRow<'_>> = None;
    for record in output
        .stdout
        .split(|byte| *byte == 0)
        .filter(|row| !row.is_empty())
    {
        let Some(row) = parse_unmerged_row(record)? else {
            continue;
        };
        if row.path != file_path.as_bytes() {
            continue;
        }
        if matched.replace(row).is_some() {
            return Err(AppError::GitCommandError(format!(
                "git status returned more than one unmerged row for {file_path:?}"
            )));
        }
    }

    let Some(row) = matched else {
        return Ok(None);
    };
    let operation = detect_active_git_operation(repo).await?;
    Ok(Some(ConflictFingerprint {
        file_path: file_path.to_string(),
        conflict_kind: row.conflict_kind,
        operation,
        submodule_state: row.submodule_state.to_string(),
        worktree_mode: row.worktree_mode.to_string(),
        base: row.base,
        stage_2: row.stage_2,
        stage_3: row.stage_3,
    }))
}

fn parse_unmerged_row(record: &[u8]) -> Result<Option<ParsedUnmergedRow<'_>>, AppError> {
    let Some(rest) = record.strip_prefix(b"u ") else {
        return Ok(None);
    };
    let fields = rest.splitn(10, |byte| *byte == b' ').collect::<Vec<_>>();
    if fields.len() != 10 {
        return Err(AppError::GitCommandError(
            "git status returned a malformed unmerged row".into(),
        ));
    }
    let text = |index: usize, name: &str| {
        std::str::from_utf8(fields[index]).map_err(|_| {
            AppError::GitCommandError(format!(
                "git status returned non-UTF-8 {name} in an unmerged row"
            ))
        })
    };
    let conflict_kind = parse_conflict_kind(text(0, "XY")?)?;
    Ok(Some(ParsedUnmergedRow {
        conflict_kind,
        submodule_state: text(1, "submodule state")?,
        base: stage(text(2, "stage 1 mode")?, text(6, "stage 1 object ID")?)?,
        stage_2: stage(text(3, "stage 2 mode")?, text(7, "stage 2 object ID")?)?,
        stage_3: stage(text(4, "stage 3 mode")?, text(8, "stage 3 object ID")?)?,
        worktree_mode: text(5, "worktree mode")?,
        path: fields[9],
    }))
}

fn stage(mode: &str, object_id: &str) -> Result<Option<ConflictStageFingerprint>, AppError> {
    let missing =
        mode.bytes().all(|byte| byte == b'0') && object_id.bytes().all(|byte| byte == b'0');
    if missing {
        return Ok(None);
    }
    if mode.len() != 6 || !mode.bytes().all(|byte| matches!(byte, b'0'..=b'7')) {
        return Err(AppError::GitCommandError(
            "git status returned an invalid unmerged stage mode".into(),
        ));
    }
    if !matches!(object_id.len(), 40 | 64)
        || !object_id.bytes().all(|byte| byte.is_ascii_hexdigit())
    {
        return Err(AppError::GitCommandError(
            "git status returned an invalid unmerged object ID".into(),
        ));
    }
    Ok(Some(ConflictStageFingerprint {
        mode: mode.to_string(),
        object_id: object_id.to_string(),
    }))
}

fn parse_conflict_kind(xy: &str) -> Result<ConflictKind, AppError> {
    match xy {
        "DD" => Ok(ConflictKind::Dd),
        "AU" => Ok(ConflictKind::Au),
        "UD" => Ok(ConflictKind::Ud),
        "UA" => Ok(ConflictKind::Ua),
        "DU" => Ok(ConflictKind::Du),
        "AA" => Ok(ConflictKind::Aa),
        "UU" => Ok(ConflictKind::Uu),
        _ => Err(AppError::GitCommandError(format!(
            "git status returned unsupported unmerged state {xy:?}"
        ))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_literal_spaces_tabs_and_missing_stages() {
        let oid = "a".repeat(40);
        let record = format!(
            "u AA N... 000000 100644 100755 100644 {} {oid} {oid} literal [x] name\tpart.txt",
            "0".repeat(40)
        );
        let row = parse_unmerged_row(record.as_bytes()).unwrap().unwrap();
        assert_eq!(row.conflict_kind, ConflictKind::Aa);
        assert!(row.base.is_none());
        assert_eq!(row.stage_2.unwrap().object_id, oid);
        assert_eq!(row.path, b"literal [x] name\tpart.txt");
    }

    #[test]
    fn rejects_noncanonical_object_ids() {
        let zero = "0".repeat(40);
        let record =
            format!("u AU N... 000000 100644 000000 100644 {zero} --option {zero} file.txt");
        assert!(parse_unmerged_row(record.as_bytes()).is_err());
    }
}

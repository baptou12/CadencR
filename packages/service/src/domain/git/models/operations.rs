use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

/// Index/worktree state for one file. Comparison-only rows use
/// `NotApplicable`; working-tree rows use one of the remaining variants.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum FileStageState {
    #[default]
    NotApplicable,
    Untracked,
    Unstaged,
    Staged,
    Both,
    Conflicted,
}

impl FileStageState {
    pub fn from_xy(index: char, worktree: char) -> Self {
        match (index != '.', worktree != '.') {
            (true, true) => Self::Both,
            (true, false) => Self::Staged,
            (false, true) | (false, false) => Self::Unstaged,
        }
    }

    #[allow(dead_code)] // Retained for consumers merging independently decoded sides.
    pub fn merge(self, other: Self) -> Self {
        match (self, other) {
            (Self::Conflicted, _) | (_, Self::Conflicted) => Self::Conflicted,
            (Self::Both, _)
            | (_, Self::Both)
            | (Self::Staged, Self::Unstaged)
            | (Self::Unstaged, Self::Staged) => Self::Both,
            (Self::NotApplicable, state) | (state, Self::NotApplicable) => state,
            (Self::Untracked, state) | (state, Self::Untracked) if state != Self::Untracked => {
                Self::Both
            }
            (state, _) => state,
        }
    }

    pub fn is_staged(self) -> bool {
        matches!(self, Self::Staged | Self::Both | Self::Conflicted)
    }

    pub fn legacy_status(self) -> &'static str {
        match self {
            Self::Untracked => "untracked",
            Self::Staged => "staged",
            Self::Both | Self::Conflicted => "both",
            Self::NotApplicable | Self::Unstaged => "unstaged",
        }
    }
}

/// Porcelain-v2 unmerged `XY` state. Variant names preserve Git's canonical
/// seven conflict combinations while the wire values remain lowercase.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ConflictKind {
    Dd,
    Au,
    Ud,
    Ua,
    Du,
    Aa,
    Uu,
}

/// Git operation that may remain active while the user resolves conflicts.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum GitOperationKind {
    Merge,
    Rebase,
}

/// Strategy for bringing the configured target into the current feature
/// worktree. This is intentionally distinct from finish-branch Merge, which
/// mutates the target worktree instead.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum UpdateBranchStrategy {
    Rebase,
    Merge,
}

/// Typed result for an operation that can leave recoverable conflicts in the
/// current worktree. The tagged enum prevents completed results from carrying
/// conflict paths.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(tag = "outcome", rename_all = "snake_case")]
pub enum GitOperationResponse {
    Completed,
    Conflicts { conflict_files: Vec<String> },
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn contract_enums_use_stable_wire_values() {
        assert_eq!(
            serde_json::to_string(&FileStageState::NotApplicable).unwrap(),
            "\"not_applicable\""
        );
        assert_eq!(serde_json::to_string(&ConflictKind::Uu).unwrap(), "\"uu\"");
        assert_eq!(
            serde_json::to_string(&GitOperationKind::Rebase).unwrap(),
            "\"rebase\""
        );
        assert_eq!(
            serde_json::to_string(&UpdateBranchStrategy::Merge).unwrap(),
            "\"merge\""
        );
    }

    #[test]
    fn operation_response_shape_matches_each_outcome() {
        let completed = serde_json::to_value(GitOperationResponse::Completed).unwrap();
        assert_eq!(completed, serde_json::json!({ "outcome": "completed" }));

        let response = GitOperationResponse::Conflicts {
            conflict_files: vec!["src/lib.rs".into()],
        };
        let json = serde_json::to_string(&response).unwrap();
        let decoded: GitOperationResponse = serde_json::from_str(&json).unwrap();

        assert_eq!(decoded, response);
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&json).unwrap(),
            serde_json::json!({
                "outcome": "conflicts",
                "conflict_files": ["src/lib.rs"]
            })
        );
    }
}

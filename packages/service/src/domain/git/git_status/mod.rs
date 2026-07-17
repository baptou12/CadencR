//! Snapshot computation for the live Git status view.
//!
//! `compute_status` issues a small, fixed set of `git` calls and returns a
//! `GitStatusSnapshot` shaped for the frontend. The snapshot is provider-
//! neutral: provider-specific fields (`host`, `compare_url`, `action_label`)
//! come from `super::host` so this module never branches on host identity
//! itself.
//!
//! Pure parsing of `git status --porcelain=v2` lives in [`parsing`] so the
//! per-line decoder can be unit-tested without spawning git.

mod compute;
mod parsing;

pub use compute::compute_status_or_empty;

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use super::host::GitHost;
use super::models::GitOperationKind;

/// One-shot snapshot of the worktree's git state. Field semantics:
///
/// - `*_count` fields are derived from `git status --porcelain=v2`.
/// - `ahead_of_remote` is the count of commits reachable from `HEAD` that no
///   remote has yet — `branch.ab` ahead when an upstream is configured, or
///   `git rev-list --count --not --remotes HEAD` otherwise (which is exactly
///   what a first `git push -u origin HEAD` would publish).
/// - `behind_remote` comes from `branch.ab` and is `0` when no upstream is
///   configured (we can't be "behind" something that doesn't exist).
/// - `ahead_of_target` is `git rev-list --count {target}..HEAD` and
///   `behind_target` is `git rev-list --count HEAD..{target}`, using the
///   target ref **verbatim** as picked by the user — local `main` and
///   remote-tracking `origin/main` are different inputs and produce different
///   counts on purpose. Both are `0` if the ref doesn't resolve, while
///   `target_resolved` distinguishes that from genuine zero divergence.
/// - `host` / `compare_url` / `action_label` are populated only when a remote
///   exists. The frontend disables the open-PR button when `compare_url` is
///   `None`.
/// - `shared_with` lists OTHER features that point at the same worktree
///   directory (reuse-branch flow). Filled in by the caller via
///   `enrich_with_sharing` — `compute_status` itself leaves it empty.
/// - `computed_at` is unix milliseconds; the frontend store uses it to drop
///   incoming snapshots that are older than what's already cached, which
///   breaks the HTTP-vs-WebSocket race during worktree setup.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct GitStatusSnapshot {
    pub feature_id: i64,
    pub current_branch: String,
    pub target_branch: String,
    pub uncommitted_count: u32,
    pub staged_count: u32,
    pub unstaged_count: u32,
    pub untracked_count: u32,
    pub ahead_of_remote: u32,
    pub behind_remote: u32,
    pub ahead_of_target: u32,
    /// Commits reachable from the configured target but not from `HEAD`.
    #[serde(default, skip_serializing_if = "is_zero")]
    pub behind_target: u32,
    /// Whether the configured target resolved to a commit. This is distinct
    /// from a zero divergence count.
    #[serde(default, skip_serializing_if = "is_false")]
    pub target_resolved: bool,
    /// Number of unique unmerged paths in the current worktree.
    #[serde(default, skip_serializing_if = "is_zero")]
    pub conflict_count: u32,
    /// Merge or rebase state retained for conflict recovery.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub operation: Option<GitOperationKind>,
    pub has_remote: bool,
    pub host: Option<GitHost>,
    pub compare_url: Option<String>,
    pub action_label: Option<String>,
    #[serde(default)]
    pub shared_with: Vec<SharedFeatureRef>,
    pub computed_at: i64,
}

/// Lightweight pointer to another feature that shares the same worktree
/// directory. Surfaced in the header so the user knows their changes will
/// affect the donor feature's view too.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct SharedFeatureRef {
    pub feature_id: i64,
    pub title: String,
}

fn is_zero(value: &u32) -> bool {
    *value == 0
}

fn is_false(value: &bool) -> bool {
    !value
}

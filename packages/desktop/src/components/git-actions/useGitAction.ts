/**
 * Pure derivation: turn a `GitStatusSnapshot` into the smart-button state used
 * by `GitActionButton`. Kept pure (no React) so the snapshot matrix can be
 * tested directly with Vitest — `useGitAction` is a thin `useMemo` wrapper.
 *
 * Order of preference for the primary action: commit → update → push → pr → merge. Stash is
 * intentionally secondary-only, so adding tracked changes never replaces the
 * existing primary action. The first primary action that's enabled wins; if
 * none are, `primary` is `null` and the main button is disabled.
 */
import { useMemo } from "react";
import type { GitOperationKind, GitStatusSnapshot } from "@/api/generated";
import { gitUpdateContinueDisabledReason } from "./gitUpdateMessages";

export type GitAction = "commit" | "stash" | "update" | "push" | "pr" | "merge";
export type PrimaryGitAction = Exclude<GitAction, "stash">;
export type CommitActivity = "running" | "failed" | null;

export interface GitUpdateRecoveryActionState {
  operation: GitOperationKind;
  conflictCount: number;
  continueDisabled: string | null;
  abortDisabled: string | null;
}

export interface GitActionState {
  primary: PrimaryGitAction | null;
  /** Human label for the primary action button (or the disabled placeholder). */
  label: string;
  /** Per-action reason. `null` = enabled, `string` = disabled-because reason. */
  disabled: Record<GitAction, string | null>;
  /** Compare-URL label (provider-aware, falls back to "Open PR"). */
  compareLabel: string;
  /** Request state is local UI state; Git status still comes only from backend snapshots. */
  updatePending: boolean;
  /** Continue/Abort state for a backend-confirmed or just-returned recoverable update. */
  recovery: GitUpdateRecoveryActionState | null;
}

const PRIMARY_ORDER: readonly PrimaryGitAction[] = ["commit", "update", "push", "pr", "merge"];

const LOADING_STATE: GitActionState = {
  primary: null,
  label: "Loading…",
  disabled: {
    commit: "Loading…",
    stash: "Loading…",
    update: "Loading…",
    push: "Loading…",
    pr: "Loading…",
    merge: "Loading…",
  },
  compareLabel: "Open PR",
  updatePending: false,
  recovery: null,
};

function deriveCommitDisabled(snapshot: GitStatusSnapshot): string | null {
  return snapshot.uncommitted_count > 0 ? null : "No uncommitted changes";
}

function deriveStashDisabled(snapshot: GitStatusSnapshot): string | null {
  if ((snapshot.conflict_count ?? 0) > 0) return "Resolve conflicting files first";
  if (snapshot.uncommitted_count > 0) return null;
  return "No changes to stash";
}

function derivePushDisabled(snapshot: GitStatusSnapshot): string | null {
  if (snapshot.uncommitted_count > 0) return "Commit your changes first";
  if (snapshot.ahead_of_remote <= 0) return "Nothing to push";
  return null;
}

function derivePrDisabled(snapshot: GitStatusSnapshot): string | null {
  if (snapshot.uncommitted_count > 0) return "Commit your changes first";
  if (snapshot.ahead_of_remote > 0) return "Push your commits first";
  if (!snapshot.has_remote) return "No remote configured";
  if (snapshot.ahead_of_target <= 0) return "Nothing to compare";
  // Provider-neutral: the backend ships `compare_url` only when it can
  // confidently build one (GitHub / GitLab / Bitbucket). For self-hosted or
  // unrecognized remotes (`host = Other`) the field is absent and we treat
  // the action as unavailable here. The frontend never branches on host
  // identity itself — that boundary lives in `host.rs`.
  if (snapshot.compare_url == null) {
    return "Compare URL not available for this remote";
  }
  return null;
}

function deriveMergeDisabled(snapshot: GitStatusSnapshot): string | null {
  if (isSameLocalBranch(snapshot.current_branch, snapshot.target_branch)) {
    return "Cannot merge a branch into itself";
  }
  if (snapshot.ahead_of_target <= 0) return "Nothing to merge";
  return null;
}

function deriveUpdateDisabled(snapshot: GitStatusSnapshot): string | null {
  if (snapshot.target_resolved !== true) {
    return `Target '${snapshot.target_branch}' does not resolve`;
  }
  // Update uses the configured target identity verbatim. Unlike finish-branch
  // Merge, `origin/main` is intentionally distinct from a checked-out `main`.
  if (isSameUpdateBranch(snapshot.current_branch, snapshot.target_branch)) {
    return "Current branch is already the update target";
  }
  if (!isWorktreeClean(snapshot)) return "Commit or stash your changes first";
  if ((snapshot.behind_target ?? 0) <= 0) return "Already up to date";
  return null;
}

function isSameUpdateBranch(currentBranch: string, targetBranch: string): boolean {
  const currentRef = currentBranch.startsWith("refs/heads/")
    ? currentBranch
    : `refs/heads/${currentBranch}`;
  const targetRef = targetBranch.startsWith("refs/heads/")
    ? targetBranch
    : `refs/heads/${targetBranch}`;
  return currentRef === targetRef;
}

function isWorktreeClean(snapshot: GitStatusSnapshot): boolean {
  return (
    snapshot.uncommitted_count === 0 &&
    snapshot.staged_count === 0 &&
    snapshot.unstaged_count === 0 &&
    snapshot.untracked_count === 0 &&
    (snapshot.conflict_count ?? 0) === 0
  );
}

function isSameLocalBranch(currentBranch: string, targetBranch: string): boolean {
  return currentBranch === localTargetBranchName(targetBranch);
}

function localTargetBranchName(targetBranch: string): string {
  return targetBranch.startsWith("origin/") ? targetBranch.slice("origin/".length) : targetBranch;
}

export function deriveGitAction(
  snapshot: GitStatusSnapshot | undefined,
  updatePending = false,
  stashMutationBlockedReason: string | null = null,
): GitActionState {
  if (!snapshot) return LOADING_STATE;

  const operation = snapshot.operation ?? null;
  const operationConflictCount = snapshot.conflict_count ?? 0;
  const mutationBlockedReason = updatePending
    ? "Update request in progress"
    : operation
      ? `Finish or abort the active ${operation} update first`
      : null;

  // Degraded snapshot from the backend: `current_branch` is empty when the
  // worktree path doesn't resolve on disk (still being created, or stale
  // setting). Surface that explicitly so the button doesn't show a misleading
  // "No uncommitted changes" reason.
  if (!snapshot.current_branch) {
    const reason = "No worktree available yet";
    return {
      primary: null,
      label: reason,
      disabled: {
        commit: reason,
        stash: reason,
        update: reason,
        push: reason,
        pr: reason,
        merge: reason,
      },
      compareLabel: snapshot.action_label ?? "Open PR",
      updatePending,
      recovery: null,
    };
  }

  const compareLabel = snapshot.action_label ?? "Open PR";
  const disabled: Record<GitAction, string | null> = {
    commit: mutationBlockedReason ?? deriveCommitDisabled(snapshot),
    stash: mutationBlockedReason ?? stashMutationBlockedReason ?? deriveStashDisabled(snapshot),
    update: mutationBlockedReason ?? deriveUpdateDisabled(snapshot),
    push: mutationBlockedReason ?? derivePushDisabled(snapshot),
    // Opening an existing compare URL does not mutate Git, so keep it
    // available while an update request or recovery operation is active.
    pr: derivePrDisabled(snapshot),
    merge: mutationBlockedReason ?? deriveMergeDisabled(snapshot),
  };

  const primary = mutationBlockedReason
    ? null
    : (PRIMARY_ORDER.find((action) => disabled[action] === null) ?? null);
  const label = updatePending
    ? "Updating…"
    : primary === "commit"
      ? "Commit"
      : primary === "update"
        ? "Update"
        : primary === "push"
          ? "Push"
          : primary === "pr"
            ? compareLabel
            : primary === "merge"
              ? "Merge"
              : (disabled.commit ?? "No action");

  const recovery = operation
    ? {
        operation,
        conflictCount: operationConflictCount,
        continueDisabled: updatePending
          ? "Update request in progress"
          : gitUpdateContinueDisabledReason(operationConflictCount),
        abortDisabled: updatePending ? "Update request in progress" : null,
      }
    : null;

  return { primary, label, disabled, compareLabel, updatePending, recovery };
}

/**
 * Memoized wrapper around `deriveGitAction`. Re-runs only when the snapshot
 * reference changes (the store keeps snapshots stable until the backend pushes
 * a new one for the same feature).
 */
export function useGitAction(
  snapshot: GitStatusSnapshot | undefined,
  updatePending = false,
  stashMutationBlockedReason: string | null = null,
): GitActionState {
  return useMemo(
    () => deriveGitAction(snapshot, updatePending, stashMutationBlockedReason),
    [snapshot, stashMutationBlockedReason, updatePending],
  );
}

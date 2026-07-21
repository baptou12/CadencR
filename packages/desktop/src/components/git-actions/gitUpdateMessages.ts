import type { GitOperationKind } from "@/api/generated";

export function gitUpdateContinueDisabledReason(conflictCount: number): string | null {
  if (conflictCount <= 0) return null;
  const noun = conflictCount === 1 ? "file" : "files";
  return `Resolve and stage ${conflictCount} conflicting ${noun} first`;
}

/** Human noun for the paused operation — matches what Git itself calls it. */
export function gitOperationNoun(operation: GitOperationKind): string {
  return operation === "rebase" ? "rebase" : "merge";
}

/**
 * Operation-aware Continue/Abort label (e.g. "Continue merge", "Abort rebase").
 * Preferred over the internal "update" wording wherever the user is looking at a
 * concrete paused merge or rebase.
 */
export function gitUpdateActionLabel(
  action: "continue" | "abort",
  operation: GitOperationKind,
): string {
  const verb = action === "continue" ? "Continue" : "Abort";
  return `${verb} ${gitOperationNoun(operation)}`;
}

export function describeGitUpdateConflictFiles(files: string[]): string {
  if (files.length === 0) {
    return "Resolve the conflicts in Uncommitted, then continue or abort.";
  }
  const visible = files.slice(0, 3).join(", ");
  const overflow = files.length - 3;
  return overflow > 0 ? `${visible}, and ${overflow} more` : visible;
}

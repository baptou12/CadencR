export function gitUpdateContinueDisabledReason(conflictCount: number): string | null {
  if (conflictCount <= 0) return null;
  const noun = conflictCount === 1 ? "file" : "files";
  return `Resolve and stage ${conflictCount} conflicting ${noun} first`;
}

export function describeGitUpdateConflictFiles(files: string[]): string {
  if (files.length === 0) {
    return "Resolve the conflicts in Uncommitted, then continue or abort.";
  }
  const visible = files.slice(0, 3).join(", ");
  const overflow = files.length - 3;
  return overflow > 0 ? `${visible}, and ${overflow} more` : visible;
}

import type { GitOperationKind as GitOperationKindValue } from "@/api/generated";
import { GitOperationKind, type ConflictContentSnapshot } from "@/api/generated";

export interface ConflictSourceLabels {
  base: string;
  stage2: string;
  stage3: string;
  result: string;
}

/**
 * Operation-aware labels for the two conflict sides. The resolver never shows
 * generic Current/Incoming during a rebase — stage 2 is the rebased result and
 * stage 3 the replayed commit. Used for the inline per-hunk accept actions.
 */
export function conflictSourceLabels(
  operation: GitOperationKindValue | null | undefined,
): ConflictSourceLabels {
  if (operation === GitOperationKind.merge) {
    return { base: "Base", stage2: "Current branch", stage3: "Incoming branch", result: "Result" };
  }
  if (operation === GitOperationKind.rebase) {
    return { base: "Base", stage2: "Rebased result", stage3: "Replayed commit", result: "Result" };
  }
  return { base: "Base", stage2: "Index stage 2", stage3: "Index stage 3", result: "Result" };
}

/** Text bytes of a conflict source entry, or null when it is absent/binary/large. */
export function textFromConflictContent(
  entry:
    | ConflictContentSnapshot["base"]
    | ConflictContentSnapshot["stage_2"]
    | ConflictContentSnapshot["stage_3"]
    | ConflictContentSnapshot["result"],
): string | null {
  return entry?.content.state === "text" ? entry.content.content : null;
}

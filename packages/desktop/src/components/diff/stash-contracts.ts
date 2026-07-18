import type { StashEntry } from "@/api/generated";

export type StashMutationOperation = "apply" | "pop" | "drop";
export type ConflictableStashOperation = Extract<StashMutationOperation, "apply" | "pop">;

/** Recoverable stash conflict handed to the Git shell integration layer. */
export interface StashConflictOutcome {
  operation: ConflictableStashOperation;
  stash: StashEntry;
  conflictFiles: readonly string[];
}

export type StashConflictHandler = (outcome: StashConflictOutcome) => void;
export type StashConflictOpenHandler = (filePath: string) => void;

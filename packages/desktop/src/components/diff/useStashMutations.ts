import { useCallback, useMemo } from "react";
import { toast } from "sonner";
import {
  useApplyStash,
  useDropStash,
  usePopStash,
  type GitOperationResponse,
  type StashEntry,
  type StashMutationBody,
} from "@/api/generated";
import { apiErrorMessage, toastError } from "@/lib/api-errors";
import type {
  ConflictableStashOperation,
  StashConflictHandler,
  StashConflictOpenHandler,
  StashConflictOutcome,
  StashMutationOperation,
} from "./stash-contracts";
import type { StashMutationCoordinator, StashMutationLease } from "./useStashMutationCoordinator";

type StashMutationExecutor = (variables: {
  data: StashMutationBody;
}) => Promise<GitOperationResponse>;

interface UseStashMutationsOptions {
  featureId: number;
  stash: StashEntry;
  onConflicts?: StashConflictHandler;
  onOpenConflict?: StashConflictOpenHandler;
  onRefresh?: () => Promise<void>;
  coordinator: StashMutationCoordinator;
}

export interface StashMutationController {
  pendingOperation: StashMutationOperation | null;
  apply: () => Promise<boolean>;
  pop: () => Promise<boolean>;
  drop: () => Promise<boolean>;
}

const OPERATION_PAST_TENSE: Record<StashMutationOperation, string> = {
  apply: "Applied",
  pop: "Popped",
  drop: "Dropped",
};

function conflictOutcome(
  operation: ConflictableStashOperation,
  stash: StashEntry,
  conflictFiles: string[],
): StashConflictOutcome {
  return { operation, stash, conflictFiles };
}

function showConflictToast(
  outcome: StashConflictOutcome,
  onOpenConflict: StashConflictOpenHandler | undefined,
): void {
  const firstConflict = outcome.conflictFiles[0];
  const action =
    firstConflict && onOpenConflict
      ? { label: "Open first conflict", onClick: () => onOpenConflict(firstConflict) }
      : undefined;
  const retention =
    outcome.operation === "pop"
      ? `${outcome.stash.ref_name} was kept because the pop conflicted.`
      : `${outcome.stash.ref_name} remains available after the conflicted apply.`;
  const fileList = outcome.conflictFiles.join(", ");

  toast.warning(`Stash ${outcome.operation} has conflicts`, {
    description: fileList ? `${retention} Conflicts: ${fileList}` : retention,
    action,
    duration: 12_000,
  });
}

export function useStashMutations({
  featureId,
  stash,
  onConflicts,
  onOpenConflict,
  onRefresh,
  coordinator,
}: UseStashMutationsOptions): StashMutationController {
  const applyMutation = useApplyStash();
  const popMutation = usePopStash();
  const dropMutation = useDropStash();
  const selector = useMemo<StashMutationBody>(
    () => ({ feature_id: featureId, ref_name: stash.ref_name, expected_sha: stash.sha }),
    [featureId, stash.ref_name, stash.sha],
  );

  const refreshAfterMutation = useCallback(
    async (operation: StashMutationOperation): Promise<void> => {
      if (!onRefresh) return;
      try {
        await onRefresh();
      } catch (error) {
        toast.error(`${OPERATION_PAST_TENSE[operation]} stash, but could not refresh the list`, {
          description: apiErrorMessage(error, "The stash list may be stale."),
        });
      }
    },
    [onRefresh],
  );

  const execute = useCallback(
    async (operation: StashMutationOperation, mutate: StashMutationExecutor): Promise<boolean> => {
      const lease: StashMutationLease | null = coordinator.tryAcquire({
        kind: "row",
        operation,
        stashRefName: stash.ref_name,
      });
      if (!lease) return false;
      try {
        const result = await mutate({ data: selector });
        if (result.outcome === "conflicts") {
          if (operation === "drop") {
            toast.error("Drop stash returned an unexpected conflict outcome", {
              description: result.conflict_files.join(", "),
            });
            return false;
          }
          const outcome = conflictOutcome(operation, stash, result.conflict_files);
          onConflicts?.(outcome);
          showConflictToast(outcome, onOpenConflict);
        } else {
          toast.success(`${OPERATION_PAST_TENSE[operation]} ${stash.ref_name}`);
        }
        await refreshAfterMutation(operation);
        return true;
      } catch (error) {
        toastError(error, `Could not ${operation} ${stash.ref_name}.`);
        return false;
      } finally {
        coordinator.release(lease);
      }
    },
    [coordinator, onConflicts, onOpenConflict, refreshAfterMutation, selector, stash],
  );

  const apply = useCallback(
    (): Promise<boolean> => execute("apply", applyMutation.mutateAsync),
    [applyMutation.mutateAsync, execute],
  );
  const pop = useCallback(
    (): Promise<boolean> => execute("pop", popMutation.mutateAsync),
    [execute, popMutation.mutateAsync],
  );
  const drop = useCallback(
    (): Promise<boolean> => execute("drop", dropMutation.mutateAsync),
    [dropMutation.mutateAsync, execute],
  );

  const pendingOperation =
    coordinator.activeMutation?.kind === "row" &&
    coordinator.activeMutation.stashRefName === stash.ref_name
      ? coordinator.activeMutation.operation
      : null;

  return useMemo(
    () => ({ pendingOperation, apply, pop, drop }),
    [apply, drop, pendingOperation, pop],
  );
}

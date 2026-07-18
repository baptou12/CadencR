import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";

import {
  useAbortUpdateBranch,
  useContinueUpdateBranch,
  type GitOperationKind,
  type GitOperationResponse,
  type GitStatusSnapshot,
} from "@/api/generated";
import { apiErrorMessage } from "@/lib/api-errors";
import { useGitStatusStore } from "@/stores/useGitStatusStore";
import { recordGitUpdateConflictOutcome } from "./gitUpdateConflictOutcome";
import { markGitUpdateSettling } from "./gitUpdateRecoveryStore";
import { gitUpdateMutationKey, useGitUpdatePending } from "./useGitUpdatePending";

export type GitUpdateControlAction = "continue" | "abort";

interface UseGitUpdateRecoveryActionsOptions {
  featureId: number;
  operation: GitOperationKind | null;
  conflictCount: number;
  computedAt: number;
}

export interface GitUpdateRecoveryActions {
  pending: boolean;
  pendingAction: GitUpdateControlAction | null;
  error: string | null;
  continueUpdate: () => Promise<void>;
  abortUpdate: () => Promise<void>;
}

export function useGitUpdateRecoveryActions({
  featureId,
  operation,
  conflictCount,
  computedAt,
}: UseGitUpdateRecoveryActionsOptions): GitUpdateRecoveryActions {
  const mutation = { mutationKey: gitUpdateMutationKey(featureId) };
  const { mutateAsync: continueBranch, isPending: continuePending } = useContinueUpdateBranch({
    mutation,
  });
  const { mutateAsync: abortBranch, isPending: abortPending } = useAbortUpdateBranch({ mutation });
  const pending = useGitUpdatePending(featureId);
  const [error, setError] = useState<string | null>(null);

  const handleResponse = useCallback(
    (
      result: GitOperationResponse,
      action: GitUpdateControlAction,
      statusAtRequestStart: GitStatusSnapshot | undefined,
    ): void => {
      if (!operation) return;
      if (result.outcome === "conflicts") {
        recordGitUpdateConflictOutcome({
          featureId,
          operation,
          conflictFiles: result.conflict_files,
          computedAt,
          statusOperation: operation,
        });
        return;
      }
      if (!operationClearedSinceRequest(featureId, statusAtRequestStart)) {
        markGitUpdateSettling({ featureId, operation, computedAt });
      }
      toast.success(action === "abort" ? "Update aborted" : "Update completed");
    },
    [computedAt, featureId, operation],
  );

  const continueUpdate = useCallback(async (): Promise<void> => {
    if (!operation || pending || conflictCount > 0) return;
    setError(null);
    const statusAtRequestStart = useGitStatusStore.getState().byFeature[featureId];
    try {
      const result = await continueBranch({ data: { feature_id: featureId } });
      handleResponse(result, "continue", statusAtRequestStart);
    } catch (caught) {
      const message = apiErrorMessage(caught, "Could not continue the update.");
      setError(message);
      toast.error("Could not continue the update", { description: message });
    }
  }, [conflictCount, continueBranch, featureId, handleResponse, operation, pending]);

  const abortUpdate = useCallback(async (): Promise<void> => {
    if (!operation || pending) return;
    setError(null);
    const statusAtRequestStart = useGitStatusStore.getState().byFeature[featureId];
    try {
      const result = await abortBranch({ data: { feature_id: featureId } });
      handleResponse(result, "abort", statusAtRequestStart);
    } catch (caught) {
      const message = apiErrorMessage(caught, "Could not abort the update.");
      setError(message);
      toast.error("Could not abort the update", { description: message });
    }
  }, [abortBranch, featureId, handleResponse, operation, pending]);

  const pendingAction = continuePending ? "continue" : abortPending ? "abort" : null;

  return useMemo(
    () => ({ pending, pendingAction, error, continueUpdate, abortUpdate }),
    [abortUpdate, continueUpdate, error, pending, pendingAction],
  );
}

function operationClearedSinceRequest(
  featureId: number,
  statusAtRequestStart: GitStatusSnapshot | undefined,
): boolean {
  const latest = useGitStatusStore.getState().byFeature[featureId];
  return latest !== undefined && latest !== statusAtRequestStart && latest.operation == null;
}

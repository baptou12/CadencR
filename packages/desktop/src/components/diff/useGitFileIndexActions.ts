import { useCallback, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  FileStageState,
  useResetFile,
  useStageFile,
  type FileStageState as FileStageStateValue,
} from "@/api/generated";
import { apiErrorMessage } from "@/lib/api-errors";

export type GitFileIndexAction = "stage" | "reset";

export interface GitFileIndexError {
  action: GitFileIndexAction;
  filePath: string;
  message: string;
}

export interface GitFileIndexActions {
  stage: (filePath: string) => void;
  reset: (filePath: string) => void;
  isPending: boolean;
  pendingAction: GitFileIndexAction | null;
  pendingPath: string | null;
  error: GitFileIndexError | null;
}

export interface GitFileActionAvailability {
  canStage: boolean;
  canReset: boolean;
}

/** Whole-file mutation availability derived exclusively from typed stage state. */
export function getGitFileActionAvailability(
  stageState: FileStageStateValue,
): GitFileActionAvailability {
  return {
    canStage:
      stageState === FileStageState.untracked ||
      stageState === FileStageState.unstaged ||
      stageState === FileStageState.both ||
      stageState === FileStageState.conflicted,
    canReset: stageState === FileStageState.staged || stageState === FileStageState.both,
  };
}

/** Stage/reset mutations with exact paths, shared pending state, and visible failures. */
export function useGitFileIndexActions(featureId: number): GitFileIndexActions {
  const [error, setError] = useState<GitFileIndexError | null>(null);
  const [pending, setPending] = useState<{
    action: GitFileIndexAction;
    filePath: string;
  } | null>(null);
  const flightAcquiredRef = useRef(false);
  const releaseFlight = useCallback((): void => {
    flightAcquiredRef.current = false;
    setPending(null);
  }, []);
  const stageMutation = useStageFile({
    mutation: {
      onSuccess: (_response, variables) => {
        setError(null);
        toast.success(`Staged ${variables.data.file_path}`);
      },
      onError: (mutationError, variables) => {
        const message = apiErrorMessage(mutationError, "Git could not stage this path");
        setError({ action: "stage", filePath: variables.data.file_path, message });
        toast.error(`Could not stage ${variables.data.file_path}`, { description: message });
      },
      onSettled: releaseFlight,
    },
  });
  const resetMutation = useResetFile({
    mutation: {
      onSuccess: (_response, variables) => {
        setError(null);
        toast.success(`Unstaged ${variables.data.file_path}`, {
          description: "Worktree content was preserved.",
        });
      },
      onError: (mutationError, variables) => {
        const message = apiErrorMessage(mutationError, "Git could not unstage this path");
        setError({ action: "reset", filePath: variables.data.file_path, message });
        toast.error(`Could not unstage ${variables.data.file_path}`, { description: message });
      },
      onSettled: releaseFlight,
    },
  });
  const stageMutate = stageMutation.mutate;
  const resetMutate = resetMutation.mutate;
  const acquireFlight = useCallback((action: GitFileIndexAction, filePath: string): boolean => {
    if (flightAcquiredRef.current) return false;
    flightAcquiredRef.current = true;
    setError(null);
    setPending({ action, filePath });
    return true;
  }, []);

  const stage = useCallback(
    (filePath: string): void => {
      if (!acquireFlight("stage", filePath)) return;
      stageMutate({ data: { feature_id: featureId, file_path: filePath } });
    },
    [acquireFlight, featureId, stageMutate],
  );
  const reset = useCallback(
    (filePath: string): void => {
      if (!acquireFlight("reset", filePath)) return;
      resetMutate({ data: { feature_id: featureId, file_path: filePath } });
    },
    [acquireFlight, featureId, resetMutate],
  );

  const isPending = pending !== null;
  const pendingAction = pending?.action ?? null;
  const pendingPath = pending?.filePath ?? null;

  return useMemo(
    () => ({ stage, reset, isPending, pendingAction, pendingPath, error }),
    [error, isPending, pendingAction, pendingPath, reset, stage],
  );
}

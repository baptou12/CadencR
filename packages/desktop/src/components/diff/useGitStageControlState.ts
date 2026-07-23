import { useEffect, useMemo, useState } from "react";
import { FileStageState, type ChangedFile } from "@/api/generated";
import type { GitFileIndexAction, GitFileIndexActions } from "./useGitFileIndexActions";
import { resolvedStageState } from "./useGitDiffFileTreeModel";

interface PendingStageConfirmation {
  action: GitFileIndexAction;
  path: string;
}

export interface GitStageControlState {
  isBusy: boolean;
  pendingAction: GitFileIndexAction | null;
  pendingPath: string | null;
}

function isStageActionConfirmed(file: ChangedFile, action: GitFileIndexAction): boolean {
  const stageState = resolvedStageState(file);
  if (stageState === FileStageState.not_applicable) return false;
  return action === "stage"
    ? stageState === FileStageState.staged
    : stageState !== FileStageState.staged && stageState !== FileStageState.both;
}

export function useGitStageControlState(
  indexActions: GitFileIndexActions,
  fileByPath: ReadonlyMap<string, ChangedFile>,
  enabled: boolean,
): GitStageControlState {
  const [confirmation, setConfirmation] = useState<PendingStageConfirmation | null>(null);
  const errorPath = indexActions.error?.filePath;

  useEffect(() => {
    if (!enabled) {
      setConfirmation(null);
      return;
    }
    const pendingPath = indexActions.pendingPath;
    const pendingAction = indexActions.pendingAction;
    if (pendingPath && pendingAction) {
      setConfirmation((current) => {
        if (current?.path === pendingPath && current.action === pendingAction) {
          return current;
        }
        return { action: pendingAction, path: pendingPath };
      });
      return;
    }
    setConfirmation((current) => {
      if (!current) return current;
      const file = fileByPath.get(current.path);
      const confirmed =
        (current.action === "reset" && !file) ||
        (file != null && isStageActionConfirmed(file, current.action));
      return errorPath === current.path || confirmed ? null : current;
    });
  }, [enabled, errorPath, fileByPath, indexActions.pendingAction, indexActions.pendingPath]);

  const pendingAction = indexActions.pendingAction ?? confirmation?.action ?? null;
  const pendingPath = indexActions.pendingPath ?? confirmation?.path ?? null;
  const isBusy = indexActions.isPending || confirmation != null;
  return useMemo(
    () => ({ isBusy, pendingAction, pendingPath }),
    [isBusy, pendingAction, pendingPath],
  );
}

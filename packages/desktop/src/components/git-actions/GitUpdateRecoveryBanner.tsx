import {
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
} from "react";
import { AlertTriangle, CheckCircle2, Loader2, Play, Undo2 } from "lucide-react";
import { useShallow } from "zustand/react/shallow";

import { FileStageState, useGetChangedFiles, type GitOperationKind } from "@/api/generated";
import { Button } from "@/components/ui/button";
import { apiErrorMessage } from "@/lib/api-errors";
import { capitalize } from "@/lib/utils";
import { useGitStatusStore } from "@/stores/useGitStatusStore";
import {
  gitOperationNoun,
  gitUpdateActionLabel,
  gitUpdateContinueDisabledReason,
} from "./gitUpdateMessages";
import { useGitUpdateRecoveryActions } from "./useGitUpdateRecoveryActions";

const MAX_CONFLICT_FILES = 8;

interface GitUpdateRecoveryRegionProps {
  featureId: number;
  onRequestUncommitted: () => void;
}

export const GitUpdateRecoveryRegion = memo(function GitUpdateRecoveryRegion({
  featureId,
  onRequestUncommitted,
}: GitUpdateRecoveryRegionProps): ReactElement | null {
  const status = useGitStatusStore(
    useShallow((state) => {
      const snapshot = state.byFeature[featureId];
      return {
        operation: snapshot?.operation ?? null,
        conflictCount: snapshot?.conflict_count ?? 0,
      };
    }),
  );
  const changedFiles = useGetChangedFiles(
    { feature_id: featureId, mode: "worktree" },
    {
      query: {
        enabled: status.operation !== null,
        refetchOnMount: false,
        refetchOnWindowFocus: false,
      },
    },
  );
  const conflictFiles = useMemo(
    () =>
      (changedFiles.data ?? [])
        .filter((file) => file.stage_state === FileStageState.conflicted)
        .map((file) => file.file),
    [changedFiles.data],
  );
  const conflictBatch = useConfirmedConflictBatch(
    status.operation,
    status.conflictCount,
    onRequestUncommitted,
  );

  if (!status.operation) return null;
  return (
    <GitUpdateRecoveryBanner
      featureId={featureId}
      operation={status.operation}
      conflictCount={status.conflictCount}
      conflictFiles={conflictFiles}
      conflictBatch={conflictBatch}
      filesLoading={changedFiles.isLoading}
      filesError={changedFiles.isError ? changedFiles.error : null}
    />
  );
});

function useConfirmedConflictBatch(
  operation: GitOperationKind | null,
  conflictCount: number,
  onRequestUncommitted: () => void,
): number {
  const tracking = useRef({ operation: null as GitOperationKind | null, hadConflicts: false });
  const [batch, setBatch] = useState(0);
  useEffect(() => {
    if (!operation) {
      tracking.current = { operation: null, hadConflicts: false };
      setBatch(0);
      return;
    }
    if (tracking.current.operation !== operation) {
      tracking.current = { operation, hadConflicts: false };
      setBatch(0);
    }
    if (conflictCount === 0) {
      tracking.current.hadConflicts = false;
      return;
    }
    if (tracking.current.hadConflicts) return;
    tracking.current.hadConflicts = true;
    setBatch((current) => current + 1);
    onRequestUncommitted();
  }, [conflictCount, onRequestUncommitted, operation]);
  return batch;
}

interface GitUpdateRecoveryBannerProps {
  featureId: number;
  operation: GitOperationKind;
  conflictCount: number;
  conflictFiles: string[];
  conflictBatch: number;
  filesLoading: boolean;
  filesError: unknown;
}

export const GitUpdateRecoveryBanner = memo(function GitUpdateRecoveryBanner({
  featureId,
  operation,
  conflictCount,
  conflictFiles,
  conflictBatch,
  filesLoading,
  filesError,
}: GitUpdateRecoveryBannerProps): ReactElement {
  const actions = useGitUpdateRecoveryActions({ featureId, operation, conflictCount });
  const noun = gitOperationNoun(operation);
  const operationLabel = capitalize(noun);
  const continueReason = gitUpdateContinueDisabledReason(conflictCount);
  const resolved = continueReason === null;
  const accent = resolved ? "var(--acc-green)" : "var(--acc-orange)";

  return (
    <section
      aria-label="Git update recovery"
      style={{ "--recovery-accent": accent } as CSSProperties}
      className="shrink-0 border-b border-[color-mix(in_oklab,var(--recovery-accent)_35%,transparent)] bg-[color-mix(in_oklab,var(--recovery-accent)_8%,var(--card))] px-4 py-3"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-sm font-medium text-[var(--recovery-accent)]">
            {resolved ? (
              <CheckCircle2 className="size-4 shrink-0" aria-hidden />
            ) : (
              <AlertTriangle className="size-4 shrink-0" aria-hidden />
            )}
            {resolved
              ? `${operationLabel} ready to continue`
              : `${operationLabel} paused on conflicts`}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {continueReason ??
              `All conflicts staged. Continue to finish the ${noun}, or abort to undo it.`}
          </p>
          <ConflictBatch
            files={conflictFiles}
            batch={conflictBatch}
            resolved={resolved}
            loading={filesLoading}
            error={filesError}
          />
          {actions.error && (
            <p role="alert" className="mt-2 whitespace-pre-wrap text-xs text-destructive">
              {actions.error}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => void actions.abortUpdate()}
            disabled={actions.pending}
          >
            {actions.pendingAction === "abort" ? (
              <Loader2 className="mr-2 size-3.5 animate-spin" />
            ) : (
              <Undo2 className="mr-2 size-3.5" />
            )}
            {gitUpdateActionLabel("abort", operation)}
          </Button>
          <Button
            size="sm"
            onClick={() => void actions.continueUpdate()}
            disabled={actions.pending || continueReason !== null}
            title={continueReason ?? `Continue ${noun}`}
          >
            {actions.pendingAction === "continue" ? (
              <Loader2 className="mr-2 size-3.5 animate-spin" />
            ) : (
              <Play className="mr-2 size-3.5" />
            )}
            {gitUpdateActionLabel("continue", operation)}
          </Button>
        </div>
      </div>
    </section>
  );
});

function ConflictBatch({
  files,
  batch,
  resolved,
  loading,
  error,
}: {
  files: string[];
  batch: number;
  resolved: boolean;
  loading: boolean;
  error: unknown;
}): ReactElement | null {
  if (error) {
    return (
      <p role="alert" className="mt-2 text-xs text-destructive">
        Could not load conflicting files: {apiErrorMessage(error, "Git status is unavailable")}
      </p>
    );
  }
  if (loading && files.length === 0) {
    return (
      <p role="status" className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
        <Loader2 className="size-3 animate-spin" aria-hidden />
        Loading conflicting files…
      </p>
    );
  }
  if (files.length === 0) return null;
  const visible = files.slice(0, MAX_CONFLICT_FILES);
  const overflow = files.length - visible.length;
  return (
    <div className="mt-2 text-xs">
      <p className="text-muted-foreground">
        {resolved ? "Last conflict batch" : `Conflict batch ${Math.max(batch, 1)}`}
      </p>
      <ul className="mt-1 space-y-0.5 font-mono text-foreground/90">
        {visible.map((file) => (
          <li key={file} className="truncate" title={file}>
            {file}
          </li>
        ))}
      </ul>
      {overflow > 0 && <p className="mt-1 text-muted-foreground">+ {overflow} more</p>}
    </div>
  );
}

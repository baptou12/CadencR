import { memo, useEffect, type CSSProperties, type ReactElement } from "react";
import { AlertTriangle, CheckCircle2, Loader2, Play, Undo2 } from "lucide-react";
import { useShallow } from "zustand/react/shallow";

import type { GitOperationKind } from "@/api/generated";
import { Button } from "@/components/ui/button";
import { useGitStatusStore } from "@/stores/useGitStatusStore";
import {
  effectiveGitUpdateConflictCount,
  useGitUpdateRecoveryStore,
  useSyncGitUpdateRecovery,
} from "./gitUpdateRecoveryStore";
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
        computedAt: snapshot?.computed_at ?? 0,
      };
    }),
  );
  const recovery = useGitUpdateRecoveryStore((state) => state.byFeature[featureId]);
  useSyncGitUpdateRecovery(featureId, status.operation, status.computedAt);

  useEffect(() => {
    if (!recovery?.needsUncommittedView) return;
    useGitUpdateRecoveryStore.getState().markUncommittedViewHandled(featureId);
    onRequestUncommitted();
  }, [featureId, onRequestUncommitted, recovery?.conflictBatch, recovery?.needsUncommittedView]);

  const operation = status.operation ?? recovery?.operation ?? null;
  if (!operation) return null;
  const conflictCount = effectiveGitUpdateConflictCount(
    status.operation,
    status.conflictCount,
    status.computedAt,
    recovery,
  );

  return (
    <GitUpdateRecoveryBanner
      featureId={featureId}
      operation={operation}
      conflictCount={conflictCount}
      conflictFiles={recovery?.conflictFiles ?? []}
      conflictBatch={recovery?.conflictBatch ?? 0}
      computedAt={status.computedAt}
    />
  );
});

interface GitUpdateRecoveryBannerProps {
  featureId: number;
  operation: GitOperationKind;
  conflictCount: number;
  conflictFiles: string[];
  conflictBatch: number;
  computedAt: number;
}

export const GitUpdateRecoveryBanner = memo(function GitUpdateRecoveryBanner({
  featureId,
  operation,
  conflictCount,
  conflictFiles,
  conflictBatch,
  computedAt,
}: GitUpdateRecoveryBannerProps): ReactElement {
  const actions = useGitUpdateRecoveryActions({
    featureId,
    operation,
    conflictCount,
    computedAt,
  });
  const operationLabel = operation === "rebase" ? "Rebase" : "Merge";
  const noun = gitOperationNoun(operation);
  const continueReason = gitUpdateContinueDisabledReason(conflictCount);
  // Once every conflict is staged the operation is queued to finish: swap the
  // warm "paused" identity for the ready/green one so the flip to an enabled
  // Continue reads as clear forward momentum, not a lingering warning.
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
          {conflictFiles.length > 0 && (
            <ConflictBatch files={conflictFiles} batch={conflictBatch} resolved={resolved} />
          )}
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
}: {
  files: string[];
  batch: number;
  resolved: boolean;
}): ReactElement {
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

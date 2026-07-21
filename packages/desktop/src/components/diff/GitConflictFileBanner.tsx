import { memo, type ReactElement } from "react";
import { TriangleAlertIcon } from "lucide-react";
import {
  ConflictKind,
  FileStageState,
  type ChangedFile,
  type ConflictKind as ConflictKindValue,
} from "@/api/generated";
import { Button } from "@/components/ui/button";
import { conflictKindLabel, resolvedStageState } from "./useGitDiffFileTreeModel";
import type { GitFileIndexActions } from "./useGitFileIndexActions";

interface GitConflictFileBannerProps {
  file: ChangedFile;
  indexActions?: GitFileIndexActions;
}

export const GitConflictFileBanner = memo(function GitConflictFileBanner({
  file,
  indexActions,
}: GitConflictFileBannerProps): ReactElement | null {
  if (resolvedStageState(file) !== FileStageState.conflicted) return null;

  const stagePending =
    indexActions?.pendingPath === file.file && indexActions.pendingAction === "stage";
  const error = indexActions?.error?.filePath === file.file ? indexActions.error.message : null;
  const stageDeletion = file.conflict_kind === ConflictKind.dd;

  return (
    <section
      aria-label={`Conflict in ${file.file}`}
      className="border-t border-border border-l-2 border-l-[var(--acc-orange)] bg-[color-mix(in_srgb,var(--acc-orange)_6%,var(--background))] px-4 py-2"
    >
      <div className="flex flex-wrap items-start gap-2">
        <TriangleAlertIcon
          className="mt-0.5 size-3.5 shrink-0 text-[var(--acc-orange)]"
          aria-hidden
        />
        <div className="min-w-48 flex-1 text-xs">
          <p className="font-medium text-foreground">
            {conflictKindLabel(file.conflict_kind)} conflict
          </p>
          <p className="mt-0.5 text-muted-foreground">{conflictMessage(file.conflict_kind)}</p>
        </div>
        {indexActions && (
          <Button
            type="button"
            size="sm"
            disabled={indexActions.isPending}
            aria-busy={stagePending}
            onClick={() => indexActions.stage(file.file)}
          >
            {stagePending ? "Staging…" : stageDeletion ? "Stage deletion" : "Stage"}
          </Button>
        )}
      </div>
      {error && (
        <p className="mt-1 text-xs text-destructive" role="alert">
          Stage failed: {error}
        </p>
      )}
    </section>
  );
});

function conflictMessage(kind: ConflictKindValue | null | undefined): string {
  switch (kind) {
    case ConflictKind.dd:
      return "Both sides deleted this path. Stage the deletion to mark it resolved.";
    case ConflictKind.au:
      return "The current side added this file. Open it to confirm the result, then stage it.";
    case ConflictKind.ud:
      return "The incoming side deleted a file modified on the current side. Open it to keep or remove the result, then stage it.";
    case ConflictKind.ua:
      return "The incoming side added this file. Open it to confirm the result, then stage it.";
    case ConflictKind.du:
      return "The current side deleted a file modified on the incoming side. Open it to keep or remove the result, then stage it.";
    case ConflictKind.aa:
      return "Both sides added this file with different content. Open it to resolve the result, then stage it.";
    case ConflictKind.uu:
      return "Both sides modified this file. Open it to inspect and resolve the result, then stage it.";
    default:
      return "Open this file to resolve the conflict, then stage it.";
  }
}

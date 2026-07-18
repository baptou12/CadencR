import { lazy, Suspense, type ReactElement } from "react";
import { Loader2 } from "lucide-react";

import type { GitStatusSnapshot } from "@/api/generated";
import type { GitAction } from "./useGitAction";
import type { CommitSubmissionController } from "./useCommitSubmission";

const CommitDialog = lazy(() => import("./CommitDialog"));
const PushDialog = lazy(() => import("./PushDialog"));
const MergeDialog = lazy(() => import("./MergeDialog"));
const UpdateBranchDialog = lazy(() => import("./UpdateBranchDialog"));

export type GitActionDialog = Exclude<GitAction, "pr"> | null;

interface GitActionDialogsProps {
  activeDialog: GitActionDialog;
  featureId: number;
  snapshot: GitStatusSnapshot | undefined;
  updateDisabledReason: string | null;
  commitSubmission: CommitSubmissionController;
  onOpenChange: (open: boolean) => void;
}

/**
 * Controlled sibling-dialog outlet. The Phase 2B checkpoint can add
 * `StashChangesDialog` here without nesting it inside UpdateBranchDialog.
 */
export function GitActionDialogs({
  activeDialog,
  featureId,
  snapshot,
  updateDisabledReason,
  commitSubmission,
  onOpenChange,
}: GitActionDialogsProps): ReactElement {
  return (
    <Suspense fallback={<GitActionDialogLoading />}>
      {activeDialog === "commit" && (
        <CommitDialog featureId={featureId} open submission={commitSubmission} />
      )}
      {activeDialog === "push" && (
        <PushDialog featureId={featureId} open onOpenChange={onOpenChange} />
      )}
      {activeDialog === "merge" && (
        <MergeDialog featureId={featureId} open onOpenChange={onOpenChange} />
      )}
      {activeDialog === "update" && snapshot && (
        <UpdateBranchDialog
          featureId={featureId}
          open
          snapshot={snapshot}
          disabledReason={updateDisabledReason}
          onOpenChange={onOpenChange}
        />
      )}
    </Suspense>
  );
}

function GitActionDialogLoading(): ReactElement {
  return (
    <div
      role="status"
      className="fixed left-1/2 top-1/2 z-50 flex -translate-x-1/2 -translate-y-1/2 items-center gap-2 rounded-md border border-border bg-background px-4 py-3 text-sm shadow-lg"
    >
      <Loader2 className="size-4 animate-spin" />
      Loading Git action…
    </div>
  );
}

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  AlertCircleIcon,
  CheckCircle2Icon,
  Loader2Icon,
  GitMergeIcon,
  Trash2Icon,
  FolderIcon,
  ArchiveIcon,
} from "lucide-react";
import {
  useCheckMergeConflicts,
  useHasUncommittedChanges,
  useMergeFeatureBranch,
  useDeleteFeatureBranch,
  useDeleteWorktree,
  useUpdateFeatureStatus,
  getListFeaturesQueryKey,
  getGetFeatureQueryKey,
} from "@/api/generated";
import { useQueryClient } from "@tanstack/react-query";

interface MergeArchiveDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: number;
  featureId: number;
}

export function MergeArchiveDialog({
  open,
  onOpenChange,
  projectId,
  featureId,
}: MergeArchiveDialogProps) {
  const queryClient = useQueryClient();

  // Post-merge state
  const [merged, setMerged] = useState(false);
  const [branchDeleted, setBranchDeleted] = useState(false);
  const [worktreeDeleted, setWorktreeDeleted] = useState(false);
  const [archived, setArchived] = useState(false);
  const [mergeError, setMergeError] = useState<string | null>(null);
  const [branchError, setBranchError] = useState<string | null>(null);
  const [worktreeError, setWorktreeError] = useState<string | null>(null);

  // Reset internal state when dialog closes
  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      setMerged(false);
      setBranchDeleted(false);
      setWorktreeDeleted(false);
      setArchived(false);
      setMergeError(null);
      setBranchError(null);
      setWorktreeError(null);
    }
    onOpenChange(nextOpen);
  };

  // Conflict check query
  const conflictsQuery = useCheckMergeConflicts(
    { project_id: projectId, feature_id: featureId },
    { query: { enabled: open, retry: false } },
  );

  // Uncommitted changes check
  const uncommittedQuery = useHasUncommittedChanges(
    { project_id: projectId, feature_id: featureId },
    { query: { enabled: open, retry: false } },
  );

  // Mutations
  const mergeMutation = useMergeFeatureBranch({
    mutation: {
      onSuccess: (result) => {
        if (result.success) {
          setMerged(true);
          setMergeError(null);
        } else {
          setMergeError(result.error ?? "Merge failed");
        }
      },
      onError: (err: Error) => {
        setMergeError(err.message);
      },
    },
  });

  const deleteBranchMutation = useDeleteFeatureBranch({
    mutation: {
      onSuccess: (result) => {
        if (result.success) {
          setBranchDeleted(true);
          setBranchError(null);
        } else {
          setBranchError("Failed to delete branch");
        }
      },
      onError: (err: Error) => {
        setBranchError(err.message);
      },
    },
  });

  const deleteWorktreeMutation = useDeleteWorktree({
    mutation: {
      onSuccess: (result) => {
        if (result.success) {
          setWorktreeDeleted(true);
          setWorktreeError(null);
          void uncommittedQuery.refetch();
        } else {
          setWorktreeError("Failed to delete worktree");
        }
      },
      onError: (err: Error) => {
        setWorktreeError(err.message);
      },
    },
  });

  const archiveMutation = useUpdateFeatureStatus({
    mutation: {
      onSuccess: (_data, variables) => {
        setArchived(true);
        void queryClient.invalidateQueries({
          queryKey: getListFeaturesQueryKey({ project_id: projectId }),
        });
        void queryClient.invalidateQueries({ queryKey: getGetFeatureQueryKey(variables.id) });
      },
    },
  });

  const conflicts = conflictsQuery.data;
  const hasConflicts = conflicts?.has_conflicts ?? false;
  const conflictFiles = conflicts?.conflict_files ?? [];
  const hasUncommitted = uncommittedQuery.data?.has_changes ?? false;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GitMergeIcon className="size-5" />
            Merge &amp; Archive
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Conflict Check */}
          <div className="rounded-md border p-3">
            <h3 className="text-sm font-semibold mb-2">Conflict Check</h3>
            {conflictsQuery.isLoading && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2Icon className="size-4 animate-spin" />
                Checking for merge conflicts…
              </div>
            )}
            {conflictsQuery.isError && (
              <div className="flex items-center gap-2 text-sm text-destructive">
                <AlertCircleIcon className="size-4" />
                {conflictsQuery.error.message}
              </div>
            )}
            {conflictsQuery.isSuccess && !hasConflicts && (
              <div className="flex items-center gap-2 text-sm text-green-600">
                <CheckCircle2Icon className="size-4" />
                No conflicts detected
              </div>
            )}
            {conflictsQuery.isSuccess && hasConflicts && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm text-destructive">
                  <AlertCircleIcon className="size-4" />
                  Conflicts detected — resolve before merging
                </div>
                {conflictFiles.length > 0 && (
                  <ul className="text-xs text-muted-foreground space-y-0.5 ml-6 list-disc">
                    {conflictFiles.map((f) => (
                      <li key={f}>{f}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>

          {/* Merge */}
          {!merged && (
            <div className="space-y-2">
              {mergeError && <p className="text-sm text-destructive">{mergeError}</p>}
              <Button
                onClick={() =>
                  mergeMutation.mutate({
                    data: { project_id: projectId, feature_id: featureId, mode: "no_ff" },
                  })
                }
                disabled={
                  hasConflicts ||
                  conflictsQuery.isLoading ||
                  conflictsQuery.isError ||
                  mergeMutation.isLoading
                }
                className="w-full"
              >
                {mergeMutation.isLoading ? (
                  <Loader2Icon className="mr-2 size-4 animate-spin" />
                ) : (
                  <GitMergeIcon className="mr-2 size-4" />
                )}
                Merge Branch (--no-ff)
              </Button>
            </div>
          )}

          {merged && (
            <div className="flex items-center gap-2 text-sm text-green-600">
              <CheckCircle2Icon className="size-4" />
              Branch merged successfully
            </div>
          )}

          {/* Post-merge actions */}
          {merged && (
            <div className="rounded-md border p-3 space-y-3">
              <h3 className="text-sm font-semibold">Post-Merge Actions</h3>

              {/* Delete Branch */}
              <div className="space-y-1">
                {branchError && <p className="text-xs text-destructive">{branchError}</p>}
                {branchDeleted ? (
                  <div className="flex items-center gap-2 text-sm text-green-600">
                    <CheckCircle2Icon className="size-4" />
                    Branch deleted
                  </div>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      deleteBranchMutation.mutate({
                        params: { project_id: projectId, feature_id: featureId },
                      })
                    }
                    disabled={deleteBranchMutation.isLoading}
                    className="w-full"
                  >
                    {deleteBranchMutation.isLoading ? (
                      <Loader2Icon className="mr-2 size-4 animate-spin" />
                    ) : (
                      <Trash2Icon className="mr-2 size-4" />
                    )}
                    Delete Branch
                  </Button>
                )}
              </div>

              {/* Delete Worktree */}
              <div className="space-y-1">
                {worktreeError && <p className="text-xs text-destructive">{worktreeError}</p>}
                {worktreeDeleted ? (
                  <div className="flex items-center gap-2 text-sm text-green-600">
                    <CheckCircle2Icon className="size-4" />
                    Worktree deleted
                  </div>
                ) : (
                  <div title={hasUncommitted ? "Worktree has uncommitted changes" : undefined}>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        deleteWorktreeMutation.mutate({
                          params: { project_id: projectId, feature_id: featureId },
                        })
                      }
                      disabled={hasUncommitted || deleteWorktreeMutation.isLoading}
                      className="w-full"
                    >
                      {deleteWorktreeMutation.isLoading ? (
                        <Loader2Icon className="mr-2 size-4 animate-spin" />
                      ) : (
                        <FolderIcon className="mr-2 size-4" />
                      )}
                      Delete Worktree
                      {hasUncommitted && (
                        <span className="ml-1 text-xs text-muted-foreground">
                          (uncommitted changes)
                        </span>
                      )}
                    </Button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Archive — always visible */}
          <div className="rounded-md border p-3">
            <h3 className="text-sm font-semibold mb-2">Archive Feature</h3>
            <p className="text-xs text-muted-foreground mb-2">
              Archived features are hidden by default in the sidebar.
            </p>
            {archived ? (
              <div className="flex items-center gap-2 text-sm text-green-600">
                <CheckCircle2Icon className="size-4" />
                Feature archived ✓
              </div>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  archiveMutation.mutate({ id: featureId, data: { status: "archived" } })
                }
                disabled={archiveMutation.isLoading}
                className="w-full"
              >
                {archiveMutation.isLoading ? (
                  <Loader2Icon className="mr-2 size-4 animate-spin" />
                ) : (
                  <ArchiveIcon className="mr-2 size-4" />
                )}
                Archive Feature
              </Button>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

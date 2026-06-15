import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { toast } from "sonner";
import {
  useDeleteFeatureBranch,
  useDeleteWorktree,
  useKillTerminalSessions,
  type Feature,
} from "@/api/generated";
import { apiErrorMessage } from "@/lib/api-errors";
import { Button } from "@/components/ui/button";
import { KbdShortcut } from "@/components/KbdShortcut";
import { ArchiveCleanupOptions } from "@/components/ArchiveCleanupOptions";
import { KillTerminalsOption } from "@/components/KillTerminalsOption";
import { useKillTerminalsState } from "@/components/use-kill-terminals-state";
import { useArchiveCleanupState } from "@/components/archive-cleanup-state";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useDialogSubmitShortcut } from "@/components/git-actions/useDialogSubmitShortcut";

const SUBMIT_KEYS: string[] = ["cmd", "enter"];

interface ArchiveFeatureDialogProps {
  open: boolean;
  feature: Feature | undefined;
  projectId: number;
  hasLiveWorktree: boolean;
  showWorktreeRemoval: boolean;
  showBranchRemoval: boolean;
  onOpenChange: (open: boolean) => void;
  onArchive: (featureId: number) => void;
}

export function ArchiveFeatureDialog({
  open,
  feature,
  projectId,
  hasLiveWorktree,
  showWorktreeRemoval,
  showBranchRemoval,
  onOpenChange,
  onArchive,
}: ArchiveFeatureDialogProps): ReactElement {
  const { isConfirming, lockConfirm } = useConfirmSubmissionLock(open);
  const deleteWorktree = useDeleteWorktree();
  const deleteBranch = useDeleteFeatureBranch();
  const killTerminals = useKillTerminalSessions();
  const killState = useKillTerminalsState(open, feature);
  const cleanupState = useArchiveCleanupState({
    open,
    feature,
    projectId,
    hasLiveWorktree,
    showWorktreeRemoval,
    showBranchRemoval,
  });

  const confirm = (): void => {
    if (!feature) return;
    if (!lockConfirm()) return;
    const featureId = feature.id;
    onArchive(featureId);
    onOpenChange(false);
    const needsGitCleanup = cleanupState.removeWorktree || cleanupState.removeBranch;
    if (!killState.killTerminals && !needsGitCleanup) return;
    const cleanup = (async (): Promise<void> => {
      // Kill shells before removing the worktree they may be running in.
      if (killState.killTerminals) {
        await killTerminals.mutateAsync({ params: { feature_id: featureId } });
      }
      if (needsGitCleanup) {
        await cleanupFeature({
          projectId,
          featureId,
          removeWorktree: cleanupState.removeWorktree,
          removeBranch: cleanupState.removeBranch,
          hasLiveWorktree,
          forceBranchDelete: cleanupState.forceBranchDelete,
          forceWorktreeDelete: cleanupState.forceWorktreeDelete,
          deleteWorktree: deleteWorktree.mutateAsync,
          deleteBranch: deleteBranch.mutateAsync,
        });
      }
    })();
    toast.promise(cleanup, {
      loading: "Archiving session; cleaning up…",
      success: "Session archived and cleanup finished.",
      error: (err) => apiErrorMessage(err, "Session archived, but cleanup failed"),
    });
  };
  useDialogSubmitShortcut({
    open,
    enabled: !cleanupState.isCheckingBranch && !cleanupState.isCheckingWorktree && !isConfirming,
    onSubmit: confirm,
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="sm:max-w-md"
        onKeyDown={(event) => {
          if (event.key.toLowerCase() === "w") {
            event.preventDefault();
            cleanupState.toggleWorktree();
          } else if (event.key.toLowerCase() === "b") {
            event.preventDefault();
            cleanupState.toggleBranch();
          } else if (event.key.toLowerCase() === "t") {
            event.preventDefault();
            killState.toggleKillTerminals();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>Archive session?</DialogTitle>
          <DialogDescription>
            Archive now, optionally cleaning up the related Git worktree or branch in the
            background.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {killState.liveTerminalCount > 0 && (
            <KillTerminalsOption
              count={killState.liveTerminalCount}
              checked={killState.killTerminals}
              onToggle={killState.toggleKillTerminals}
            />
          )}
          <ArchiveCleanupOptions {...cleanupState} hasLiveWorktree={hasLiveWorktree} />
        </div>

        <ArchiveDialogFooter
          forceDelete={cleanupState.forceBranchDelete || cleanupState.forceWorktreeDelete}
          disabled={
            cleanupState.isCheckingBranch || cleanupState.isCheckingWorktree || isConfirming
          }
          onCancel={() => onOpenChange(false)}
          onConfirm={confirm}
        />
      </DialogContent>
    </Dialog>
  );
}
interface ArchiveDialogFooterProps {
  disabled: boolean;
  forceDelete: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

function ArchiveDialogFooter(props: ArchiveDialogFooterProps): ReactElement {
  return (
    <DialogFooter>
      <Button variant="outline" onClick={props.onCancel}>
        Cancel
      </Button>
      <Button
        variant={props.forceDelete ? "destructive" : "default"}
        disabled={props.disabled}
        onClick={props.onConfirm}
      >
        <span>{props.forceDelete ? "Archive & force delete" : "Archive"}</span>
        <KbdShortcut keys={SUBMIT_KEYS} variant="hint" />
      </Button>
    </DialogFooter>
  );
}

async function cleanupFeature(args: {
  projectId: number;
  featureId: number;
  removeWorktree: boolean;
  removeBranch: boolean;
  hasLiveWorktree: boolean;
  forceBranchDelete: boolean;
  forceWorktreeDelete: boolean;
  deleteWorktree: ReturnType<typeof useDeleteWorktree>["mutateAsync"];
  deleteBranch: ReturnType<typeof useDeleteFeatureBranch>["mutateAsync"];
}): Promise<void> {
  if (args.removeWorktree && args.hasLiveWorktree) {
    const result = await args.deleteWorktree({
      params: {
        project_id: args.projectId,
        feature_id: args.featureId,
        force: args.forceWorktreeDelete,
      },
    });
    if (!result.success) throw new Error(result.error ?? "Failed to remove worktree");
  }
  if (args.removeBranch) {
    const result = await args.deleteBranch({
      params: {
        project_id: args.projectId,
        feature_id: args.featureId,
        force: args.forceBranchDelete,
      },
    });
    if (!result.success) throw new Error(result.error ?? "Failed to delete branch");
  }
}

function useConfirmSubmissionLock(open: boolean): {
  isConfirming: boolean;
  lockConfirm: () => boolean;
} {
  const [isConfirming, setIsConfirming] = useState(false);
  const isConfirmingRef = useRef(false);

  useEffect(() => {
    if (open) return;
    isConfirmingRef.current = false;
    setIsConfirming(false);
  }, [open]);

  const lockConfirm = useCallback((): boolean => {
    if (isConfirmingRef.current) return false;
    isConfirmingRef.current = true;
    setIsConfirming(true);
    return true;
  }, []);

  return useMemo(() => ({ isConfirming, lockConfirm }), [isConfirming, lockConfirm]);
}

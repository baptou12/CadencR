import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
} from "react";
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
  hasResidualWorktreeDirectory: boolean;
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
  hasResidualWorktreeDirectory,
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
    hasResidualWorktreeDirectory,
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
        onKeyDown={(event) => handleCleanupShortcut(event, cleanupState, killState)}
      >
        <ArchiveDialogHeader />

        <div className="space-y-3">
          {killState.liveTerminalCount > 0 && (
            <KillTerminalsOption
              count={killState.liveTerminalCount}
              checked={killState.killTerminals}
              onToggle={killState.toggleKillTerminals}
            />
          )}
          <ArchiveCleanupOptions
            {...cleanupState}
            hasLiveWorktree={hasLiveWorktree}
            hasResidualWorktreeDirectory={hasResidualWorktreeDirectory}
          />
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

function ArchiveDialogHeader(): ReactElement {
  return (
    <DialogHeader>
      <DialogTitle>Archive session?</DialogTitle>
      <DialogDescription>
        Archive now, optionally cleaning up the related Git worktree or branch in the background.
      </DialogDescription>
    </DialogHeader>
  );
}

function handleCleanupShortcut(
  event: KeyboardEvent,
  cleanupState: ReturnType<typeof useArchiveCleanupState>,
  killState: ReturnType<typeof useKillTerminalsState>,
): void {
  const action = {
    w: cleanupState.toggleWorktree,
    b: cleanupState.toggleBranch,
    t: killState.toggleKillTerminals,
  }[event.key.toLowerCase()];
  if (!action) return;
  event.preventDefault();
  action();
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
  forceBranchDelete: boolean;
  forceWorktreeDelete: boolean;
  deleteWorktree: ReturnType<typeof useDeleteWorktree>["mutateAsync"];
  deleteBranch: ReturnType<typeof useDeleteFeatureBranch>["mutateAsync"];
}): Promise<void> {
  const errors: string[] = [];
  const completed: string[] = [];
  if (args.removeWorktree) {
    try {
      const result = await args.deleteWorktree({
        params: {
          project_id: args.projectId,
          feature_id: args.featureId,
          force: args.forceWorktreeDelete,
        },
      });
      if (result.success) completed.push("worktree removal");
      else errors.push(result.error ?? "Failed to remove worktree");
    } catch (error) {
      errors.push(apiErrorMessage(error, "Failed to remove worktree"));
    }
  }
  if (args.removeBranch) {
    try {
      const result = await args.deleteBranch({
        params: {
          project_id: args.projectId,
          feature_id: args.featureId,
          force: args.forceBranchDelete,
        },
      });
      if (result.success) completed.push("branch deletion");
      else errors.push(result.error ?? "Failed to delete branch");
    } catch (error) {
      errors.push(apiErrorMessage(error, "Failed to delete branch"));
    }
  }
  if (errors.length > 0) {
    const partialSuccess = completed.length > 0 ? `; ${completed.join(" and ")} succeeded` : "";
    throw new Error(`${errors.join("; ")}${partialSuccess}`);
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

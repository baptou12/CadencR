import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { AlertTriangleIcon, GitBranchIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";
import {
  useCheckBranchDelete,
  useDeleteFeatureBranch,
  useDeleteWorktree,
  useGetGitStatus,
  type Feature,
  type GitStatusSnapshot,
} from "@/api/generated";
import { apiErrorMessage } from "@/lib/api-errors";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { KbdShortcut } from "@/components/KbdShortcut";
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
  onOpenChange: (open: boolean) => void;
  onArchive: (featureId: number) => void;
}

export function ArchiveFeatureDialog({
  open,
  feature,
  projectId,
  hasLiveWorktree,
  onOpenChange,
  onArchive,
}: ArchiveFeatureDialogProps): ReactElement {
  const [removeWorktree, setRemoveWorktree] = useState(false);
  const [removeBranch, setRemoveBranch] = useState(false);
  const { isConfirming, lockConfirm } = useConfirmSubmissionLock(open);
  const deleteWorktree = useDeleteWorktree();
  const deleteBranch = useDeleteFeatureBranch();
  const branchCheck = useCheckBranchDelete(
    { project_id: projectId, feature_id: feature?.id ?? 0 },
    { query: { enabled: open && removeBranch && feature != null, retry: false } },
  );
  const isCheckingBranch = removeBranch && branchCheck.isLoading;
  const branchMerged = branchCheck.data?.merged ?? true;
  const forceBranchDelete = removeBranch && !branchMerged;
  const gitStatus = useGetGitStatus(
    { feature_id: feature?.id ?? 0 },
    { query: { enabled: open && hasLiveWorktree && feature != null, retry: false } },
  );
  const dirtyWorktree = isDirtyGitStatus(gitStatus.data);
  const forceWorktreeDelete = removeWorktree && hasLiveWorktree && dirtyWorktree;
  const isCheckingWorktree = removeWorktree && hasLiveWorktree && gitStatus.isLoading;

  useEffect(() => {
    if (!open) {
      setRemoveWorktree(false);
      setRemoveBranch(false);
    }
  }, [open]);

  const toggleWorktree = (): void => {
    if (removeWorktree && removeBranch && hasLiveWorktree) return;
    setRemoveWorktree((value) => !value);
  };

  const toggleBranch = (): void => {
    setRemoveBranch((value) => {
      const next = !value;
      if (next && hasLiveWorktree) setRemoveWorktree(true);
      return next;
    });
  };

  const confirm = (): void => {
    if (!feature) return;
    if (!lockConfirm()) return;
    const featureId = feature.id;
    onArchive(featureId);
    onOpenChange(false);
    if (!removeWorktree && !removeBranch) return;
    const cleanup = cleanupFeature({
      projectId,
      featureId,
      removeWorktree,
      removeBranch,
      hasLiveWorktree,
      forceBranchDelete,
      forceWorktreeDelete,
      deleteWorktree: deleteWorktree.mutateAsync,
      deleteBranch: deleteBranch.mutateAsync,
    });
    toast.promise(cleanup, {
      loading: "Archiving session; cleaning up Git resources…",
      success: "Session archived and Git cleanup finished.",
      error: (err) => apiErrorMessage(err, "Session archived, but Git cleanup failed"),
    });
  };
  useDialogSubmitShortcut({
    open,
    enabled: !isCheckingBranch && !isCheckingWorktree && !isConfirming,
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
            toggleWorktree();
          } else if (event.key.toLowerCase() === "b") {
            event.preventDefault();
            toggleBranch();
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
          <CleanupOption
            checked={removeWorktree}
            disabled={removeBranch && hasLiveWorktree}
            icon={<Trash2Icon className="size-4" />}
            label="Remove worktree"
            shortcut="W"
            description="Delete the related worktree folder without deleting the branch."
            onCheckedChange={toggleWorktree}
          />
          <CleanupOption
            checked={removeBranch}
            icon={<GitBranchIcon className="size-4" />}
            label="Remove branch"
            shortcut="B"
            description="Delete the feature branch after the worktree is removed."
            onCheckedChange={toggleBranch}
          />
          {forceBranchDelete && (
            <div className="flex gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
              <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" />
              <span>
                Branch{" "}
                <span className="font-mono">{branchCheck.data?.branch ?? "feature branch"}</span> is
                not merged into{" "}
                <span className="font-mono">{branchCheck.data?.target_branch ?? "target"}</span>.
                Confirming will force-delete it.
              </span>
            </div>
          )}
          {forceWorktreeDelete && (
            <div className="flex gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
              <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" />
              <span>
                This worktree has uncommitted or untracked files. Confirming will force-remove it,
                so you will permanently lose local changes in that worktree.
              </span>
            </div>
          )}
          {isCheckingWorktree && (
            <p className="text-xs text-muted-foreground">Checking worktree status…</p>
          )}
          {gitStatus.isError && (
            <p className="text-xs text-destructive">
              {apiErrorMessage(gitStatus.error, "Could not check worktree status")}
            </p>
          )}
          {isCheckingBranch && (
            <p className="text-xs text-muted-foreground">Checking branch merge status…</p>
          )}
          {branchCheck.isError && (
            <p className="text-xs text-destructive">
              {apiErrorMessage(branchCheck.error, "Could not check branch merge status")}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant={forceBranchDelete || forceWorktreeDelete ? "destructive" : "default"}
            disabled={isCheckingBranch || isCheckingWorktree || isConfirming}
            onClick={confirm}
          >
            <span>
              {forceBranchDelete || forceWorktreeDelete ? "Archive & force delete" : "Archive"}
            </span>
            <KbdShortcut keys={SUBMIT_KEYS} variant="hint" />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface CleanupOptionProps {
  checked: boolean;
  disabled?: boolean;
  icon: ReactNode;
  label: string;
  shortcut: string;
  description: string;
  onCheckedChange: () => void;
}

function CleanupOption(props: CleanupOptionProps): ReactElement {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-md border p-3 text-sm">
      <Checkbox
        checked={props.checked}
        disabled={props.disabled}
        onCheckedChange={props.onCheckedChange}
      />
      <span className="mt-0.5 text-muted-foreground">{props.icon}</span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2 font-medium">
          {props.label}
          <kbd className="rounded border px-1 text-[10px] text-muted-foreground">
            {props.shortcut}
          </kbd>
        </span>
        <span className="block text-xs text-muted-foreground">{props.description}</span>
      </span>
    </label>
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

function isDirtyGitStatus(status: GitStatusSnapshot | undefined): boolean {
  if (!status) return false;
  return (
    status.uncommitted_count > 0 ||
    status.staged_count > 0 ||
    status.unstaged_count > 0 ||
    status.untracked_count > 0
  );
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

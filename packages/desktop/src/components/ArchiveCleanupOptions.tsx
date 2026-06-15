import type { ReactElement, ReactNode } from "react";
import { AlertTriangleIcon, GitBranchIcon, Trash2Icon } from "lucide-react";
import { CleanupOption } from "@/components/CleanupOption";
import { apiErrorMessage } from "@/lib/api-errors";

interface ArchiveCleanupOptionsProps {
  showWorktreeRemoval: boolean;
  showBranchRemoval: boolean;
  removeWorktree: boolean;
  removeBranch: boolean;
  hasLiveWorktree: boolean;
  branchRemovalDisabled: boolean;
  noWorktreeBranchMode: boolean;
  isCheckingBranchRemovalSafety: boolean;
  isRemovingDefaultBranch: boolean;
  defaultBranch: string;
  isRemovingTargetBranch: boolean;
  branchCheckReady: boolean;
  branchName: string;
  targetBranch: string;
  forceBranchDelete: boolean;
  forceWorktreeDelete: boolean;
  isCheckingWorktree: boolean;
  isCheckingBranch: boolean;
  gitStatusError: unknown;
  branchCheckError: unknown;
  toggleWorktree: () => void;
  toggleBranch: () => void;
}

export function ArchiveCleanupOptions(props: ArchiveCleanupOptionsProps): ReactElement {
  return (
    <div className="space-y-3">
      {props.showWorktreeRemoval && (
        <CleanupOption
          checked={props.removeWorktree}
          disabled={props.removeBranch && props.hasLiveWorktree}
          icon={<Trash2Icon className="size-4" />}
          label="Remove worktree"
          shortcut="W"
          description="Delete the related worktree folder without deleting the branch."
          onCheckedChange={props.toggleWorktree}
        />
      )}
      {props.showBranchRemoval && (
        <CleanupOption
          checked={props.removeBranch}
          disabled={props.branchRemovalDisabled}
          icon={<GitBranchIcon className="size-4" />}
          label="Remove branch"
          shortcut="B"
          description={
            props.noWorktreeBranchMode
              ? "Checkout the target branch, then delete the current branch."
              : "Delete the feature branch after the worktree is removed."
          }
          onCheckedChange={props.toggleBranch}
        />
      )}
      <ArchiveCleanupMessages {...props} />
    </div>
  );
}

function ArchiveCleanupMessages(props: ArchiveCleanupOptionsProps): ReactElement {
  return (
    <>
      {props.isCheckingBranchRemovalSafety && (
        <p className="text-xs text-muted-foreground">Checking branch removal safety…</p>
      )}
      {props.isRemovingDefaultBranch && (
        <DangerMessage>
          Cannot remove the default branch <span className="font-mono">{props.defaultBranch}</span>.
        </DangerMessage>
      )}
      {!props.isRemovingDefaultBranch && props.isRemovingTargetBranch && (
        <DangerMessage>Cannot remove the target branch.</DangerMessage>
      )}
      {props.removeBranch &&
        props.noWorktreeBranchMode &&
        !props.isRemovingTargetBranch &&
        !props.isRemovingDefaultBranch &&
        props.branchCheckReady && (
          <p className="text-xs text-muted-foreground">
            Cadencr will checkout {props.targetBranch} before deleting {props.branchName}.
          </p>
        )}
      {props.forceBranchDelete && (
        <DangerMessage>
          Branch <span className="font-mono">{props.branchName}</span> is not merged into{" "}
          <span className="font-mono">{props.targetBranch}</span>. Confirming will force-delete it.
        </DangerMessage>
      )}
      {props.forceWorktreeDelete && (
        <DangerMessage>
          This worktree has uncommitted or untracked files. Confirming will force-remove it, so you
          will permanently lose local changes in that worktree.
        </DangerMessage>
      )}
      {props.isCheckingWorktree && (
        <p className="text-xs text-muted-foreground">Checking worktree status…</p>
      )}
      {props.gitStatusError != null && (
        <p className="text-xs text-destructive">
          {apiErrorMessage(props.gitStatusError, "Could not check worktree status")}
        </p>
      )}
      {props.isCheckingBranch && (
        <p className="text-xs text-muted-foreground">Checking branch merge status…</p>
      )}
      {props.branchCheckError != null && (
        <p className="text-xs text-destructive">
          {apiErrorMessage(props.branchCheckError, "Could not check branch merge status")}
        </p>
      )}
    </>
  );
}

function DangerMessage({ children }: { children: ReactNode }): ReactElement {
  return (
    <div className="flex gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
      <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" />
      <span>{children}</span>
    </div>
  );
}

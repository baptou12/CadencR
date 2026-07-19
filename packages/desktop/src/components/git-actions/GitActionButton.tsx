import { memo, useCallback, useMemo, useState, type ReactElement } from "react";
import { CircleAlert, ChevronDown, GitBranch, GitCommit, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { selectGitStatus, useGitStatusStore } from "@/stores/useGitStatusStore";
import { getCompareUrl, type GitStatusSnapshot } from "@/api/generated";
import { ShortcutTooltip } from "@/components/ShortcutTooltip";
import { useIsMobile } from "@/hooks/useIsMobile";
import { desktopBridge } from "@/lib/desktop-bridge";
import { apiErrorMessage, toastError } from "@/lib/api-errors";
import { cn } from "@/lib/utils";
import {
  useGitAction,
  type CommitActivity,
  type GitAction,
  type GitActionState,
} from "./useGitAction";
import { gitActionIcon } from "./GitActionPopover";
import { useCommitSubmission } from "./useCommitSubmission";
import {
  effectiveGitUpdateConflictCount,
  useGitUpdateRecoveryStore,
  useSyncGitUpdateRecovery,
} from "./gitUpdateRecoveryStore";
import { useGitUpdatePending } from "./useGitUpdatePending";
import { GitActionDialogs, type GitActionDialog } from "./GitActionDialogs";
import { useGitActionShortcuts } from "./useGitActionShortcuts";
import { GitActionPopoverContent } from "./GitActionPopoverContent";
import { useStashMutationCoordinator } from "../diff/useStashMutationCoordinator";

const GIT_ACTION_BUTTON_CLASS =
  "border-border/80 bg-muted/20 text-xs text-foreground hover:bg-muted/35 disabled:opacity-100 disabled:bg-muted/20 disabled:text-muted-foreground";

interface GitActionButtonProps {
  featureId: number;
  projectId: number;
}

async function openExternal(url: string): Promise<void> {
  try {
    await desktopBridge.openExternal(url);
  } catch (error) {
    toast.error("Couldn't open compare URL.", {
      description: apiErrorMessage(error, String(error)),
    });
  }
}

function useOpenCompare(
  featureId: number,
  compareUrl: string | null | undefined,
): () => Promise<void> {
  return useCallback(async (): Promise<void> => {
    let url = compareUrl ?? null;
    if (!url) {
      try {
        const response = await getCompareUrl({ feature_id: featureId });
        if (response.available) url = response.url;
      } catch (error) {
        toastError(error, "Failed to resolve compare URL.");
        return;
      }
    }
    if (!url) {
      toast.error("Compare URL not available for this remote.");
      return;
    }
    await openExternal(url);
  }, [compareUrl, featureId]);
}

function useGitActionButtonState(featureId: number): {
  snapshot: GitStatusSnapshot | undefined;
  state: GitActionState;
  getStashMutationBlockedReason: () => string | null;
} {
  const snapshot = useGitStatusStore(selectGitStatus(featureId));
  const recovery = useGitUpdateRecoveryStore((store) => store.byFeature[featureId]);
  const updatePending = useGitUpdatePending(featureId);
  useSyncGitUpdateRecovery(featureId, snapshot?.operation ?? null, snapshot?.computed_at ?? 0);
  const recoveryOperation = snapshot?.operation ?? recovery?.operation ?? null;
  const recoveryConflictCount = effectiveGitUpdateConflictCount(
    snapshot?.operation ?? null,
    snapshot?.conflict_count ?? 0,
    snapshot?.computed_at ?? 0,
    recovery,
  );
  const { blockedReason: stashBlockedReason, getBlockedReason: getStashMutationBlockedReason } =
    useStashMutationCoordinator(featureId);
  const state = useGitAction(
    snapshot,
    updatePending,
    recoveryOperation,
    recoveryConflictCount,
    stashBlockedReason,
  );
  return useMemo(
    () => ({ snapshot, state, getStashMutationBlockedReason }),
    [getStashMutationBlockedReason, snapshot, state],
  );
}

export const GitActionButton = memo(function GitActionButton({
  featureId,
  projectId,
}: GitActionButtonProps): ReactElement | null {
  const { snapshot, state, getStashMutationBlockedReason } = useGitActionButtonState(featureId);
  const isMobile = useIsMobile();
  const [activeDialog, setActiveDialog] = useState<GitActionDialog>(null);
  const commitOpen = activeDialog === "commit";
  const handleDialogOpenChange = useCallback((open: boolean) => {
    if (!open) setActiveDialog(null);
  }, []);
  const commitSubmission = useCommitSubmission({
    featureId,
    open: commitOpen,
    onOpenChange: handleDialogOpenChange,
  });
  const commitActivity: CommitActivity = commitSubmission.submitting
    ? "running"
    : commitSubmission.outcome === "error"
      ? "failed"
      : null;
  const [popoverOpen, setPopoverOpen] = useState(false);
  const openCommit = useCallback(() => setActiveDialog("commit"), []);
  const openPopover = useCallback(() => setPopoverOpen(true), []);
  const openPush = useCallback(() => setActiveDialog("push"), []);
  const runOpenCompare = useOpenCompare(featureId, snapshot?.compare_url);

  const runAction = useCallback(
    (action: GitAction) => {
      setPopoverOpen(false);
      if (action === "commit" && commitActivity) {
        openCommit();
        return;
      }
      if (state.disabled[action] !== null) return;
      if (action === "stash") {
        const blockedReason = getStashMutationBlockedReason();
        if (blockedReason) {
          toast.error("Cannot stash changes", { description: blockedReason });
          return;
        }
      }
      if (action === "pr") void runOpenCompare();
      else setActiveDialog(action);
    },
    [commitActivity, getStashMutationBlockedReason, state.disabled, openCommit, runOpenCompare],
  );

  useGitActionShortcuts({
    state,
    commitActivity,
    openCommit,
    openPush,
    openCompare: runOpenCompare,
    openPopover,
  });

  return (
    <>
      <GitActionControls
        featureId={featureId}
        projectId={projectId}
        isMobile={isMobile}
        state={state}
        commitActivity={commitActivity}
        popoverOpen={popoverOpen}
        onPopoverOpenChange={setPopoverOpen}
        onOpenCommit={openCommit}
        onAction={runAction}
        computedAt={snapshot?.computed_at ?? 0}
      />
      <GitActionDialogs
        activeDialog={activeDialog}
        featureId={featureId}
        snapshot={snapshot}
        updateDisabledReason={state.disabled.update}
        commitSubmission={commitSubmission}
        onOpenChange={handleDialogOpenChange}
      />
    </>
  );
});

interface GitActionControlsProps {
  featureId: number;
  projectId: number;
  isMobile: boolean;
  state: GitActionState;
  commitActivity: CommitActivity;
  popoverOpen: boolean;
  onPopoverOpenChange: (open: boolean) => void;
  onOpenCommit: () => void;
  onAction: (action: GitAction) => void;
  computedAt: number;
}

function GitActionControls(props: GitActionControlsProps): ReactElement {
  if (props.isMobile) return <MobileGitActionControl {...props} />;
  return <DesktopGitActionControl {...props} />;
}

function MobileGitActionControl({
  featureId,
  projectId,
  state,
  commitActivity,
  popoverOpen,
  onPopoverOpenChange,
  onOpenCommit,
  onAction,
  computedAt,
}: GitActionControlsProps): ReactElement {
  if (commitActivity) {
    return (
      <div className="inline-flex items-center">
        <CommitActivityButton
          activity={commitActivity}
          onClick={onOpenCommit}
          className="rounded-r-none border-r-0"
        />
        <Popover open={popoverOpen} onOpenChange={onPopoverOpenChange}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="xs"
              className={`${GIT_ACTION_BUTTON_CLASS} rounded-l-none px-1.5`}
              aria-label="More git actions"
            >
              <ChevronDown className="size-3.5" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-80 p-0">
            <GitActionPopoverContent
              featureId={featureId}
              projectId={projectId}
              computedAt={computedAt}
              state={state}
              commitActivity={commitActivity}
              onPick={onAction}
            />
          </PopoverContent>
        </Popover>
      </div>
    );
  }
  return (
    <Popover open={popoverOpen} onOpenChange={onPopoverOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="xs"
          className={GIT_ACTION_BUTTON_CLASS}
          aria-label="Git actions"
        >
          <GitBranch className="size-3.5" />
          <span>Git</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <GitActionPopoverContent
          featureId={featureId}
          projectId={projectId}
          computedAt={computedAt}
          state={state}
          onPick={onAction}
        />
      </PopoverContent>
    </Popover>
  );
}

function DesktopGitActionControl({
  featureId,
  projectId,
  state,
  commitActivity,
  popoverOpen,
  onPopoverOpenChange,
  onOpenCommit,
  onAction,
  computedAt,
}: GitActionControlsProps): ReactElement {
  const primaryAction = commitActivity ? "commit" : state.primary;
  const PrimaryIcon = state.updatePending
    ? Loader2
    : primaryAction
      ? gitActionIcon(primaryAction)
      : GitCommit;
  const primaryDisabled = primaryAction === null;
  return (
    <div className="inline-flex items-center">
      {commitActivity ? (
        <CommitActivityButton
          activity={commitActivity}
          onClick={onOpenCommit}
          className="rounded-r-none border-r-0"
        />
      ) : (
        <Button
          variant="outline"
          size="xs"
          className={`${GIT_ACTION_BUTTON_CLASS} rounded-r-none border-r-0`}
          disabled={primaryDisabled}
          onClick={() => primaryAction && onAction(primaryAction)}
          title={primaryDisabled ? (state.disabled.commit ?? state.label) : state.label}
          aria-live="polite"
        >
          <PrimaryIcon className={state.updatePending ? "size-3.5 animate-spin" : "size-3.5"} />
          <span>{state.label}</span>
        </Button>
      )}
      <Popover open={popoverOpen} onOpenChange={onPopoverOpenChange}>
        <ShortcutTooltip label="Git actions" keys={["cmd", "G"]}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="xs"
              className={`${GIT_ACTION_BUTTON_CLASS} rounded-l-none px-1.5`}
              aria-label="More git actions"
            >
              <ChevronDown className="size-3.5" />
            </Button>
          </PopoverTrigger>
        </ShortcutTooltip>
        <PopoverContent align="end" className="w-80 p-0">
          <GitActionPopoverContent
            featureId={featureId}
            projectId={projectId}
            computedAt={computedAt}
            state={state}
            commitActivity={commitActivity}
            onPick={onAction}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}

interface CommitActivityButtonProps {
  activity: Exclude<CommitActivity, null>;
  className?: string;
  onClick: () => void;
}

function CommitActivityButton({
  activity,
  className,
  onClick,
}: CommitActivityButtonProps): ReactElement {
  const running = activity === "running";
  return (
    <Button
      variant="outline"
      size="xs"
      className={cn(GIT_ACTION_BUTTON_CLASS, className)}
      onClick={onClick}
      aria-live="polite"
      title={running ? "View commit progress" : "View commit error"}
    >
      {running ? (
        <Loader2 className="size-3.5 animate-spin" />
      ) : (
        <CircleAlert className="size-3.5 text-destructive" />
      )}
      <span className={running ? undefined : "text-destructive"}>
        {running ? "Committing" : "Commit failed"}
      </span>
    </Button>
  );
}

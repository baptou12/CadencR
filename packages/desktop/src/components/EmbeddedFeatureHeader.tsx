import { memo, useCallback, type MouseEvent, type ReactElement } from "react";
import { Link } from "@tanstack/react-router";
import { AlertTriangleIcon, EyeOffIcon, GitBranchIcon, Loader2Icon, PinIcon } from "lucide-react";
import { ProjectBadge } from "@/components/ProjectBadge";
import { ShortcutTooltip } from "@/components/ShortcutTooltip";
import { SlidingText } from "@/components/SlidingText";
import { Button } from "@/components/ui/button";
import { FeatureLabelChip } from "@/components/FeatureLabelChip";
import { cn } from "@/lib/utils";
import type { WorktreeStatus } from "@/types/workflow";

interface EmbeddedFeatureHeaderProps {
  featureId: number;
  projectId: number;
  projectName?: string;
  title: string;
  label?: string | null;
  lastActivityAt?: string | null;
  className?: string;
  isPinned?: boolean;
  isPinPending?: boolean;
  onTogglePin?: () => void;
  onExclude?: () => void;
  worktreeStatus?: WorktreeStatus;
  worktreeBranch?: string | null;
}

export const EmbeddedFeatureHeader = memo(function EmbeddedFeatureHeader({
  featureId,
  projectId,
  projectName,
  title,
  label,
  lastActivityAt,
  className,
  isPinned = false,
  isPinPending = false,
  onTogglePin,
  onExclude,
  worktreeStatus,
  worktreeBranch,
}: EmbeddedFeatureHeaderProps): ReactElement {
  return (
    <div
      className={cn(
        "flex h-9 shrink-0 items-center gap-2 border-b bg-background px-2.5",
        "text-xs text-foreground",
        className,
      )}
    >
      <div className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-1.5 py-1">
        <ProjectBadge projectId={projectId} size="xs" />
        {projectName && (
          <>
            <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
              {projectName}
            </span>
            <span className="shrink-0 text-muted-foreground">/</span>
          </>
        )}
        <SlidingText text={title} className="min-w-0 flex-1 font-semibold leading-none" />
        <FeatureLabelChip label={label} className="max-w-24 leading-3" />
        <WorktreeIndicator status={worktreeStatus} branch={worktreeBranch} />
      </div>
      <EmbeddedFeatureHeaderActions
        featureId={featureId}
        projectId={projectId}
        lastActivityAt={lastActivityAt}
        isPinned={isPinned}
        isPinPending={isPinPending}
        onTogglePin={onTogglePin}
        onExclude={onExclude}
      />
    </div>
  );
});

interface EmbeddedFeatureHeaderActionsProps {
  featureId: number;
  projectId: number;
  lastActivityAt?: string | null;
  isPinned: boolean;
  isPinPending: boolean;
  onTogglePin?: () => void;
  onExclude?: () => void;
}

const EmbeddedFeatureHeaderActions = memo(function EmbeddedFeatureHeaderActions({
  featureId,
  projectId,
  lastActivityAt,
  isPinned,
  isPinPending,
  onTogglePin,
  onExclude,
}: EmbeddedFeatureHeaderActionsProps): ReactElement {
  const activityLabel = formatActivity(lastActivityAt);
  const handlePinClick = useCallback(
    (event: MouseEvent<HTMLButtonElement>): void => {
      event.stopPropagation();
      onTogglePin?.();
    },
    [onTogglePin],
  );
  const handleExcludeClick = useCallback(
    (event: MouseEvent<HTMLButtonElement>): void => {
      event.stopPropagation();
      onExclude?.();
    },
    [onExclude],
  );
  return (
    <>
      {activityLabel && (
        <span
          title={lastActivityAt ? `Last activity: ${lastActivityAt}` : undefined}
          className="shrink-0 pl-1 font-mono text-[10px] text-muted-foreground"
        >
          {activityLabel}
        </span>
      )}
      {onExclude ? (
        <ShortcutTooltip label="Hide from this view" keys={["cmd", "shift", "H"]} alignRight>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-6 shrink-0 rounded-md text-muted-foreground hover:bg-accent/70 hover:text-foreground"
            aria-label="Hide agent from this view"
            onClick={handleExcludeClick}
          >
            <EyeOffIcon className="size-3.5" />
          </Button>
        </ShortcutTooltip>
      ) : null}
      {onTogglePin ? (
        <ShortcutTooltip
          label={isPinned ? "Unpin agent" : "Pin agent"}
          keys={["cmd", "shift", "P"]}
          alignRight
        >
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={cn(
              "size-6 shrink-0 rounded-md text-muted-foreground hover:bg-accent/70 hover:text-foreground",
              isPinned && "text-primary hover:text-primary",
            )}
            disabled={isPinPending}
            aria-pressed={isPinned}
            aria-label={isPinned ? "Unpin agent" : "Pin agent"}
            onClick={handlePinClick}
          >
            {isPinPending ? (
              <Loader2Icon className="size-3.5 animate-spin" />
            ) : (
              <PinIcon className={cn("size-3.5", isPinned && "fill-current")} />
            )}
          </Button>
        </ShortcutTooltip>
      ) : null}
      <ShortcutTooltip label="Open feature page" keys={["cmd", "o"]} alignRight>
        <Button
          asChild
          variant="ghost"
          size="sm"
          className="h-6 shrink-0 rounded-md px-2 font-mono text-[10.5px] text-muted-foreground hover:bg-accent/70 hover:text-foreground"
          onClick={(event) => event.stopPropagation()}
        >
          <Link
            to="/projects/$projectId/features/$featureId"
            params={{ projectId: String(projectId), featureId: String(featureId) }}
          >
            Open
          </Link>
        </Button>
      </ShortcutTooltip>
    </>
  );
});

function WorktreeIndicator({
  status,
  branch,
}: {
  status?: WorktreeStatus;
  branch?: string | null;
}): ReactElement | null {
  if (!status || status === "idle") return null;
  const label = worktreeLabel(status, branch);
  const tooltipLabel = worktreeTooltipLabel(status, branch);
  const Icon = status === "setup_error" ? AlertTriangleIcon : GitBranchIcon;
  return (
    <ShortcutTooltip label={tooltipLabel} className="shrink-0">
      <span
        aria-label={label}
        className={cn(
          "inline-flex size-5 items-center justify-center rounded-full border",
          worktreeIndicatorClass(status),
        )}
      >
        {status === "creating" || status === "setup_running" ? (
          <Loader2Icon className="size-3 animate-spin" />
        ) : (
          <Icon className="size-3" />
        )}
      </span>
    </ShortcutTooltip>
  );
}

function worktreeIndicatorClass(status: WorktreeStatus): string {
  if (status === "ready" || status === "created") {
    return "border-green-400/35 bg-green-400/15 text-green-300";
  }
  if (status === "setup_error") return "border-red-400/40 bg-red-400/15 text-red-300";
  return "border-yellow-300/40 bg-yellow-300/15 text-yellow-200";
}

function worktreeLabel(status: WorktreeStatus, branch?: string | null): string {
  const suffix = branch ? ` · ${branch}` : "";
  if (status === "ready") return `Worktree ready${suffix}`;
  if (status === "created") return `Worktree created${suffix}`;
  if (status === "creating") return `Creating worktree${suffix}`;
  if (status === "setup_running") return `Running worktree setup${suffix}`;
  if (status === "setup_error") return `Worktree setup failed${suffix}`;
  return `Worktree${suffix}`;
}

function worktreeTooltipLabel(status: WorktreeStatus, branch?: string | null): string {
  const suffix = branch ? ` · ${branch}` : "";
  if (status === "setup_error") return `Git worktree setup failed${suffix}`;
  if (status === "creating" || status === "setup_running") {
    return `Preparing isolated Git worktree${suffix}`;
  }
  return `Agent uses an isolated Git worktree${suffix}`;
}

function formatActivity(value?: string | null): string | null {
  if (!value) return null;
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return null;
  const minutes = Math.max(0, Math.floor((Date.now() - time) / 60_000));
  if (minutes === 0) return "now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

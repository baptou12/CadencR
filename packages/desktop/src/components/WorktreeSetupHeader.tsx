import type { ReactElement } from "react";
import {
  AlertCircleIcon,
  AlertTriangleIcon,
  CheckCircle2Icon,
  ChevronRightIcon,
  GitBranchIcon,
  Loader2Icon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { CopyButton } from "@/components/CopyButton";
import { cn } from "@/lib/utils";

interface WorktreeSetupHeaderProps {
  branch: string;
  branchExists: boolean | null;
  status: WorktreeSetupDisplayStatus;
  isOpen: boolean;
  onToggle: () => void;
}

export type WorktreeSetupDisplayStatus =
  | "running"
  | "checking"
  | "ready"
  | "removed"
  | "health-error"
  | "setup-error";

export function WorktreeSetupHeader(props: WorktreeSetupHeaderProps): ReactElement {
  return (
    <div
      className="flex min-w-0 cursor-pointer items-center gap-2 px-3 py-1.5 hover:bg-muted/70 md:px-6"
      onClick={props.onToggle}
    >
      <ChevronRightIcon
        className={cn(
          "size-3.5 shrink-0 text-foreground/40 transition-transform duration-200",
          props.isOpen && "rotate-90",
        )}
      />
      <GitBranchIcon className="size-3.5 shrink-0" />
      <span className="shrink-0 text-xs font-medium">Worktree Setup</span>
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {props.branch && <WorktreeBranchChip branch={props.branch} />}
        <WorktreeSetupBadge {...props} />
        {props.status === "removed" && (
          <span className="min-w-0 truncate text-xs text-destructive">
            {missingSummary(props.branchExists)}
          </span>
        )}
      </div>
    </div>
  );
}

function WorktreeBranchChip({ branch }: { branch: string }): ReactElement {
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <span className="truncate font-mono text-xs text-muted-foreground">{branch}</span>
      <CopyButton
        text={branch}
        label="Copy branch name"
        copiedLabel="Copied branch name"
        idleClassName="text-muted-foreground opacity-70"
        iconClassName="size-3"
        className="shrink-0 hover:text-foreground"
      />
    </div>
  );
}

function WorktreeSetupBadge(props: WorktreeSetupHeaderProps): ReactElement {
  const badge = badgeContent(props.status);
  return (
    <Badge
      variant="secondary"
      className={cn("shrink-0 gap-1 px-1.5 py-0 text-[10px]", badge.style)}
    >
      {badge.content}
    </Badge>
  );
}

function badgeContent(status: WorktreeSetupDisplayStatus): {
  content: ReactElement;
  style: string;
} {
  if (status === "removed") {
    return {
      content: (
        <>
          <AlertTriangleIcon className="size-2.5" /> removed
        </>
      ),
      style: "bg-destructive/15 text-destructive",
    };
  }
  if (status === "health-error") {
    return {
      content: (
        <>
          <AlertCircleIcon className="size-2.5" /> check failed
        </>
      ),
      style: "bg-destructive/15 text-destructive",
    };
  }
  if (status === "checking") {
    return {
      content: (
        <>
          <Loader2Icon className="size-2.5 animate-spin" /> checking
        </>
      ),
      style: "bg-muted text-muted-foreground",
    };
  }
  if (status === "ready") {
    return {
      content: (
        <>
          <CheckCircle2Icon className="size-2.5" /> ready
        </>
      ),
      style: "bg-green-500/15 text-green-400",
    };
  }
  if (status === "running") {
    return {
      content: (
        <>
          <Loader2Icon className="size-2.5 animate-spin" /> running
        </>
      ),
      style: "bg-blue-500/15 text-blue-400",
    };
  }
  return {
    content: (
      <>
        <AlertCircleIcon className="size-2.5" /> error
      </>
    ),
    style: "bg-red-500/15 text-red-400",
  };
}

function missingSummary(branchExists: boolean | null): string {
  if (branchExists === true) return "Folder removed; branch still exists";
  if (branchExists === false) return "Folder and branch removed";
  return "Folder removed; branch status unknown";
}

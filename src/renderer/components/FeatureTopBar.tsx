import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { TerminalIcon, SettingsIcon, GitCompareArrowsIcon, AlertCircleIcon, RefreshCwIcon } from "lucide-react";
import { trpc } from "@/trpc";
import { DiffViewerModal } from "./diff/DiffViewerModal";
import { ModelSelector } from "./ModelSelector";

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-gray-500/15 text-gray-300",
  planned: "bg-blue-500/15 text-blue-300",
  "in-progress": "bg-yellow-500/15 text-yellow-300",
  review: "bg-purple-500/15 text-purple-300",
  done: "bg-green-500/15 text-green-300",
};

interface FeatureTopBarProps {
  featureId: number;
  projectId: number;
  mode?: "feature" | "session";
}

export function FeatureTopBar({ featureId, projectId: _projectId, mode = "feature" }: FeatureTopBarProps) {
  const isSession = mode === "session";
  const [diffOpen, setDiffOpen] = useState(false);
  const { data: feature } = trpc.features.getById.useQuery({ id: featureId });
  const { data: progress } = trpc.features.getProgress.useQuery(
    { feature_id: featureId },
    { enabled: !isSession },
  );
  const { data: featureSettings } = trpc.features.getSettings.useQuery({
    feature_id: featureId,
  });
  const { data: gitStats } = trpc.git.getStats.useQuery(
    { featureId },
    { refetchInterval: 10000, enabled: !isSession },
  );
  const openTerminal = trpc.git.openInTerminal.useMutation();

  const utils = trpc.useContext();
  const createWorktree = trpc.git.createWorktree.useMutation({
    onSuccess: () => {
      utils.features.getSettings.invalidate({ feature_id: featureId });
    },
  });

  const worktreeBranch = featureSettings?.worktree_branch;
  const worktreeError = featureSettings?.worktree_error;

  if (!feature) return null;

  return (
    <div className="flex items-center gap-3 border-b border-border px-4 py-2">
      <h1 className="text-lg font-semibold">{feature.title}</h1>

      {!isSession && (
        <Badge
          variant="secondary"
          className={STATUS_COLORS[feature.status] ?? ""}
        >
          {feature.status}
        </Badge>
      )}

      {!isSession && progress && progress.total > 0 && (
        <span className="text-muted-foreground text-sm">
          Phases: {progress.done}/{progress.total}
        </span>
      )}

      {worktreeBranch ? (
        <span className="text-muted-foreground text-sm">
          Worktree: {worktreeBranch}
        </span>
      ) : worktreeError ? (
        <span className="flex items-center gap-1 text-sm text-red-400" title={worktreeError}>
          <AlertCircleIcon className="size-3.5" />
          Worktree failed
          <Button
            variant="ghost"
            size="icon"
            className="size-5"
            title="Retry worktree creation"
            disabled={createWorktree.isLoading}
            onClick={() =>
              createWorktree.mutate({
                projectId: feature.project_id,
                featureId,
                featureTitle: feature.title,
              })
            }
          >
            <RefreshCwIcon className={`size-3 ${createWorktree.isLoading ? "animate-spin" : ""}`} />
          </Button>
        </span>
      ) : (
        <span className="text-muted-foreground text-sm">
          Worktree: --
        </span>
      )}

      {!isSession && (
        <span className="text-muted-foreground text-sm">
          LOC: {gitStats ? `+${gitStats.insertions} -${gitStats.deletions}` : "--"}
        </span>
      )}

      <div className="flex-1" />

      {!isSession && (
        <>
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            title="View Diff"
            disabled={!worktreeBranch}
            onClick={() => setDiffOpen(true)}
          >
            <GitCompareArrowsIcon className="size-4" />
          </Button>

          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            title="Open terminal"
            disabled={!worktreeBranch}
            onClick={() => openTerminal.mutate({ featureId })}
          >
            <TerminalIcon className="size-4" />
          </Button>
        </>
      )}

      <Popover>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="icon" className="size-7" title="Feature settings">
            <SettingsIcon className="size-4" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[540px]" align="end">
          <div className="space-y-3">
            <div>
              <h4 className="text-sm font-semibold">Model Configuration</h4>
              <p className="text-xs text-muted-foreground">Override models for this feature</p>
            </div>
            <ModelSelector level="feature" featureId={featureId} projectId={_projectId} />
          </div>
        </PopoverContent>
      </Popover>

      <DiffViewerModal
        featureId={featureId}
        open={diffOpen}
        onOpenChange={setDiffOpen}
      />
    </div>
  );
}

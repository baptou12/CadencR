import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TerminalIcon, SettingsIcon } from "lucide-react";
import { trpc } from "@/trpc";

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-gray-500/15 text-gray-700 dark:text-gray-300",
  planned: "bg-blue-500/15 text-blue-700 dark:text-blue-300",
  "in-progress": "bg-yellow-500/15 text-yellow-700 dark:text-yellow-300",
  review: "bg-purple-500/15 text-purple-700 dark:text-purple-300",
  done: "bg-green-500/15 text-green-700 dark:text-green-300",
};

interface FeatureTopBarProps {
  featureId: number;
  projectId: number;
}

export function FeatureTopBar({ featureId, projectId: _projectId }: FeatureTopBarProps) {
  const { data: feature } = trpc.features.getById.useQuery({ id: featureId });
  const { data: progress } = trpc.features.getPlanProgress.useQuery({
    feature_id: featureId,
  });
  const { data: featureSettings } = trpc.features.getSettings.useQuery({
    feature_id: featureId,
  });
  const openTerminal = trpc.git.openInTerminal.useMutation();

  const worktreeBranch = featureSettings?.worktree_branch;

  if (!feature) return null;

  return (
    <div className="flex items-center gap-3 border-b border-border px-4 py-2">
      <h1 className="text-lg font-semibold">{feature.title}</h1>

      <Badge
        variant="secondary"
        className={STATUS_COLORS[feature.status] ?? ""}
      >
        {feature.status}
      </Badge>

      {progress && progress.total > 0 && (
        <span className="text-muted-foreground text-sm">
          Phases: {progress.done}/{progress.total}
        </span>
      )}

      <span className="text-muted-foreground text-sm">
        Worktree: {worktreeBranch ?? "--"}
      </span>

      <span className="text-muted-foreground text-sm">LOC: --</span>

      <div className="flex-1" />

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

      <Button variant="ghost" size="icon" className="size-7" title="Feature settings">
        <SettingsIcon className="size-4" />
      </Button>
    </div>
  );
}

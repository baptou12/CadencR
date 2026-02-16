import { useState } from "react";
import { cn } from "@/lib/utils";
import { useHotkeys } from "react-hotkeys-hook";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TerminalIcon, SettingsIcon, GitCompareArrowsIcon } from "lucide-react";
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
  className?: string;
}

export function FeatureTopBar({ featureId, projectId: _projectId, mode = "feature", className }: FeatureTopBarProps) {
  const isSession = mode === "session";
  const [diffOpen, setDiffOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // OPT+P -> toggle feature settings popover
  useHotkeys(
    "alt+p",
    (e) => {
      e.preventDefault();
      setSettingsOpen((prev) => !prev);
    },
    { enableOnFormTags: true },
  );

  // CMD+SHIFT+D -> toggle diff viewer
  useHotkeys(
    "meta+shift+d",
    (e) => {
      e.preventDefault();
      setDiffOpen((prev) => !prev);
    },
    { enableOnFormTags: true },
  );
  const { data: feature } = trpc.features.getById.useQuery({ id: featureId });
  const { data: progress } = trpc.features.getProgress.useQuery(
    { feature_id: featureId },
    { enabled: !isSession },
  );
  const { data: featureSettings } = trpc.features.getSettings.useQuery({
    feature_id: featureId,
  });
  const { data: gitStats } = trpc.git.getStats.useQuery(
    { featureId, mode: isSession ? "worktree" : "branch" },
    { refetchInterval: 10000 },
  );
  const { data: currentBranch } = trpc.git.getBranch.useQuery(
    { projectId: _projectId },
    { enabled: isSession, refetchInterval: 10000 },
  );
  const openTerminal = trpc.git.openInTerminal.useMutation();

  const utils = trpc.useContext();
  const setFeatureSetting = trpc.features.setSetting.useMutation({
    onSuccess: () => {
      utils.features.getSettings.invalidate({ feature_id: featureId });
    },
  });
  const worktreeBranch = featureSettings?.worktree_branch;

  if (!feature) return null;

  return (
    <div className={cn("flex items-center gap-3 border-b border-border px-4 py-2", className)}>
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

      {isSession ? (
        <span className="text-muted-foreground text-sm">
          {currentBranch ?? "--"}
        </span>
      ) : worktreeBranch ? (
        <span className="text-muted-foreground text-sm">
          Worktree: {worktreeBranch}
        </span>
      ) : (
        <span className="text-muted-foreground text-sm">
          Worktree: pending
        </span>
      )}

      <div className="flex-1" />

      <Button
        variant="ghost"
        size="sm"
        className="h-7 gap-1.5 px-2"
        title="View Diff"
        disabled={!isSession && !worktreeBranch}
        onClick={() => setDiffOpen(true)}
      >
        <GitCompareArrowsIcon className="size-4" />
        {gitStats && (gitStats.insertions > 0 || gitStats.deletions > 0) ? (
          <>
            <span className="text-xs text-green-400">+{gitStats.insertions}</span>
            <span className="text-xs text-red-400">-{gitStats.deletions}</span>
          </>
        ) : null}
      </Button>

      {!isSession && (
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
      )}

      <Popover open={settingsOpen} onOpenChange={setSettingsOpen}>
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

          {!isSession && (
            <div className="space-y-1">
              <span className="text-xs font-medium">Agent Autonomy</span>
              <Select
                value={featureSettings?.agent_autonomy ?? ""}
                onValueChange={(value) =>
                  setFeatureSetting.mutate({
                    feature_id: featureId,
                    key: "agent_autonomy",
                    value,
                  })
                }
              >
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue placeholder="Inherit from project" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">Low — ask before commit</SelectItem>
                  <SelectItem value="2">Medium — manual continue</SelectItem>
                  <SelectItem value="3">High — full auto</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Controls how much the execute agent does automatically
              </p>
            </div>
          )}
        </PopoverContent>
      </Popover>

      <DiffViewerModal
        featureId={featureId}
        open={diffOpen}
        onOpenChange={setDiffOpen}
        diffMode={isSession ? "worktree" : "branch"}
      />
    </div>
  );
}

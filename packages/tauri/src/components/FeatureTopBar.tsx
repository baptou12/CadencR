import { useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useHotkeys } from "react-hotkeys-hook";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SettingsIcon, BrainCircuitIcon, CpuIcon, PanelLeft, Settings } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetFeature,
  useGetFeatureSettings,
  getGetFeatureSettingsQueryKey,
  useSetFeatureSetting,
} from "@/api/generated";
import { CustomActionsBar } from "./CustomActionsBar";
import { ModelSelector } from "./ModelSelector";
import { Skeleton } from "@/components/ui/skeleton";
import { useFeatureTitle } from "@/hooks/useFeatureTitle";
import type { AutonomyLevel, WorktreeStatus } from "@/types/workflow";
import { useWorkflowStore } from "@/hooks/useWorkflowWebSocket";
import { WorktreeSetupSection } from "./WorktreeSetupSection";
import { startDragging, toggleMaximize } from "@/lib/window-drag";
import { ProjectColorDot } from "@/hooks/useProjectColor";
import { useSidebarCollapsed } from "@/components/SidebarContext";
import logoSvg from "@/logo.svg";
import { STATUS_COLORS, type FeatureStatus } from "@/lib/feature-status";

interface FeatureTopBarProps {
  featureId: number;
  projectId: number;
  mode?: "feature" | "session";
  className?: string;
  wsWorktreeStatus?: WorktreeStatus;
  wsWorktreeBranch?: string | null;
  wsWorktreeSetupOutput?: string[];
  onRetryWorktreeSetup?: () => void;
}

export function FeatureTopBar({
  featureId,
  projectId,
  mode = "feature",
  className,
  wsWorktreeStatus,
  wsWorktreeBranch,
  wsWorktreeSetupOutput,
  onRetryWorktreeSetup,
}: FeatureTopBarProps) {
  const isSession = mode === "session";
  const { collapsed: sidebarCollapsed, setCollapsed: setSidebarCollapsed } = useSidebarCollapsed();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const queryClient = useQueryClient();
  const setAutonomyLevel = useWorkflowStore((s) => s.setAutonomyLevel);
  const setParallelExecution = useWorkflowStore((s) => s.setParallelExecution);

  const { data: feature } = useGetFeature(featureId);
  // Live WS-pushed title from auto-naming (falls back to null).
  const { title: wsTitle, isAutoNaming } = useFeatureTitle(featureId);
  const { data: featureSettingsData } = useGetFeatureSettings(featureId);
  const featureSettingsMap = featureSettingsData
    ? Object.fromEntries(featureSettingsData.map((s) => [s.key, s.value]))
    : {};
  const featureSettings = { ...featureSettingsMap };

  // OPT+P -> toggle feature settings popover (secondary shortcut)
  useHotkeys(
    "alt+p",
    (e) => {
      if (isSession) return;
      e.preventDefault();
      setSettingsOpen((prev) => !prev);
    },
    { enableOnFormTags: true, enableOnContentEditable: true },
  );

  // CMD+SHIFT+P -> toggle feature settings popover (primary shortcut)
  useHotkeys(
    "meta+shift+p",
    (e) => {
      if (isSession) return;
      e.preventDefault();
      setSettingsOpen((prev) => !prev);
    },
    { enableOnFormTags: true, enableOnContentEditable: true },
  );

  const setFeatureSetting = useSetFeatureSetting({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetFeatureSettingsQueryKey(featureId) });
        toast.success("Settings saved");
      },
    },
  });
  if (!feature) return null;

  return (
    <>
      <div
        onMouseDown={startDragging}
        onDoubleClick={toggleMaximize}
        className={cn("flex items-center gap-3 border-b border-border px-6 py-3", className)}
      >
        {sidebarCollapsed && (
          <>
            <div className="group/logo flex items-center gap-0.5 shrink-0 -ml-2">
              <Button
                variant="ghost"
                size="icon"
                className="size-7 shrink-0 opacity-0 group-hover/logo:opacity-100 transition-opacity"
                title="Expand sidebar (⌘B)"
                onClick={() => setSidebarCollapsed(false)}
              >
                <PanelLeft className="size-4" />
              </Button>
              <img src={logoSvg} alt="Cadence" className="size-9 shrink-0 -translate-y-px" />
              <span
                className="text-xl font-bold uppercase tracking-widest leading-none"
                style={{ fontFamily: "'Avenir Next', 'Montserrat', 'Helvetica Neue', sans-serif" }}
              >
                Cadence
              </span>
              {import.meta.env.DEV && (
                <span className="ml-1 self-start text-[9px] font-semibold uppercase tracking-wider px-1 py-px rounded bg-orange-500/20 text-orange-400 leading-none">
                  dev
                </span>
              )}
              <Link
                to="/settings"
                className="ml-1 opacity-0 group-hover/logo:opacity-100 transition-opacity"
              >
                <Button variant="ghost" size="icon" className="size-7">
                  <Settings className="size-4" />
                  <span className="sr-only">Settings</span>
                </Button>
              </Link>
            </div>
            <div className="mx-1 h-5 w-px bg-border" />
          </>
        )}
        {!isSession && (
          <Badge
            variant="secondary"
            className={STATUS_COLORS[feature.status as FeatureStatus] ?? ""}
          >
            {feature.status}
          </Badge>
        )}

        <ProjectColorDot projectId={projectId} className="size-2.5" />
        {isAutoNaming ? (
          <Skeleton className="h-5 w-40" />
        ) : (
          <h1 className="text-lg font-semibold">{wsTitle ?? feature.title}</h1>
        )}

        <div className="flex-1" />

        <CustomActionsBar featureId={featureId} projectId={projectId} />

        {!isSession && (
          <Popover open={settingsOpen} onOpenChange={setSettingsOpen}>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="icon" className="size-7" title="Feature settings">
                <SettingsIcon className="size-4" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[820px] max-w-[calc(100vw-2rem)]" align="end">
              <div className="space-y-4">
                <div className="space-y-2">
                  <h4 className="text-sm font-semibold">Model Configuration</h4>
                  <ModelSelector level="feature" featureId={featureId} projectId={projectId} />
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center gap-1.5">
                    <BrainCircuitIcon className="size-3.5 text-muted-foreground" />
                    <span className="text-xs font-medium">Agent Autonomy</span>
                  </div>
                  <Select
                    value={featureSettings?.agent_autonomy ?? ""}
                    onValueChange={(value) => {
                      setFeatureSetting.mutate({
                        id: featureId,
                        data: { key: "agent_autonomy", value },
                      });
                      setAutonomyLevel(Number(value) as AutonomyLevel);
                    }}
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

                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-1.5">
                      <CpuIcon className="size-3.5 text-muted-foreground" />
                      <span className="text-xs font-medium">Parallel Execution</span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Run multiple agents in parallel within each step
                    </p>
                  </div>
                  <Switch
                    id="feature-parallel-execution"
                    checked={
                      (featureSettings?.parallel_execution ?? "") === "true" ||
                      featureSettings?.parallel_execution == null
                    }
                    onCheckedChange={(checked) => {
                      setFeatureSetting.mutate({
                        id: featureId,
                        data: { key: "parallel_execution", value: checked ? "true" : "false" },
                      });
                      setParallelExecution(checked);
                    }}
                  />
                </div>
              </div>
            </PopoverContent>
          </Popover>
        )}
      </div>
      <WorktreeSetupSection
        featureId={featureId}
        projectId={projectId}
        wsWorktreeStatus={wsWorktreeStatus}
        wsWorktreeBranch={wsWorktreeBranch}
        wsWorktreeSetupOutput={wsWorktreeSetupOutput}
        onRetrySetup={onRetryWorktreeSetup}
      />
    </>
  );
}

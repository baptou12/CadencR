import { useState, type Dispatch, type ReactElement, type SetStateAction } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
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
import { SettingsIcon, BrainCircuitIcon, CpuIcon } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetFeature,
  useGetFeatureSettings,
  getGetFeatureSettingsQueryKey,
  useSetFeatureSetting,
} from "@/api/generated";
import { CustomActionsBar } from "./CustomActionsBar";
import { EmbeddedSessionHeader } from "./FeatureTopBarEmbedded";
import { ModelSelector } from "./ModelSelector";
import { Skeleton } from "@/components/ui/skeleton";
import { useFeatureTitle } from "@/hooks/useFeatureTitle";
import type { AutonomyLevel, WorktreeStatus } from "@/types/workflow";
import { useWorkflowStore } from "@/hooks/useWorkflowWebSocket";
import { WorktreeSetupSection } from "./WorktreeSetupSection";
import { startDragging, toggleMaximize } from "@/lib/window-drag";
import { ProjectColorDot } from "@/hooks/useProjectColor";
import { useSidebarCollapsed } from "@/components/SidebarContext";
import { STATUS_COLORS, type FeatureStatus } from "@/lib/feature-status";
import { SidebarCollapsedChrome } from "@/components/SidebarCollapsedChrome";
import { useFeatureSettingsShortcuts } from "./useFeatureSettingsShortcuts";

interface FeatureTopBarProps {
  featureId: number;
  projectId: number;
  mode?: "feature" | "session";
  className?: string;
  wsWorktreeStatus?: WorktreeStatus;
  wsWorktreeBranch?: string | null;
  wsWorktreeSetupOutput?: string[];
  wsWorktreeError?: string | null;
  onRetryWorktreeSetup?: () => void;
  showCustomActions?: boolean;
  showSidebarChrome?: boolean;
  draggable?: boolean;
  projectName?: string;
  titleOverride?: string;
  lastActivityAt?: string | null;
  isPinned?: boolean;
  isPinPending?: boolean;
  onTogglePin?: () => void;
  hideEmbeddedWorktreeSetup?: boolean;
}

export function FeatureTopBar({
  showCustomActions = true,
  showSidebarChrome = true,
  ...props
}: FeatureTopBarProps): ReactElement | null {
  if (!showCustomActions && !showSidebarChrome && props.titleOverride) {
    return (
      <EmbeddedFeatureTopBar
        {...props}
        showCustomActions={showCustomActions}
        showSidebarChrome={showSidebarChrome}
      />
    );
  }
  return (
    <StandardFeatureTopBar
      {...props}
      showCustomActions={showCustomActions}
      showSidebarChrome={showSidebarChrome}
    />
  );
}

function EmbeddedFeatureTopBar({
  featureId,
  projectId,
  className,
  wsWorktreeStatus,
  wsWorktreeBranch,
  wsWorktreeSetupOutput,
  wsWorktreeError,
  onRetryWorktreeSetup,
  projectName,
  titleOverride,
  lastActivityAt,
  isPinned,
  isPinPending,
  onTogglePin,
  hideEmbeddedWorktreeSetup,
}: FeatureTopBarProps): ReactElement {
  return (
    <EmbeddedSessionHeader
      featureId={featureId}
      projectId={projectId}
      projectName={projectName}
      title={titleOverride ?? ""}
      lastActivityAt={lastActivityAt}
      isPinned={isPinned}
      isPinPending={isPinPending}
      onTogglePin={onTogglePin}
      className={className}
      wsWorktreeStatus={wsWorktreeStatus}
      wsWorktreeBranch={wsWorktreeBranch}
      wsWorktreeSetupOutput={wsWorktreeSetupOutput}
      wsWorktreeError={wsWorktreeError}
      onRetryWorktreeSetup={onRetryWorktreeSetup}
      hideWorktreeSetup={hideEmbeddedWorktreeSetup}
    />
  );
}

function StandardFeatureTopBar({
  featureId,
  projectId,
  mode = "feature",
  className,
  wsWorktreeStatus,
  wsWorktreeBranch,
  wsWorktreeSetupOutput,
  wsWorktreeError,
  onRetryWorktreeSetup,
  showCustomActions = true,
  showSidebarChrome = true,
  draggable = true,
  titleOverride,
}: FeatureTopBarProps): ReactElement | null {
  const isSession = mode === "session";
  const { collapsed: sidebarCollapsed, setCollapsed: setSidebarCollapsed } = useSidebarCollapsed();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { data: feature } = useGetFeature(featureId);
  // Live WS-pushed title from auto-naming (falls back to null).
  const { title: wsTitle, isAutoNaming } = useFeatureTitle(featureId);
  useFeatureSettingsShortcuts(isSession, setSettingsOpen);

  const title = wsTitle ?? feature?.title ?? titleOverride;

  if (!feature) return null;

  return (
    <FeatureHeaderChrome
      featureId={featureId}
      projectId={projectId}
      className={className}
      featureTitle={title ?? feature.title}
      featureStatus={feature.status as FeatureStatus}
      isSession={isSession}
      isAutoNaming={isAutoNaming}
      draggable={draggable}
      showCustomActions={showCustomActions}
      showSidebarChrome={showSidebarChrome}
      sidebarCollapsed={sidebarCollapsed}
      onExpandSidebar={() => setSidebarCollapsed(false)}
      settingsOpen={settingsOpen}
      onSettingsOpenChange={setSettingsOpen}
      wsWorktreeStatus={wsWorktreeStatus}
      wsWorktreeBranch={wsWorktreeBranch}
      wsWorktreeSetupOutput={wsWorktreeSetupOutput}
      wsWorktreeError={wsWorktreeError}
      onRetryWorktreeSetup={onRetryWorktreeSetup}
    />
  );
}

interface FeatureHeaderChromeProps {
  featureId: number;
  projectId: number;
  className?: string;
  featureTitle: string;
  featureStatus: FeatureStatus;
  isSession: boolean;
  isAutoNaming: boolean;
  draggable: boolean;
  showCustomActions: boolean;
  showSidebarChrome: boolean;
  sidebarCollapsed: boolean;
  onExpandSidebar: () => void;
  settingsOpen: boolean;
  onSettingsOpenChange: Dispatch<SetStateAction<boolean>>;
  wsWorktreeStatus?: WorktreeStatus;
  wsWorktreeBranch?: string | null;
  wsWorktreeSetupOutput?: string[];
  wsWorktreeError?: string | null;
  onRetryWorktreeSetup?: () => void;
}

function FeatureHeaderChrome({
  featureId,
  projectId,
  className,
  featureTitle,
  featureStatus,
  isSession,
  isAutoNaming,
  draggable,
  showCustomActions,
  showSidebarChrome,
  sidebarCollapsed,
  onExpandSidebar,
  settingsOpen,
  onSettingsOpenChange,
  wsWorktreeStatus,
  wsWorktreeBranch,
  wsWorktreeSetupOutput,
  wsWorktreeError,
  onRetryWorktreeSetup,
}: FeatureHeaderChromeProps): ReactElement {
  return (
    <>
      <div
        onMouseDown={draggable ? startDragging : undefined}
        onDoubleClick={draggable ? toggleMaximize : undefined}
        className={cn("flex items-center gap-3 px-6 py-3", className)}
      >
        {showSidebarChrome && sidebarCollapsed && (
          <SidebarCollapsedChrome onExpand={onExpandSidebar} />
        )}
        {!isSession && (
          <Badge variant="secondary" className={STATUS_COLORS[featureStatus] ?? ""}>
            {featureStatus}
          </Badge>
        )}
        <ProjectColorDot projectId={projectId} className="size-2.5" />
        {isAutoNaming ? (
          <Skeleton className="h-5 w-40" />
        ) : (
          <h1 className="text-lg font-semibold">{featureTitle}</h1>
        )}
        <div className="flex-1" />
        {showCustomActions && <CustomActionsBar featureId={featureId} projectId={projectId} />}
        {!isSession && (
          <FeatureSettingsPopover
            featureId={featureId}
            projectId={projectId}
            open={settingsOpen}
            onOpenChange={onSettingsOpenChange}
          />
        )}
      </div>
      <WorktreeSetupSection
        featureId={featureId}
        projectId={projectId}
        wsWorktreeStatus={wsWorktreeStatus}
        wsWorktreeBranch={wsWorktreeBranch}
        wsWorktreeSetupOutput={wsWorktreeSetupOutput}
        wsWorktreeError={wsWorktreeError}
        onRetrySetup={onRetryWorktreeSetup}
      />
    </>
  );
}

interface FeatureSettingsPopoverProps {
  featureId: number;
  projectId: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function FeatureSettingsPopover({
  featureId,
  projectId,
  open,
  onOpenChange,
}: FeatureSettingsPopoverProps): ReactElement {
  const queryClient = useQueryClient();
  const setAutonomyLevel = useWorkflowStore((s) => s.setAutonomyLevel);
  const setParallelExecution = useWorkflowStore((s) => s.setParallelExecution);
  const { data: featureSettingsData } = useGetFeatureSettings(featureId);
  const featureSettings = featureSettingsData
    ? Object.fromEntries(featureSettingsData.map((s) => [s.key, s.value]))
    : {};
  const setFeatureSetting = useSetFeatureSetting({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetFeatureSettingsQueryKey(featureId) });
        toast.success("Settings saved");
      },
    },
  });
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="size-7" title="Feature settings">
          <SettingsIcon className="size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[820px] max-w-[calc(100vw-2rem)]" align="end">
        <div className="space-y-4">
          <ModelSelector level="feature" featureId={featureId} projectId={projectId} />
          <AutonomySettings
            featureId={featureId}
            value={featureSettings.agent_autonomy ?? ""}
            onSaved={(value) => setAutonomyLevel(Number(value) as AutonomyLevel)}
            mutate={setFeatureSetting.mutate}
          />
          <ParallelExecutionSettings
            featureId={featureId}
            enabled={
              (featureSettings.parallel_execution ?? "") === "true" ||
              featureSettings.parallel_execution == null
            }
            onSaved={setParallelExecution}
            mutate={setFeatureSetting.mutate}
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}

interface SettingMutation {
  (variables: { id: number; data: { key: string; value: string } }): void;
}

function AutonomySettings({
  featureId,
  value,
  onSaved,
  mutate,
}: {
  featureId: number;
  value: string;
  onSaved: (value: string) => void;
  mutate: SettingMutation;
}): ReactElement {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5">
        <BrainCircuitIcon className="size-3.5 text-muted-foreground" />
        <span className="text-xs font-medium">Agent Autonomy</span>
      </div>
      <Select
        value={value}
        onValueChange={(nextValue) => {
          mutate({ id: featureId, data: { key: "agent_autonomy", value: nextValue } });
          onSaved(nextValue);
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
  );
}

function ParallelExecutionSettings({
  featureId,
  enabled,
  onSaved,
  mutate,
}: {
  featureId: number;
  enabled: boolean;
  onSaved: (enabled: boolean) => void;
  mutate: SettingMutation;
}): ReactElement {
  return (
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
        checked={enabled}
        onCheckedChange={(checked) => {
          mutate({
            id: featureId,
            data: { key: "parallel_execution", value: checked ? "true" : "false" },
          });
          onSaved(checked);
        }}
      />
    </div>
  );
}

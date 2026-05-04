import { useState, type Dispatch, type ReactElement, type SetStateAction } from "react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { useGetFeature } from "@/api/generated";
import { CustomActionsBar } from "./CustomActionsBar";
import { EmbeddedSessionHeader } from "./FeatureTopBarEmbedded";
import { GitActionButton } from "./git-actions/GitActionButton";
import { BranchChip } from "./branch-chip/BranchChip";
import { FeatureSettingsPopover } from "./FeatureSettingsPopover";
import { Skeleton } from "@/components/ui/skeleton";
import { useFeatureTitle } from "@/hooks/useFeatureTitle";
import type { WorktreeStatus } from "@/types/workflow";
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

        {/*
         * Git header controls render in BOTH `feature` and `session` modes.
         * The session view drives the same `useGitStatusStore` (via
         * `useGitStatusSubscription` in `ws-session.$sessionId.tsx`), so the
         * commit / push / open-PR action and the current → target chip are
         * just as relevant there as in the workflow view.
         */}
        <GitActionButton featureId={featureId} />
        <BranchChip featureId={featureId} projectId={projectId} />

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

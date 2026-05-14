import { useRef, useState, type Dispatch, type ReactElement, type SetStateAction } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useAutoNameFeature, useGetFeature } from "@/api/generated";
import { CustomActionsBar } from "./CustomActionsBar";
import { EmbeddedSessionHeader } from "./FeatureTopBarEmbedded";
import { GitActionButton } from "./git-actions/GitActionButton";
import { BranchChip } from "./branch-chip/BranchChip";
import { FeatureSettingsPopover } from "./FeatureSettingsPopover";
import { FeatureLabelChip } from "@/components/FeatureLabelChip";
import { Skeleton } from "@/components/ui/skeleton";
import { useFeatureTitle } from "@/hooks/useFeatureTitle";
import type { WorktreeStatus } from "@/types/workflow";
import { WorktreeSetupSection } from "./WorktreeSetupSection";
import { ProjectColorDot } from "@/hooks/useProjectColor";
import { useSidebarCollapsed } from "@/components/SidebarContext";
import { SidebarCollapsedChrome } from "@/components/SidebarCollapsedChrome";
import { useFeatureSettingsShortcuts } from "./useFeatureSettingsShortcuts";
import { apiErrorMessage } from "@/lib/api-errors";
import { copyToClipboard } from "@/lib/clipboard";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { FeatureRenameForm } from "./FeatureRenamePopover";

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
  labelOverride?: string | null;
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
  labelOverride,
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
      label={labelOverride}
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
  labelOverride,
}: FeatureTopBarProps): ReactElement | null {
  const isSession = mode === "session";
  const { collapsed: sidebarCollapsed, setCollapsed: setSidebarCollapsed } = useSidebarCollapsed();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { data: feature } = useGetFeature(featureId);
  // Live WS-pushed title from auto-naming (falls back to null).
  const { title: wsTitle, isAutoNaming } = useFeatureTitle(featureId);
  useFeatureSettingsShortcuts(isSession, setSettingsOpen);

  const title = wsTitle ?? feature?.title ?? titleOverride;
  const autoNameMutation = useAutoNameFeature({
    mutation: {
      onError: (error) => {
        toast.error(apiErrorMessage(error, "Auto-rename failed"));
      },
    },
  });

  if (!feature) return null;
  // Auto-rename is allowed even when the title is still default ("Session N",
  // "Untitled Feature") — that's exactly the case where the implicit naming
  // silently failed and the user wants to retry from the title context menu.
  const canAutoRename = title != null;
  const handleAutoRename = (): void => {
    if (autoNameMutation.isPending) return;
    autoNameMutation.mutate({ id: featureId });
  };

  return (
    <FeatureHeaderChrome
      featureId={featureId}
      projectId={projectId}
      className={className}
      featureTitle={title ?? feature.title}
      featureLabel={labelOverride !== undefined ? labelOverride : feature.label}
      isSession={isSession}
      isAutoNaming={isAutoNaming || autoNameMutation.isPending}
      canAutoRename={canAutoRename}
      isAutoRenamePending={autoNameMutation.isPending}
      onAutoRename={handleAutoRename}
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
  featureLabel?: string | null;
  isSession: boolean;
  isAutoNaming: boolean;
  canAutoRename: boolean;
  isAutoRenamePending: boolean;
  onAutoRename: () => void;
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
  featureLabel,
  isSession,
  isAutoNaming,
  canAutoRename,
  isAutoRenamePending,
  onAutoRename,
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
        className={cn(draggable && "titlebar-drag", "flex items-center gap-3 px-6 py-3", className)}
      >
        {showSidebarChrome && sidebarCollapsed && (
          <SidebarCollapsedChrome onExpand={onExpandSidebar} />
        )}
        <ProjectColorDot projectId={projectId} className="size-2.5" />
        {isAutoNaming ? (
          <Skeleton className="h-5 w-40" />
        ) : (
          <FeatureTitleMenu
            featureId={featureId}
            title={featureTitle}
            canAutoRename={canAutoRename}
            isAutoRenamePending={isAutoRenamePending}
            onAutoRename={onAutoRename}
          />
        )}
        <FeatureLabelChip label={featureLabel} />
        <div className="flex-1" />
        {showCustomActions && <CustomActionsBar featureId={featureId} projectId={projectId} />}

        {/*
         * Git header controls render in BOTH `feature` and `session` modes.
         * The session view drives the same `useGitStatusStore` (via
         * `useGitStatusSubscription` in `ws-session.$sessionId.tsx`), so the
         * commit / push / open-PR action and the current → target chip are
         * relevant there too.
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

interface FeatureTitleMenuProps {
  featureId: number;
  title: string;
  canAutoRename: boolean;
  isAutoRenamePending: boolean;
  onAutoRename: () => void;
}

function FeatureTitleMenu({
  featureId,
  title,
  canAutoRename,
  isAutoRenamePending,
  onAutoRename,
}: FeatureTitleMenuProps): ReactElement {
  const [renameOpen, setRenameOpen] = useState(false);
  // Track whether the popover was just opened via the context menu so we can
  // suppress the stale pointer event that Radix fires during menu teardown.
  const suppressNextOutsideRef = useRef(false);

  const handleCopy = (): void => {
    void copyToClipboard(title, "Copied feature name");
  };

  // Radix DismissableLayer race: defer popover mount past menu teardown, then
  // suppress the first onInteractOutside because the menu close sequence
  // dispatches a synthetic pointerup that arrives even after the timeout.
  const handleRenameSelect = (): void => {
    setTimeout(() => {
      suppressNextOutsideRef.current = true;
      setRenameOpen(true);
    }, 0);
  };

  const handleInteractOutside = (e: Event): void => {
    if (suppressNextOutsideRef.current) {
      suppressNextOutsideRef.current = false;
      e.preventDefault();
    }
  };

  // Compose ContextMenuTrigger + PopoverAnchor on the same heading so the
  // popover appears in-place. Double-click is a power-user shortcut; the
  // context menu is the discoverable affordance.
  return (
    <Popover open={renameOpen} onOpenChange={setRenameOpen}>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <PopoverAnchor asChild>
            <h1
              className="cursor-default text-lg font-semibold"
              onDoubleClick={() => setRenameOpen(true)}
            >
              {title}
            </h1>
          </PopoverAnchor>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onSelect={handleCopy}>Copy</ContextMenuItem>
          <ContextMenuItem onSelect={handleRenameSelect}>Rename…</ContextMenuItem>
          {canAutoRename && (
            <ContextMenuItem disabled={isAutoRenamePending} onSelect={onAutoRename}>
              Auto-rename
            </ContextMenuItem>
          )}
        </ContextMenuContent>
      </ContextMenu>
      <PopoverContent align="start" className="w-80" onInteractOutside={handleInteractOutside}>
        <FeatureRenameForm
          featureId={featureId}
          currentTitle={title}
          open={renameOpen}
          onClose={() => setRenameOpen(false)}
        />
      </PopoverContent>
    </Popover>
  );
}

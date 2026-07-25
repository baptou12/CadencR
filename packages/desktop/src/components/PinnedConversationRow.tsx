import { memo, useCallback, useRef, type ReactElement } from "react";
import { PinOffIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ProjectBadge } from "@/components/ProjectBadge";
import { useFeaturePrefetch } from "@/hooks/useFeaturePrefetch";
import { useFeatureStatus } from "@/stores/session-status-selectors";
import { useFeatureTitle } from "@/hooks/useFeatureTitle";
import { useIsFeatureUnread } from "@/stores/unread-store";
import { shouldIgnoreFeatureRowKeyDown } from "@/components/ProjectFeatureRow";
import { FeatureRowStatusIcon } from "@/components/ProjectFeatureRowParts";
import { SidebarProviderBadge } from "@/components/SidebarProviderBadge";
import type { Feature } from "@/api/generated";

interface PinnedConversationRowProps {
  feature: Feature;
  activeFeatureId: number | null;
  onNavigate: (feature: Feature) => void;
  onUnpin: (featureId: number) => void;
}

/**
 * A single row in the global "Pinned" section above the project list. Leaner
 * than {@link ProjectFeatureRow} — pinned rows exist for quick access, so they
 * drop label editing, git stats, and worktree affordances. The project color
 * dot is the cross-project recognition cue (rows from different projects sit
 * together here). Memoized + self-subscribed to its own live title/status via
 * narrow per-feature selectors, so a WS push for one conversation re-renders
 * only that row, not the whole section. The parent passes stable callbacks.
 */
export const PinnedConversationRow = memo(function PinnedConversationRow({
  feature,
  activeFeatureId,
  onNavigate,
  onUnpin,
}: PinnedConversationRowProps): ReactElement {
  const navRef = useRef<HTMLDivElement>(null);
  const { status: liveStatus } = useFeatureStatus(feature.id);
  const { title: liveTitle, isAutoNaming } = useFeatureTitle(feature.id);
  const isUnread = useIsFeatureUnread(feature.id);
  const isActive = activeFeatureId === feature.id;
  const prefetchFeature = useFeaturePrefetch(feature.id, feature.project_id);
  const handleOpenConversation = useCallback((): void => {
    onNavigate(feature);
  }, [feature, onNavigate]);

  return (
    <div
      ref={navRef}
      role="button"
      tabIndex={0}
      data-nav-item
      data-nav-type="feature"
      data-nav-id={String(feature.id)}
      data-nav-project-id={String(feature.project_id)}
      className={`group/pinned relative flex min-w-0 cursor-pointer items-center gap-1.5 rounded-md py-1.5 pl-2 pr-1.5 text-sm outline-none hover:bg-sidebar-accent ${
        isActive ? "bg-sidebar-accent" : ""
      }`}
      onClick={(e) => {
        if (isActive || e.detail > 1) return;
        onNavigate(feature);
      }}
      onMouseEnter={prefetchFeature}
      onFocus={prefetchFeature}
      onKeyDown={(e) => {
        if (shouldIgnoreFeatureRowKeyDown(e.target)) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onNavigate(feature);
        }
      }}
    >
      <ProjectBadge projectId={feature.project_id} />

      <FeatureRowStatusIcon
        featureId={feature.id}
        liveStatus={liveStatus}
        isActive={isActive}
        isUnread={isUnread}
        onOpenConversation={handleOpenConversation}
      />

      <SidebarProviderBadge
        providerId={feature.runtime_provider}
        modelId={feature.model_session}
        thinkingEffort={feature.thinking_effort}
      />

      {isAutoNaming ? (
        <Skeleton className="h-4 w-32 min-w-0 flex-1" />
      ) : (
        <span className="min-w-0 flex-1 truncate">{liveTitle ?? feature.title}</span>
      )}

      <Button
        size="sm"
        variant="ghost"
        aria-pressed={true}
        className="size-6 shrink-0 p-0 text-foreground transition-none hover:text-foreground"
        onClick={(e) => {
          e.stopPropagation();
          onUnpin(feature.id);
        }}
      >
        <PinOffIcon className="size-3.5" />
        <span className="sr-only">Unpin</span>
      </Button>
    </div>
  );
});

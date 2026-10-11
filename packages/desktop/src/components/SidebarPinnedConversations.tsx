import { useCallback, useMemo, useRef, type ReactElement } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { PinIcon } from "lucide-react";
import { toast } from "sonner";
import {
  useListPinnedFeatures,
  useListProjects,
  useUpdateFeaturePinned,
  type Feature,
  type FeatureWorktreeInfo,
  type Project,
} from "@/api/generated";
import { PinnedConversationRow } from "@/components/PinnedConversationRow";
import { wsSessionIdFromFeature } from "@/lib/ws-session-id";
import { getFocusedTabForFeature } from "@/lib/feature-focus-handoff";
import { invalidateByUrlPrefix } from "@/lib/queryClient";
import { apiErrorMessage } from "@/lib/api-errors";
import { useReorderAnimation } from "@/hooks/useReorderAnimation";
import { useStableFeatureOrder } from "@/hooks/useStableFeatureOrder";
import { NO_PORTS, useFeaturePorts } from "@/hooks/useFeaturePorts";
import { usePinnedActivity } from "@/hooks/usePinnedActivity";
import { useLiveFeatureMeta } from "@/hooks/useLiveFeatureMeta";
import { featureMatchesSidebarFilter, sidebarFilterTerms } from "@/lib/sidebar-filter";
import { useSidebarFilterQuery } from "@/stores/sidebar-filter-store";

/**
 * Global "Pinned" section rendered above the project list. Pinning is a
 * feature-level concept (`features.is_pinned`), so a single backend query
 * returns every pinned conversation across all projects — each row carries its
 * project color dot so the user can tell them apart at a glance. Renders
 * nothing when no conversation is pinned.
 *
 * Unpinning here and pinning from a project row both write the same column and
 * invalidate the `/api/features` cache prefix (which covers this list); there
 * is no optimistic state — the section re-renders from the refetched data.
 */
const EMPTY_FEATURES: Feature[] = [];

export function SidebarPinnedConversations({
  activeFeatureId,
  onSelectFeature,
}: {
  activeFeatureId: number | null;
  onSelectFeature: (featureId: number) => void;
}): ReactElement | null {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: fetchedPinned = EMPTY_FEATURES } = useListPinnedFeatures();
  const orderedPinned = useStableFeatureOrder(fetchedPinned);
  const activity = usePinnedActivity(fetchedPinned);
  const pinnedFeatures = useFilteredPinned(orderedPinned, activity.worktreeByFeatureId);
  const listRef = useRef<HTMLDivElement>(null);
  const pinnedIds = useMemo(() => pinnedFeatures.map((feature) => feature.id), [pinnedFeatures]);
  useReorderAnimation(listRef, pinnedIds);
  const { data: projects = [] } = useListProjects();
  const portsByFeatureId = useFeaturePorts();

  const projectsById = useMemo(() => {
    const map = new Map<number, Project>();
    for (const project of projects) map.set(project.id, project);
    return map;
  }, [projects]);

  // Keep navigation stable across active-row changes: read the live active id
  // through a ref so the click handler's identity doesn't churn every render.
  const activeFeatureIdRef = useRef(activeFeatureId);
  activeFeatureIdRef.current = activeFeatureId;

  const handleNavigate = useCallback(
    (feature: Feature): void => {
      const project = projectsById.get(feature.project_id);
      if (!project) return;
      onSelectFeature(feature.id);
      const focusTab = getFocusedTabForFeature(activeFeatureIdRef.current);
      void navigate({
        to: "/ws-session/$sessionId",
        params: { sessionId: wsSessionIdFromFeature(feature.id) },
        search: focusTab
          ? { cwd: project.path, featureId: feature.id, projectId: project.id, focusTab }
          : { cwd: project.path, featureId: feature.id, projectId: project.id },
      });
    },
    [navigate, projectsById, onSelectFeature],
  );

  const { mutate: updateFeaturePinned } = useUpdateFeaturePinned({
    mutation: {
      onSuccess: () => void invalidateByUrlPrefix(queryClient, "/api/features"),
      onError: (error) => {
        toast.error(apiErrorMessage(error, "Failed to update pinned state"));
      },
    },
  });

  const handleUnpin = useCallback(
    (featureId: number): void => {
      updateFeaturePinned({ id: featureId, data: { pinned: false } });
    },
    [updateFeaturePinned],
  );

  if (pinnedFeatures.length === 0) return null;

  return (
    <div ref={listRef} className="mb-2 flex shrink-0 flex-col gap-0.5 px-1">
      <div className="flex items-center gap-1.5 px-2 pb-0.5 pt-1 text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
        <PinIcon className="size-3 shrink-0" />
        <span>Pinned</span>
      </div>
      {pinnedFeatures.map((feature) => (
        <PinnedConversationRow
          key={feature.id}
          feature={feature}
          activeFeatureId={activeFeatureId}
          ports={portsByFeatureId.get(feature.id) ?? NO_PORTS}
          shellCount={activity.shellCountByFeatureId.get(feature.id) ?? 0}
          hasLiveWorktree={activity.liveWorktreeFeatureIds.has(feature.id)}
          worktree={activity.worktreeByFeatureId.get(feature.id)}
          onNavigate={handleNavigate}
          onUnpin={handleUnpin}
        />
      ))}
    </div>
  );
}

/** The pinned rows the sidebar filter keeps (all of them when it is off). */
function useFilteredPinned(
  pinned: readonly Feature[],
  worktreeByFeatureId: ReadonlyMap<number, FeatureWorktreeInfo>,
): readonly Feature[] {
  const query = useSidebarFilterQuery();
  // Live titles only matter to the filter: no stream subscription while it is off.
  const liveMeta = useLiveFeatureMeta(query !== "");
  return useMemo(() => {
    if (!query) return pinned;
    const terms = sidebarFilterTerms(query);
    return pinned.filter((feature) =>
      featureMatchesSidebarFilter(terms, feature, liveMeta, worktreeByFeatureId.get(feature.id)),
    );
  }, [liveMeta, pinned, query, worktreeByFeatureId]);
}

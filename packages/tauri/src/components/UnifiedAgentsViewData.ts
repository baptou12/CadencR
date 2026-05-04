import { useCallback, useMemo } from "react";
import { useGetUnifiedAgents, type UnifiedAgentEntry } from "@/api/generated";
import { toUnifiedAgentsQueryParams } from "@/components/UnifiedAgentsFilterState";
import type { UnifiedAgentsFilterMode } from "@/components/UnifiedAgentsFilters";
import { parseUTCDateTime } from "@/lib/date-utils";

interface UseUnifiedAgentsDataArgs {
  mode: UnifiedAgentsFilterMode;
  freshMinutes: number;
  projectId: number | null;
  query: string;
}

export interface UnifiedAgentsData {
  agents: UnifiedAgentEntry[];
  countedAgents: UnifiedAgentEntry[];
  projectCounts: Record<number, number>;
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
  errorMessage: string;
  refresh: () => void;
}

export function useUnifiedAgentsData({
  mode,
  freshMinutes,
  projectId,
  query,
}: UseUnifiedAgentsDataArgs): UnifiedAgentsData {
  const baseQueryParams = useMemo(
    () => toUnifiedAgentsQueryParams({ mode, freshMinutes }, 100),
    [freshMinutes, mode],
  );
  const {
    data: agentsData,
    isLoading,
    isFetching: agentsFetching,
    isError,
    error,
    refetch: refetchAgents,
  } = useGetUnifiedAgents(
    { ...baseQueryParams, project_id: projectId ?? undefined },
    { query: { refetchInterval: mode === "recent" ? 2_000 : 10_000, staleTime: 0 } },
  );
  const {
    data: countsData,
    isFetching: countsFetching,
    refetch: refetchCounts,
  } = useGetUnifiedAgents(
    { ...baseQueryParams, message_limit: 1 },
    {
      query: {
        enabled: projectId !== null,
        refetchInterval: mode === "recent" ? 2_000 : 10_000,
        staleTime: 0,
      },
    },
  );
  const queryText = query.trim().toLowerCase();
  const rawAgents = agentsData?.agents ?? [];
  const countAgents = projectId === null ? rawAgents : (countsData?.agents ?? []);
  const agents = useMemo(
    () => orderUnifiedAgentsForDisplay(rawAgents, { mode, freshMinutes, projectId, queryText }),
    [freshMinutes, mode, projectId, queryText, rawAgents],
  );
  const countedAgents = useMemo(
    () =>
      getUnifiedAgentsMatchingFilters(countAgents, {
        mode,
        freshMinutes,
        projectId: null,
        queryText,
      }),
    [countAgents, freshMinutes, mode, queryText],
  );
  const projectCounts = useMemo(() => countByProject(countedAgents), [countedAgents]);
  const refresh = useCallback((): void => {
    void refetchAgents();
    if (projectId !== null) void refetchCounts();
  }, [projectId, refetchAgents, refetchCounts]);

  return useMemo<UnifiedAgentsData>(
    () => ({
      agents,
      countedAgents,
      projectCounts,
      isLoading,
      isFetching: agentsFetching || countsFetching,
      isError,
      errorMessage: error instanceof Error ? error.message : "Failed to load agents",
      refresh,
    }),
    [
      agents,
      agentsFetching,
      countedAgents,
      countsFetching,
      error,
      isError,
      isLoading,
      projectCounts,
      refresh,
    ],
  );
}

export function filterUnifiedAgents(
  entries: UnifiedAgentEntry[],
  query: string,
): UnifiedAgentEntry[] {
  if (!query) return entries;
  return entries.filter((entry) => matchesAgentQuery(entry, query));
}

export interface UnifiedAgentFilterArgs {
  mode: UnifiedAgentsFilterMode;
  freshMinutes: number;
  projectId: number | null;
  queryText: string;
}

export function orderUnifiedAgentsForDisplay(
  entries: UnifiedAgentEntry[],
  filters: UnifiedAgentFilterArgs,
): UnifiedAgentEntry[] {
  if (hasNoActiveFilter(filters)) {
    return pinFirst(entries.filter(isVisibleAgent));
  }
  const { matching, pinnedExtras } = splitAgentsByFilterVisibility(entries, filters);
  const orderedMatches = filters.queryText.length === 0 ? pinFirst(matching) : matching;
  return [...orderedMatches, ...pinnedExtras];
}

export function getUnifiedAgentsMatchingFilters(
  entries: UnifiedAgentEntry[],
  filters: UnifiedAgentFilterArgs,
): UnifiedAgentEntry[] {
  const { matching, pinnedExtras } = splitAgentsByFilterVisibility(entries, filters);
  return [...matching, ...pinnedExtras];
}

function hasNoActiveFilter(filters: UnifiedAgentFilterArgs): boolean {
  return filters.mode === "all" && filters.projectId === null && filters.queryText.length === 0;
}

function matchesCurrentFilters(entry: UnifiedAgentEntry, filters: UnifiedAgentFilterArgs): boolean {
  if (!isVisibleAgent(entry)) return false;
  if (filters.projectId !== null && entry.project.id !== filters.projectId) return false;
  if (filters.queryText && !matchesAgentQuery(entry, filters.queryText)) return false;
  if (filters.mode === "recent") return isFreshOrActive(entry, filters.freshMinutes);
  return true;
}

function splitAgentsByFilterVisibility(
  entries: UnifiedAgentEntry[],
  filters: UnifiedAgentFilterArgs,
): { matching: UnifiedAgentEntry[]; pinnedExtras: UnifiedAgentEntry[] } {
  const matching = entries.filter((entry) => matchesCurrentFilters(entry, filters));
  const matchingIds = new Set(matching.map(agentKey));
  const pinnedExtras = entries.filter((entry) => isPinnedExtra(entry, matchingIds));
  return { matching, pinnedExtras };
}

function isPinnedExtra(entry: UnifiedAgentEntry, matchingIds: Set<string>): boolean {
  return entry.is_pinned && isVisibleAgent(entry) && !matchingIds.has(agentKey(entry));
}

function isVisibleAgent(entry: UnifiedAgentEntry): boolean {
  return entry.feature.status !== "archived";
}

function isFreshOrActive(entry: UnifiedAgentEntry, freshMinutes: number): boolean {
  if (entry.session.status === "running") return true;
  if (
    entry.session.pendingQuestions ||
    entry.session.pendingPermission ||
    entry.session.pendingPlanApproval ||
    entry.session.pendingPrdApproval
  ) {
    return true;
  }
  const activityTime = entry.last_activity_at
    ? parseUTCDateTime(entry.last_activity_at).getTime()
    : NaN;
  if (!Number.isFinite(activityTime)) return false;
  return Date.now() - activityTime <= Math.max(1, freshMinutes) * 60_000;
}

function pinFirst(entries: UnifiedAgentEntry[]): UnifiedAgentEntry[] {
  const pinned: UnifiedAgentEntry[] = [];
  const unpinned: UnifiedAgentEntry[] = [];
  for (const entry of entries) {
    if (entry.is_pinned) pinned.push(entry);
    else unpinned.push(entry);
  }
  return [...pinned, ...unpinned];
}

function agentKey(entry: UnifiedAgentEntry): string {
  return String(entry.session.sessionDbId);
}

export function countRunningAgents(entries: UnifiedAgentEntry[]): number {
  return entries.reduce((count, entry) => count + (entry.session.status === "running" ? 1 : 0), 0);
}

function matchesAgentQuery(entry: UnifiedAgentEntry, query: string): boolean {
  return [
    entry.feature.title,
    entry.project.name,
    entry.session.agentType,
    entry.session.phaseTitle ?? "",
  ]
    .join(" ")
    .toLowerCase()
    .includes(query);
}

function countByProject(entries: UnifiedAgentEntry[]): Record<number, number> {
  const counts: Record<number, number> = {};
  for (const entry of entries) {
    counts[entry.project.id] = (counts[entry.project.id] ?? 0) + 1;
  }
  return counts;
}

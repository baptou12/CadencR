import { useCallback, useMemo } from "react";
import { useGetUnifiedAgents, type UnifiedAgentEntry } from "@/api/generated";
import {
  toUnifiedAgentsQueryParams,
  type UnifiedAgentsSortOrder,
} from "@/components/UnifiedAgentsFilterState";
import type { UnifiedAgentsFilterMode } from "@/components/UnifiedAgentsFilters";
import { parseUTCDateTime } from "@/lib/date-utils";

interface UseUnifiedAgentsDataArgs {
  mode: UnifiedAgentsFilterMode;
  freshMinutes: number;
  projectIds: number[];
  query: string;
  sortOrder: UnifiedAgentsSortOrder;
}

export interface UnifiedAgentsData {
  agents: UnifiedAgentEntry[];
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
  errorMessage: string;
  refresh: () => void;
}

export const UNIFIED_AGENTS_QUERY_OPTIONS = {
  staleTime: Infinity,
  refetchOnMount: false,
  refetchOnReconnect: false,
  refetchOnWindowFocus: false,
} as const;

export function useUnifiedAgentsData({
  mode,
  freshMinutes,
  projectIds,
  query,
  sortOrder,
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
  } = useGetUnifiedAgents(baseQueryParams, { query: UNIFIED_AGENTS_QUERY_OPTIONS });
  const queryText = query.trim().toLowerCase();
  const rawAgents = agentsData?.agents ?? [];
  const agents = useMemo(
    () =>
      orderUnifiedAgentsForDisplay(rawAgents, {
        mode,
        freshMinutes,
        projectIds,
        queryText,
        sortOrder,
      }),
    [freshMinutes, mode, projectIds, queryText, rawAgents, sortOrder],
  );
  const refresh = useCallback((): void => {
    void refetchAgents();
  }, [refetchAgents]);

  return useMemo<UnifiedAgentsData>(
    () => ({
      agents,
      isLoading,
      isFetching: agentsFetching,
      isError,
      errorMessage: error instanceof Error ? error.message : "Failed to load agents",
      refresh,
    }),
    [agents, agentsFetching, error, isError, isLoading, refresh],
  );
}

export interface UnifiedAgentMatchFilters {
  mode: UnifiedAgentsFilterMode;
  freshMinutes: number;
  projectIds: number[];
  queryText: string;
}

export interface UnifiedAgentFilterArgs extends UnifiedAgentMatchFilters {
  sortOrder: UnifiedAgentsSortOrder;
}

export function orderUnifiedAgentsForDisplay(
  entries: UnifiedAgentEntry[],
  filters: UnifiedAgentFilterArgs,
): UnifiedAgentEntry[] {
  if (hasNoActiveFilter(filters)) {
    return pinFirst(entries.filter(isVisibleAgent), filters.sortOrder);
  }
  const { matching, pinnedExtras } = splitAgentsByFilterVisibility(entries, filters);
  const orderedMatches =
    filters.queryText.length === 0
      ? pinFirst(matching, filters.sortOrder)
      : sortAgentsForDisplay(matching, filters.sortOrder);
  return [...orderedMatches, ...sortAgentsForDisplay(pinnedExtras, filters.sortOrder)];
}

export function getUnifiedAgentsMatchingFilters(
  entries: UnifiedAgentEntry[],
  filters: UnifiedAgentMatchFilters,
): UnifiedAgentEntry[] {
  const { matching, pinnedExtras } = splitAgentsByFilterVisibility(entries, filters);
  return [...matching, ...pinnedExtras];
}

function hasNoActiveFilter(filters: UnifiedAgentMatchFilters): boolean {
  return (
    filters.mode === "all" && filters.projectIds.length === 0 && filters.queryText.length === 0
  );
}

function matchesCurrentFilters(
  entry: UnifiedAgentEntry,
  filters: UnifiedAgentMatchFilters,
): boolean {
  if (!isVisibleAgent(entry)) return false;
  if (filters.projectIds.length > 0 && !filters.projectIds.includes(entry.project.id)) return false;
  if (filters.queryText && !matchesAgentQuery(entry, filters.queryText)) return false;
  if (filters.mode === "recent") return isFreshOrActive(entry, filters.freshMinutes);
  return true;
}

function splitAgentsByFilterVisibility(
  entries: UnifiedAgentEntry[],
  filters: UnifiedAgentMatchFilters,
): { matching: UnifiedAgentEntry[]; pinnedExtras: UnifiedAgentEntry[] } {
  const matching: UnifiedAgentEntry[] = [];
  const pinnedExtras: UnifiedAgentEntry[] = [];
  for (const entry of entries) {
    if (matchesCurrentFilters(entry, filters)) matching.push(entry);
    else if (entry.is_pinned && isVisibleAgent(entry)) pinnedExtras.push(entry);
  }
  return { matching, pinnedExtras };
}

function isVisibleAgent(_entry: UnifiedAgentEntry): boolean {
  return true;
}

function isFreshOrActive(entry: UnifiedAgentEntry, freshMinutes: number): boolean {
  if (entry.session.status === "running") return true;
  if (entry.session.pendingQuestions || entry.session.pendingPermission) return true;
  const activityTime = entry.last_activity_at
    ? parseUTCDateTime(entry.last_activity_at).getTime()
    : NaN;
  if (!Number.isFinite(activityTime)) return false;
  return Date.now() - activityTime <= Math.max(1, freshMinutes) * 60_000;
}

function pinFirst(
  entries: UnifiedAgentEntry[],
  sortOrder: UnifiedAgentsSortOrder,
): UnifiedAgentEntry[] {
  const pinned: UnifiedAgentEntry[] = [];
  const unpinned: UnifiedAgentEntry[] = [];
  for (const entry of sortAgentsForDisplay(entries, sortOrder)) {
    if (entry.is_pinned) pinned.push(entry);
    else unpinned.push(entry);
  }
  return [...pinned, ...unpinned];
}

interface SortableAgentEntry {
  entry: UnifiedAgentEntry;
  createdTime: number;
  activityTime: number;
}

function sortAgentsForDisplay(
  entries: UnifiedAgentEntry[],
  sortOrder: UnifiedAgentsSortOrder,
): UnifiedAgentEntry[] {
  return entries
    .map(toSortableAgentEntry)
    .sort((a, b) => compareSortableAgents(a, b, sortOrder))
    .map((item: SortableAgentEntry): UnifiedAgentEntry => item.entry);
}

function toSortableAgentEntry(entry: UnifiedAgentEntry): SortableAgentEntry {
  const createdTime = agentCreatedTime(entry);
  return {
    entry,
    createdTime,
    activityTime: agentActivityTime(entry, createdTime),
  };
}

function compareSortableAgents(
  a: SortableAgentEntry,
  b: SortableAgentEntry,
  sortOrder: UnifiedAgentsSortOrder,
): number {
  const direction = sortOrder.endsWith("_asc") ? 1 : -1;
  const timeDiff = sortTime(a, sortOrder) - sortTime(b, sortOrder);
  if (timeDiff !== 0) return timeDiff * direction;
  return (a.entry.session.sessionDbId - b.entry.session.sessionDbId) * direction;
}

function sortTime(entry: SortableAgentEntry, sortOrder: UnifiedAgentsSortOrder): number {
  return sortOrder === "activity_asc" || sortOrder === "activity_desc"
    ? entry.activityTime
    : entry.createdTime;
}

function agentActivityTime(entry: UnifiedAgentEntry, fallbackTime: number): number {
  if (!entry.last_activity_at) return fallbackTime;
  const time = parseUTCDateTime(entry.last_activity_at).getTime();
  return Number.isFinite(time) ? time : fallbackTime;
}

function agentCreatedTime(entry: UnifiedAgentEntry): number {
  const time = parseUTCDateTime(entry.agent_created_at).getTime();
  return Number.isFinite(time) ? time : 0;
}

export function countRunningAgents(entries: UnifiedAgentEntry[]): number {
  return entries.reduce((count, entry) => count + (entry.session.status === "running" ? 1 : 0), 0);
}

function matchesAgentQuery(entry: UnifiedAgentEntry, query: string): boolean {
  return entry.feature.title.toLowerCase().includes(query);
}

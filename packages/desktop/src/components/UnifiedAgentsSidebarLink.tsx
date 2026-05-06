import { memo, useMemo, type ReactElement, type ReactNode } from "react";
import { ActivityIcon, BotIcon, LayoutGridIcon, Loader2Icon } from "lucide-react";
import { Link, useRouterState } from "@tanstack/react-router";
import { useGetUnifiedAgents } from "@/api/generated";
import {
  toUnifiedAgentsQueryParams,
  usePersistedUnifiedAgentsFilters,
} from "@/components/UnifiedAgentsFilterState";
import {
  countRunningAgents,
  getUnifiedAgentsMatchingFilters,
  UNIFIED_AGENTS_QUERY_OPTIONS,
} from "@/components/UnifiedAgentsViewData";
import { ShortcutTooltip } from "@/components/ShortcutTooltip";
import { cn } from "@/lib/utils";

export const UnifiedAgentsSidebarLink = memo(function UnifiedAgentsSidebarLink(): ReactElement {
  const filters = usePersistedUnifiedAgentsFilters();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const active = pathname === "/agents";
  const queryParams = useMemo(
    () => toUnifiedAgentsQueryParams(filters, 1),
    [filters.freshMinutes, filters.mode],
  );
  const agentsQuery = useGetUnifiedAgents(queryParams, { query: UNIFIED_AGENTS_QUERY_OPTIONS });
  const matchingAgents = useMemo(
    () =>
      getUnifiedAgentsMatchingFilters(agentsQuery.data?.agents ?? [], {
        mode: filters.mode,
        freshMinutes: filters.freshMinutes,
        projectIds: filters.projectIds,
        queryText: filters.query.trim().toLowerCase(),
      }),
    [
      agentsQuery.data?.agents,
      filters.freshMinutes,
      filters.mode,
      filters.projectIds,
      filters.query,
    ],
  );
  const runningCount = countRunningAgents(matchingAgents);

  return (
    <ShortcutTooltip label="Open unified agents" keys={["cmd", "shift", "R"]} className="w-full">
      <AgentsSidebarAnchor active={active}>
        <LayoutGridIcon className="size-3.5 shrink-0" />
        <span className="min-w-0 flex-1 truncate">Agents</span>
        <SidebarCounters
          loading={agentsQuery.isLoading}
          errored={agentsQuery.isError}
          matchingCount={matchingAgents.length}
          runningCount={runningCount}
        />
      </AgentsSidebarAnchor>
    </ShortcutTooltip>
  );
});

function AgentsSidebarAnchor({
  active,
  children,
}: {
  active: boolean;
  children: ReactNode;
}): ReactElement {
  return (
    <Link
      to="/agents"
      data-nav-item
      data-nav-type="agents"
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none transition-colors",
        "focus-visible:bg-accent focus-visible:outline-none",
        active
          ? "bg-accent/50 text-accent-foreground font-medium"
          : "text-foreground hover:bg-accent/50",
      )}
    >
      {children}
    </Link>
  );
}

function SidebarCounters({
  loading,
  errored,
  matchingCount,
  runningCount,
}: {
  loading: boolean;
  errored: boolean;
  matchingCount: number;
  runningCount: number;
}): ReactElement {
  if (loading) {
    return <Loader2Icon className="size-3 shrink-0 animate-spin text-muted-foreground" />;
  }
  if (errored) {
    return <span className="ml-auto shrink-0 text-[10px] text-destructive">!</span>;
  }
  return (
    <span className="ml-auto inline-flex shrink-0 items-center gap-1.5 font-mono text-[10px] text-muted-foreground">
      <span className="inline-flex items-center gap-0.5">
        <BotIcon className="size-3" />
        <span className="tabular-nums">{matchingCount}</span>
      </span>
      <span className="inline-flex items-center gap-0.5 text-primary">
        <ActivityIcon className="size-3" />
        <span className="tabular-nums">{runningCount}</span>
      </span>
    </span>
  );
}

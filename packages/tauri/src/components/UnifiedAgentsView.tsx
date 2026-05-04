import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
  type RefObject,
} from "react";
import { Loader2Icon } from "lucide-react";
import { useListProjects, type Project } from "@/api/generated";
import {
  UnifiedAgentsFilters,
  type UnifiedAgentsFilterMode,
} from "@/components/UnifiedAgentsFilters";
import { UnifiedAgentsGrid } from "@/components/UnifiedAgentsGrid";
import { useUnifiedAgentsFilterValue } from "@/components/UnifiedAgentsFilterState";
import {
  consumeUnifiedAgentsSearchFocusPending,
  FOCUS_UNIFIED_AGENTS_SEARCH_EVENT,
} from "@/components/unified-agents-events";
import { useUnifiedAgentPinControls } from "@/components/useUnifiedAgentPinControls";
import {
  countRunningAgents,
  useUnifiedAgentsData,
  type UnifiedAgentsData,
} from "@/components/UnifiedAgentsViewData";

export function UnifiedAgentsView(): ReactElement {
  const [mode, setMode] = useUnifiedAgentsFilterValue("mode");
  const [freshMinutes, setFreshMinutes] = useUnifiedAgentsFilterValue("freshMinutes");
  const [agentsPerRow, setAgentsPerRow] = useUnifiedAgentsFilterValue("agentsPerRow");
  const [projectId, setProjectId] = useUnifiedAgentsFilterValue("projectId");
  const [query, setQuery] = useUnifiedAgentsFilterValue("query");
  const [activeSessionId, setActiveSessionId] = useState<number | null>(null);
  const [focusVersion, setFocusVersion] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const projectsQuery = useListProjects();
  const data = useUnifiedAgentsData({ mode, freshMinutes, projectId, query });
  const columns = Math.max(1, Math.min(6, agentsPerRow));
  const activeIndex = resolveActiveIndex(data.agents, activeSessionId);
  const activeAgent = data.agents[activeIndex] ?? null;
  const activePinControls = useUnifiedAgentPinControls(activeAgent, { showProgressToast: true });

  useEffect(() => {
    if (data.agents.length === 0) {
      setActiveSessionId(null);
      return;
    }
    if (
      activeSessionId !== null &&
      data.agents.some((entry) => entry.session.sessionDbId === activeSessionId)
    ) {
      return;
    }
    setActiveSessionId(data.agents[0].session.sessionDbId);
  }, [activeSessionId, data.agents]);

  const focusSearchInput = useCallback((): void => {
    searchInputRef.current?.focus();
    searchInputRef.current?.select();
  }, []);

  useEffect(() => {
    const handleFocusSearch = (): void => focusSearchInput();
    window.addEventListener(FOCUS_UNIFIED_AGENTS_SEARCH_EVENT, handleFocusSearch);
    if (consumeUnifiedAgentsSearchFocusPending()) requestAnimationFrame(focusSearchInput);
    return () => window.removeEventListener(FOCUS_UNIFIED_AGENTS_SEARCH_EVENT, handleFocusSearch);
  }, [focusSearchInput]);

  const focusFirstMatchedAgent = useCallback((): void => {
    if (data.agents.length === 0) return;
    setActiveSessionId(data.agents[0].session.sessionDbId);
    setFocusVersion((current) => current + 1);
  }, [data.agents]);

  const handleKeyDownCapture = useCallback(
    (event: KeyboardEvent<HTMLDivElement>): void => {
      if (isFindShortcut(event)) {
        event.preventDefault();
        event.stopPropagation();
        focusSearchInput();
        return;
      }
      if (isPinShortcut(event)) {
        event.preventDefault();
        event.stopPropagation();
        activePinControls.toggle();
        return;
      }
      if (!event.metaKey || !event.altKey || event.shiftKey || event.ctrlKey) return;
      const direction = directionFromKey(event.key);
      if (!direction) return;
      event.preventDefault();
      event.stopPropagation();
      const next = nextAgentIndex(activeIndex, direction, data.agents.length, columns);
      if (next === activeIndex) return;
      setActiveSessionId(data.agents[next]?.session.sessionDbId ?? null);
      setFocusVersion((current) => current + 1);
    },
    [activeIndex, activePinControls, data.agents, columns, focusSearchInput],
  );

  const handleActivate = useCallback(
    (index: number): void => {
      setActiveSessionId(data.agents[index]?.session.sessionDbId ?? null);
    },
    [data.agents],
  );

  return (
    <div className="flex h-full flex-col bg-background" onKeyDownCapture={handleKeyDownCapture}>
      <UnifiedAgentsHeader
        mode={mode}
        freshMinutes={freshMinutes}
        agentsPerRow={columns}
        projectId={projectId}
        projects={projectsQuery.data ?? []}
        projectsLoading={projectsQuery.isLoading}
        projectsError={projectsQuery.isError ? projectsQuery.error : null}
        agentsCount={data.agents.length}
        runningAgentsCount={countRunningAgents(data.agents)}
        totalCount={data.countedAgents.length}
        projectCounts={data.projectCounts}
        query={query}
        searchInputRef={searchInputRef}
        isFetching={data.isFetching}
        onModeChange={setMode}
        onFreshMinutesChange={setFreshMinutes}
        onAgentsPerRowChange={setAgentsPerRow}
        onProjectIdChange={setProjectId}
        onQueryChange={setQuery}
        onSearchEnter={focusFirstMatchedAgent}
        onRefresh={data.refresh}
      />

      <UnifiedAgentsContent
        data={data}
        columns={columns}
        activeIndex={activeIndex}
        focusVersion={focusVersion}
        onActivate={handleActivate}
      />
    </div>
  );
}

interface UnifiedAgentsContentProps {
  data: UnifiedAgentsData;
  columns: number;
  activeIndex: number;
  focusVersion: number;
  onActivate: (index: number) => void;
}

function UnifiedAgentsContent({
  data,
  columns,
  activeIndex,
  focusVersion,
  onActivate,
}: UnifiedAgentsContentProps): ReactElement {
  if (data.isError) {
    return (
      <div className="flex flex-1 items-center justify-center p-8 text-sm text-destructive">
        {data.errorMessage}
      </div>
    );
  }
  if (data.isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2Icon className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (data.agents.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-8 text-sm text-muted-foreground">
        No agents match this filter.
      </div>
    );
  }
  return (
    <UnifiedAgentsGrid
      agents={data.agents}
      columns={columns}
      activeIndex={activeIndex}
      focusVersion={focusVersion}
      onActivate={onActivate}
    />
  );
}

interface UnifiedAgentsHeaderProps {
  mode: UnifiedAgentsFilterMode;
  freshMinutes: number;
  agentsPerRow: number;
  projectId: number | null;
  projects: Project[];
  projectsLoading: boolean;
  projectsError: unknown;
  agentsCount: number;
  runningAgentsCount: number;
  totalCount: number;
  projectCounts: Record<number, number>;
  query: string;
  searchInputRef: RefObject<HTMLInputElement | null>;
  isFetching: boolean;
  onModeChange: (mode: UnifiedAgentsFilterMode) => void;
  onFreshMinutesChange: (value: number) => void;
  onAgentsPerRowChange: (value: number) => void;
  onProjectIdChange: (projectId: number | null) => void;
  onQueryChange: (query: string) => void;
  onSearchEnter: () => void;
  onRefresh: () => void;
}

function UnifiedAgentsHeader({
  mode,
  freshMinutes,
  agentsPerRow,
  projectId,
  projects,
  projectsLoading,
  projectsError,
  agentsCount,
  runningAgentsCount,
  totalCount,
  projectCounts,
  query,
  searchInputRef,
  isFetching,
  onModeChange,
  onFreshMinutesChange,
  onAgentsPerRowChange,
  onProjectIdChange,
  onQueryChange,
  onSearchEnter,
  onRefresh,
}: UnifiedAgentsHeaderProps): ReactElement {
  return (
    <header className="shrink-0 border-b bg-background px-4 py-3">
      <UnifiedAgentsFilters
        mode={mode}
        freshMinutes={freshMinutes}
        agentsPerRow={agentsPerRow}
        projectId={projectId}
        projects={projects}
        projectsLoading={projectsLoading}
        agentsCount={agentsCount}
        runningAgentsCount={runningAgentsCount}
        totalCount={totalCount}
        projectCounts={projectCounts}
        query={query}
        searchInputRef={searchInputRef}
        isFetching={isFetching}
        onModeChange={onModeChange}
        onFreshMinutesChange={onFreshMinutesChange}
        onAgentsPerRowChange={onAgentsPerRowChange}
        onProjectIdChange={onProjectIdChange}
        onQueryChange={onQueryChange}
        onSearchEnter={onSearchEnter}
        onRefresh={onRefresh}
      />
      {projectsError ? (
        <p className="mt-2 px-1 text-xs text-destructive">
          {projectsError instanceof Error ? projectsError.message : "Failed to load projects."}
        </p>
      ) : null}
    </header>
  );
}

function directionFromKey(key: string): "left" | "right" | "up" | "down" | null {
  if (key === "ArrowLeft") return "left";
  if (key === "ArrowRight") return "right";
  if (key === "ArrowUp") return "up";
  if (key === "ArrowDown") return "down";
  return null;
}

function isFindShortcut(event: KeyboardEvent<HTMLDivElement>): boolean {
  return (
    event.metaKey &&
    event.shiftKey &&
    !event.altKey &&
    !event.ctrlKey &&
    event.key.toLowerCase() === "f"
  );
}

function isPinShortcut(event: KeyboardEvent<HTMLDivElement>): boolean {
  return (
    event.metaKey &&
    event.shiftKey &&
    !event.altKey &&
    !event.ctrlKey &&
    event.key.toLowerCase() === "p"
  );
}

function nextAgentIndex(
  index: number,
  direction: "left" | "right" | "up" | "down",
  total: number,
  columns: number,
): number {
  if (total === 0) return 0;
  if (direction === "left") return Math.max(0, index - 1);
  if (direction === "right") return Math.min(total - 1, index + 1);
  if (direction === "up") return Math.max(0, index - columns);
  return Math.min(total - 1, index + columns);
}

function resolveActiveIndex(
  agents: UnifiedAgentsData["agents"],
  activeSessionId: number | null,
): number {
  if (agents.length === 0) return 0;
  if (activeSessionId === null) return 0;
  const index = agents.findIndex((entry) => entry.session.sessionDbId === activeSessionId);
  return index >= 0 ? index : 0;
}

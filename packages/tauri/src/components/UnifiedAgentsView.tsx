import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactElement,
  type Ref,
  type RefObject,
} from "react";
import { Loader2Icon } from "lucide-react";
import { useListProjects, type Project } from "@/api/generated";
import { UnifiedAgentsFilters } from "@/components/UnifiedAgentsFilters";
import { UnifiedAgentsGrid } from "@/components/UnifiedAgentsGrid";
import { useUnifiedAgentsFilters } from "@/components/UnifiedAgentsFilterState";
import {
  useUnifiedAgentsPerRowSetting,
  type UnifiedAgentsPerRowSetting,
} from "@/components/UnifiedAgentsPerRowSetting";
import {
  parseUnifiedAgentsFilterText,
  serializeUnifiedAgentsFilterText,
} from "@/components/UnifiedAgentsFilterLanguage";
import type { UnifiedAgentsFilterInputHandle } from "@/components/UnifiedAgentsDynamicFilter";
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
  const [filters, setFilters] = useUnifiedAgentsFilters();
  const searchInputRef = useRef<UnifiedAgentsFilterInputHandle>(null);
  const projectsQuery = useListProjects();
  const projects = projectsQuery.data ?? [];
  const data = useUnifiedAgentsData(filters);
  const serializedFilterText = useMemo(
    () => serializeUnifiedAgentsFilterText(filters, projects),
    [filters, projects],
  );
  const [filterText, setFilterText] = useState(serializedFilterText);
  const filterTextEditedRef = useRef(false);
  const agentsPerRow = useUnifiedAgentsPerRowSetting();
  useEffect((): void => {
    if (filterTextEditedRef.current) return;
    setFilterText(serializedFilterText);
  }, [serializedFilterText]);
  const columns = agentsPerRow.value;
  const { activeIndex, activeAgent, setActiveSessionId } = useActiveAgent(data.agents);
  const activePinControls = useUnifiedAgentPinControls(activeAgent, { showProgressToast: true });
  const { focusVersion, focusFirstMatchedAgent, handleKeyDownCapture, handleActivate } =
    useUnifiedAgentsKeyboard({
      activeIndex,
      activePinControls,
      agents: data.agents,
      columns,
      searchInputRef,
      setActiveSessionId,
    });
  const [searchEnterFocusRequest, setSearchEnterFocusRequest] = useState(0);
  const pendingSearchEnterFocusRef = useRef(false);
  const commitFilterText = useCallback(
    (nextText: string): void => {
      filterTextEditedRef.current = true;
      setFilterText(nextText);
      const parsed = parseUnifiedAgentsFilterText(nextText, projects);
      setFilters(parsed);
    },
    [projects, setFilters],
  );
  const requestFirstMatchedAgentFocus = useCallback((): void => {
    pendingSearchEnterFocusRef.current = true;
    setSearchEnterFocusRequest((current) => current + 1);
  }, []);

  useEffect((): void => {
    if (!pendingSearchEnterFocusRef.current) return;
    pendingSearchEnterFocusRef.current = false;
    focusFirstMatchedAgent();
  }, [data.agents, focusFirstMatchedAgent, searchEnterFocusRequest]);

  return (
    <div className="flex h-full flex-col bg-background" onKeyDownCapture={handleKeyDownCapture}>
      <UnifiedAgentsHeader
        projects={projects}
        projectsError={projectsQuery.isError ? projectsQuery.error : null}
        agentsCount={data.agents.length}
        runningAgentsCount={countRunningAgents(data.agents)}
        agentsPerRowSetting={agentsPerRow}
        filterText={filterText}
        searchInputRef={searchInputRef}
        isFetching={data.isFetching}
        onFilterTextChange={commitFilterText}
        onSearchEnter={requestFirstMatchedAgentFocus}
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

interface ActiveAgentState {
  activeIndex: number;
  activeAgent: UnifiedAgentsData["agents"][number] | null;
  setActiveSessionId: (sessionId: number | null) => void;
}

function useActiveAgent(agents: UnifiedAgentsData["agents"]): ActiveAgentState {
  const [activeSessionId, setActiveSessionId] = useState<number | null>(null);
  const activeIndex = resolveActiveIndex(agents, activeSessionId);
  const activeAgent = agents[activeIndex] ?? null;

  useEffect(() => {
    if (agents.length === 0) {
      setActiveSessionId(null);
      return;
    }
    if (
      activeSessionId !== null &&
      agents.some((entry) => entry.session.sessionDbId === activeSessionId)
    ) {
      return;
    }
    setActiveSessionId(agents[0].session.sessionDbId);
  }, [activeSessionId, agents]);

  return useMemo(
    () => ({ activeIndex, activeAgent, setActiveSessionId }),
    [activeIndex, activeAgent],
  );
}

interface UnifiedAgentsKeyboardArgs {
  agents: UnifiedAgentsData["agents"];
  columns: number;
  activeIndex: number;
  activePinControls: ReturnType<typeof useUnifiedAgentPinControls>;
  searchInputRef: RefObject<UnifiedAgentsFilterInputHandle | null>;
  setActiveSessionId: (sessionId: number | null) => void;
}

interface UnifiedAgentsKeyboardState {
  focusVersion: number;
  focusFirstMatchedAgent: () => void;
  handleKeyDownCapture: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
  handleActivate: (index: number) => void;
}

function useUnifiedAgentsKeyboard({
  agents,
  columns,
  activeIndex,
  activePinControls,
  searchInputRef,
  setActiveSessionId,
}: UnifiedAgentsKeyboardArgs): UnifiedAgentsKeyboardState {
  const [focusVersion, setFocusVersion] = useState(0);
  const focusSearchInput = useCallback((): void => {
    searchInputRef.current?.focus();
  }, [searchInputRef]);

  useEffect(() => {
    const handleFocusSearch = (): void => focusSearchInput();
    window.addEventListener(FOCUS_UNIFIED_AGENTS_SEARCH_EVENT, handleFocusSearch);
    if (consumeUnifiedAgentsSearchFocusPending()) requestAnimationFrame(focusSearchInput);
    return () => window.removeEventListener(FOCUS_UNIFIED_AGENTS_SEARCH_EVENT, handleFocusSearch);
  }, [focusSearchInput]);

  const focusFirstMatchedAgent = useCallback((): void => {
    if (agents.length === 0) return;
    searchInputRef.current?.blur();
    setActiveSessionId(agents[0].session.sessionDbId);
    setFocusVersion((current) => current + 1);
  }, [agents, searchInputRef, setActiveSessionId]);

  const handleKeyDownCapture = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>): void => {
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
      const next = nextAgentIndex(activeIndex, direction, agents.length, columns);
      if (next === activeIndex) return;
      setActiveSessionId(agents[next]?.session.sessionDbId ?? null);
      setFocusVersion((current) => current + 1);
    },
    [activeIndex, activePinControls, agents, columns, focusSearchInput, setActiveSessionId],
  );

  const handleActivate = useCallback(
    (index: number): void => setActiveSessionId(agents[index]?.session.sessionDbId ?? null),
    [agents, setActiveSessionId],
  );

  return useMemo(
    () => ({ focusVersion, focusFirstMatchedAgent, handleKeyDownCapture, handleActivate }),
    [focusVersion, focusFirstMatchedAgent, handleKeyDownCapture, handleActivate],
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
  projects: Project[];
  projectsError: unknown;
  agentsCount: number;
  runningAgentsCount: number;
  agentsPerRowSetting: UnifiedAgentsPerRowSetting;
  filterText: string;
  searchInputRef: Ref<UnifiedAgentsFilterInputHandle>;
  isFetching: boolean;
  onFilterTextChange: (value: string) => void;
  onSearchEnter: () => void;
  onRefresh: () => void;
}

function UnifiedAgentsHeader({
  projects,
  projectsError,
  agentsCount,
  runningAgentsCount,
  agentsPerRowSetting,
  filterText,
  searchInputRef,
  isFetching,
  onFilterTextChange,
  onSearchEnter,
  onRefresh,
}: UnifiedAgentsHeaderProps): ReactElement {
  return (
    <header className="shrink-0 border-b bg-background px-4 py-3">
      <UnifiedAgentsFilters
        filterText={filterText}
        projects={projects}
        agentsCount={agentsCount}
        runningAgentsCount={runningAgentsCount}
        agentsPerRowSetting={agentsPerRowSetting}
        searchInputRef={searchInputRef}
        isFetching={isFetching}
        onFilterTextChange={onFilterTextChange}
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

interface UnifiedAgentsShortcutEvent {
  altKey: boolean;
  ctrlKey: boolean;
  key: string;
  metaKey: boolean;
  shiftKey: boolean;
}

function isPinShortcut(event: UnifiedAgentsShortcutEvent): boolean {
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

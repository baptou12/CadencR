import { memo, type KeyboardEvent, type ReactElement, type ReactNode, type RefObject } from "react";
import {
  ActivityIcon,
  BotIcon,
  Loader2Icon,
  MinusIcon,
  PlusIcon,
  RefreshCwIcon,
  SearchIcon,
  XIcon,
} from "lucide-react";
import type { Project } from "@/api/generated";
import { ProjectColorDot } from "@/hooks/useProjectColor";
import { UnifiedAgentsCounterPill } from "@/components/UnifiedAgentsCounterPill";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export type UnifiedAgentsFilterMode = "recent" | "all";

interface UnifiedAgentsFiltersProps {
  mode: UnifiedAgentsFilterMode;
  freshMinutes: number;
  agentsPerRow: number;
  projectId: number | null;
  projects: Project[];
  projectsLoading: boolean;
  agentsCount: number;
  runningAgentsCount: number;
  totalCount: number;
  projectCounts: Record<number, number>;
  query: string;
  searchInputRef?: RefObject<HTMLInputElement | null>;
  isFetching: boolean;
  onModeChange: (mode: UnifiedAgentsFilterMode) => void;
  onFreshMinutesChange: (value: number) => void;
  onAgentsPerRowChange: (value: number) => void;
  onProjectIdChange: (projectId: number | null) => void;
  onQueryChange: (query: string) => void;
  onSearchEnter?: () => void;
  onRefresh: () => void;
}

export const UnifiedAgentsFilters = memo(function UnifiedAgentsFilters({
  mode,
  freshMinutes,
  agentsPerRow,
  projectId,
  projects,
  projectsLoading,
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
}: UnifiedAgentsFiltersProps): ReactElement {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2.5">
        <SearchFilter
          query={query}
          inputRef={searchInputRef}
          onQueryChange={onQueryChange}
          onSearchEnter={onSearchEnter}
        />
        <ActivityWindowFilter
          mode={mode}
          value={freshMinutes}
          onModeChange={onModeChange}
          onFreshMinutesChange={onFreshMinutesChange}
        />
        <div className="flex-1" />
        <AgentsPerRowStepper value={agentsPerRow} onChange={onAgentsPerRowChange} />
        <RefreshButton isFetching={isFetching} onRefresh={onRefresh} />
      </div>

      <ProjectChips
        projectId={projectId}
        projects={projects}
        loading={projectsLoading}
        projectCounts={projectCounts}
        totalCount={totalCount}
        agentsCount={agentsCount}
        runningAgentsCount={runningAgentsCount}
        onProjectIdChange={onProjectIdChange}
      />
    </div>
  );
});

function SearchFilter({
  query,
  inputRef,
  onQueryChange,
  onSearchEnter,
}: {
  query: string;
  inputRef?: RefObject<HTMLInputElement | null>;
  onQueryChange: (query: string) => void;
  onSearchEnter?: () => void;
}): ReactElement {
  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
    event.preventDefault();
    onSearchEnter?.();
  };

  return (
    <label className="flex h-8 min-w-[220px] max-w-[300px] flex-1 basis-[260px] items-center gap-2 rounded-lg border border-border/80 bg-background/80 px-2.5 shadow-[inset_0_1px_0_hsl(var(--foreground)/0.04)] transition-[border-color,box-shadow] focus-within:border-primary/70 focus-within:shadow-[0_0_0_3px_hsl(var(--primary)/0.16),inset_0_1px_0_hsl(var(--foreground)/0.05)]">
      <SearchIcon className="size-3.5 shrink-0 text-muted-foreground" />
      <Input
        ref={inputRef}
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Filter agents… ⌘⇧F"
        className="h-7 min-w-0 border-0 bg-transparent px-0 py-0 text-[12.5px] text-foreground placeholder:text-muted-foreground shadow-none focus-visible:ring-0"
      />
      {query.length > 0 && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-4 shrink-0 rounded text-muted-foreground hover:text-foreground"
          onClick={() => onQueryChange("")}
          aria-label="Clear agent filter"
        >
          <XIcon className="size-2.5" />
        </Button>
      )}
    </label>
  );
}

function ActivityWindowFilter({
  mode,
  value,
  onModeChange,
  onFreshMinutesChange,
}: {
  mode: UnifiedAgentsFilterMode;
  value: number;
  onModeChange: (mode: UnifiedAgentsFilterMode) => void;
  onFreshMinutesChange: (value: number) => void;
}): ReactElement {
  const setFreshness = (minutes: number): void => {
    onFreshMinutesChange(minutes);
    onModeChange("recent");
  };
  return (
    <div className="inline-flex h-8 items-center gap-2 rounded-lg border border-border/80 bg-background/80 px-2 shadow-[inset_0_1px_0_hsl(var(--foreground)/0.04)]">
      <span className={FILTER_LABEL_CLASS}>Active in last</span>
      {FRESHNESS_PRESETS.map((minutes) => (
        <Button
          key={minutes}
          type="button"
          variant="ghost"
          size="sm"
          className={cn(
            FILTER_OPTION_CLASS,
            mode === "recent" && value === minutes && FILTER_OPTION_ACTIVE_CLASS,
          )}
          onClick={() => setFreshness(minutes)}
        >
          {minutes}m
        </Button>
      ))}
      <Input
        value={value}
        onChange={(event) => setFreshness(readBoundedInt(event.target.value, value, 1, 240))}
        type="number"
        min={1}
        max={240}
        aria-label="Freshness in minutes"
        className={cn(
          "h-6 w-14 rounded-md border border-border/70 bg-card/80 px-2 py-0 font-mono text-[11.5px] text-foreground shadow-none focus-visible:ring-1",
          mode === "recent" &&
            !FRESHNESS_PRESETS.includes(value) &&
            "border-primary/45 bg-primary/10",
        )}
      />
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className={cn(FILTER_OPTION_CLASS, "px-2.5", mode === "all" && FILTER_OPTION_ACTIVE_CLASS)}
        onClick={() => onModeChange("all")}
      >
        All
      </Button>
    </div>
  );
}

const FILTER_LABEL_CLASS =
  "pr-1 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground";
const FILTER_OPTION_CLASS =
  "h-6 rounded-md px-2 font-mono text-[11.5px] font-semibold text-muted-foreground hover:bg-accent/70 hover:text-foreground";
const FILTER_OPTION_ACTIVE_CLASS =
  "bg-primary/20 text-foreground shadow-[0_1px_3px_rgba(0,0,0,0.18),inset_0_0_0_1px_hsl(var(--primary)/0.34)]";

const FRESHNESS_PRESETS = [2, 5, 20, 60];

function AgentsPerRowStepper({
  value,
  onChange,
}: {
  value: number;
  onChange: (value: number) => void;
}): ReactElement {
  return (
    <div className="inline-flex h-8 items-center gap-1 rounded-lg bg-transparent px-1.5">
      <span className={FILTER_LABEL_CLASS}>Per row</span>
      <div className="inline-flex overflow-hidden rounded-md border border-border/70 bg-card/80 font-mono">
        <StepperButton disabled={value <= 1} onClick={() => onChange(Math.max(1, value - 1))}>
          <MinusIcon className="size-3" />
        </StepperButton>
        <span className="flex h-6 min-w-6 items-center justify-center text-[11.5px] font-semibold text-foreground">
          {value}
        </span>
        <StepperButton disabled={value >= 6} onClick={() => onChange(Math.min(6, value + 1))}>
          <PlusIcon className="size-3" />
        </StepperButton>
      </div>
    </div>
  );
}

function StepperButton({
  disabled,
  onClick,
  children,
}: {
  disabled: boolean;
  onClick: () => void;
  children: ReactNode;
}): ReactElement {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      disabled={disabled}
      onClick={onClick}
      className="size-6 rounded-none text-muted-foreground hover:bg-accent/70 hover:text-foreground"
    >
      {children}
    </Button>
  );
}

function RefreshButton({
  isFetching,
  onRefresh,
}: {
  isFetching: boolean;
  onRefresh: () => void;
}): ReactElement {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="h-8 gap-2 rounded-lg border border-border/80 bg-background/80 px-2.5 text-xs text-foreground shadow-[inset_0_1px_0_hsl(var(--foreground)/0.04)] hover:bg-accent/70"
      onClick={onRefresh}
      disabled={isFetching}
    >
      {isFetching ? (
        <Loader2Icon className="size-3.5 animate-spin" />
      ) : (
        <RefreshCwIcon className="size-3.5" />
      )}
      Refresh
    </Button>
  );
}

function ProjectChips({
  projectId,
  projects,
  loading,
  projectCounts,
  totalCount,
  agentsCount,
  runningAgentsCount,
  onProjectIdChange,
}: {
  projectId: number | null;
  projects: Project[];
  loading: boolean;
  projectCounts: Record<number, number>;
  totalCount: number;
  agentsCount: number;
  runningAgentsCount: number;
  onProjectIdChange: (projectId: number | null) => void;
}): ReactElement {
  return (
    <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
      <span className={cn(FILTER_LABEL_CLASS, "pr-0.5")}>Project</span>
      <ProjectChip active={projectId === null} onClick={() => onProjectIdChange(null)}>
        All projects <ChipCount count={totalCount} />
      </ProjectChip>
      {loading ? (
        <span className="px-2 text-xs text-muted-foreground">Loading projects…</span>
      ) : (
        projects.map((project) => (
          <ProjectChip
            key={project.id}
            active={projectId === project.id}
            onClick={() => onProjectIdChange(projectId === project.id ? null : project.id)}
          >
            <ProjectColorDot projectId={project.id} className="size-1.5" />
            {project.name}
            <ChipCount count={projectCounts[project.id] ?? 0} />
          </ProjectChip>
        ))
      )}
      <div className="ml-auto flex items-center gap-2 text-[11.5px] text-muted-foreground">
        <UnifiedAgentsCounterPill
          icon={<BotIcon className="size-3" />}
          count={agentsCount}
          label="agents"
        />
        <UnifiedAgentsCounterPill
          icon={<ActivityIcon className="size-3 text-primary" />}
          count={runningAgentsCount}
          label="running"
        />
      </div>
    </div>
  );
}

function ProjectChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}): ReactElement {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={onClick}
      className={cn(
        "h-7 gap-1.5 rounded-full border border-border/80 bg-background/55 px-2.5 text-xs font-medium text-foreground/85",
        "hover:bg-accent/70 hover:text-foreground",
        active &&
          "border-primary/55 bg-primary/10 text-foreground shadow-[0_0_0_3px_hsl(var(--primary)/0.13)]",
      )}
    >
      {children}
    </Button>
  );
}

function ChipCount({ count }: { count: number }): ReactElement {
  return (
    <span className="ml-0.5 min-w-4 rounded bg-foreground/10 px-1 font-mono text-[10px] text-muted-foreground tabular-nums">
      {count}
    </span>
  );
}

function readBoundedInt(value: string, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

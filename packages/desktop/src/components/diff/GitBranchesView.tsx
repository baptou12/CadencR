import { memo, useCallback, useMemo, useState, type ChangeEvent, type ReactElement } from "react";
import { ChevronRightIcon, GitBranchIcon, Loader2Icon } from "lucide-react";
import { useListBranches, type BranchInfo } from "@/api/generated";
import { Input } from "@/components/ui/input";
import { useBranchList, type BranchListRowContext } from "@/components/branch-chip/BranchList";
import { apiErrorMessage } from "@/lib/api-errors";
import { cn } from "@/lib/utils";
import { selectGitCurrentBranch, useGitStatusStore } from "@/stores/useGitStatusStore";
import { GitGraphView } from "./GitGraphView";

interface GitBranchesViewProps {
  featureId: number;
  projectId: number;
}

/** Virtualized branch browser whose rows open a graph scoped to that branch. */
export const GitBranchesView = memo(function GitBranchesView({
  featureId,
  projectId,
}: GitBranchesViewProps): ReactElement {
  const branchesQuery = useListBranches({ project_id: projectId });
  const currentBranch = useGitStatusStore(selectGitCurrentBranch(featureId));
  const [query, setQuery] = useState("");
  const [selectedBranch, setSelectedBranch] = useState<BranchInfo | null>(null);

  const handlePick = useCallback((branch: BranchInfo): void => {
    setSelectedBranch(branch);
  }, []);
  const handleBack = useCallback((): void => setSelectedBranch(null), []);
  const handleQueryChange = useCallback((event: ChangeEvent<HTMLInputElement>): void => {
    setQuery(event.target.value);
  }, []);

  const renderRow = useCallback(
    ({ branch, isActive }: BranchListRowContext) => (
      <BranchGraphRow
        branch={branch}
        current={branch.is_local && branch.name === currentBranch}
        active={isActive}
        onSelect={handlePick}
      />
    ),
    [currentBranch, handlePick],
  );

  const branches = branchesQuery.data ?? [];
  const emptyState = useMemo(
    () => (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
        <GitBranchIcon className="size-5" />
        {query ? "No matching branches." : "No branches found."}
      </div>
    ),
    [query],
  );
  const { list, onKeyDown, filteredCount } = useBranchList({
    branches,
    query,
    onPick: handlePick,
    renderRow,
    height: "100%",
    emptyState,
  });

  if (selectedBranch) {
    return (
      <GitGraphView
        key={`${selectedBranch.is_local ? "local" : "remote"}:${selectedBranch.name}`}
        featureId={featureId}
        branch={selectedBranch}
        onBackToBranches={handleBack}
      />
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        <GitBranchIcon className="size-4 shrink-0 text-muted-foreground" />
        <Input
          variant="ghost"
          aria-label="Search branches"
          placeholder="Search branches…"
          value={query}
          onChange={handleQueryChange}
          onKeyDown={onKeyDown}
          className="h-7 min-w-0 flex-1"
        />
        {!branchesQuery.isLoading && !branchesQuery.isError && (
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
            {filteredCount} {filteredCount === 1 ? "branch" : "branches"}
          </span>
        )}
      </div>
      <div className="min-h-0 flex-1">
        {branchesQuery.isLoading ? (
          <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2Icon className="size-4 animate-spin" />
            Loading branches…
          </div>
        ) : branchesQuery.isError ? (
          <div className="flex h-full items-center justify-center px-6 text-center text-sm text-destructive">
            {apiErrorMessage(branchesQuery.error, "Could not load branches")}
          </div>
        ) : (
          list
        )}
      </div>
    </div>
  );
});

interface BranchGraphRowProps {
  branch: BranchInfo;
  current: boolean;
  active: boolean;
  onSelect: (branch: BranchInfo) => void;
}

const BranchGraphRow = memo(function BranchGraphRow({
  branch,
  current,
  active,
  onSelect,
}: BranchGraphRowProps): ReactElement {
  const handleClick = useCallback((): void => onSelect(branch), [branch, onSelect]);
  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={`Open commits for ${branch.is_local ? "local" : "remote"} ${branch.name}`}
      className={cn(
        "flex w-full items-center gap-3 border-b border-border/50 px-4 py-2.5 text-left transition-colors hover:bg-accent/60",
        active && "bg-accent/70",
        current && !active && "bg-accent/30",
      )}
    >
      <GitBranchIcon className="size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate font-mono text-xs text-foreground">{branch.name}</span>
          {current && (
            <span className="shrink-0 rounded border border-primary/40 bg-primary/10 px-1 py-px text-[10px] text-primary">
              current
            </span>
          )}
          {!branch.is_local && (
            <span className="shrink-0 rounded border border-border px-1 py-px text-[10px] text-muted-foreground">
              remote
            </span>
          )}
        </div>
        {branch.attached_worktree_path && (
          <p className="mt-0.5 truncate text-[10px] text-muted-foreground">
            {branch.attached_feature_id != null
              ? `Worktree for feature #${branch.attached_feature_id}`
              : "Attached worktree"}
          </p>
        )}
      </div>
      <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" />
    </button>
  );
});

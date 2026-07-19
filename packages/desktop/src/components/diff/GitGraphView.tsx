import { memo, useCallback, useMemo, type ReactElement, type RefObject } from "react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import { Loader2Icon, GitBranchIcon, ArrowLeftIcon, ExternalLinkIcon } from "lucide-react";
import type { BranchInfo } from "@/api/generated";
import { apiErrorMessage } from "@/lib/api-errors";
import { computeGraphLayout } from "@/lib/git-graph-layout";
import { cn } from "@/lib/utils";
import { GitRevisionDiffView } from "./GitRevisionDiffView";
import { GitGraphRow, ROW_HEIGHT, type GitGraphRowData } from "./GitGraphRow";
import type { GitNavigationAdapterRegistrar } from "./gitNavigation";
import { useGitGraphViewModel } from "./useGitGraphViewModel";

interface GitGraphViewProps {
  featureId: number;
  /** When set, show only this branch's history instead of HEAD + target. */
  branch?: Pick<BranchInfo, "name" | "is_local">;
  onBackToBranches?: () => void;
  registerNavigationAdapter?: GitNavigationAdapterRegistrar;
}

/** Virtualized, paginated commit graph with an optional single-branch scope. */
export const GitGraphView = memo(function GitGraphView({
  featureId,
  branch,
  onBackToBranches,
  registerNavigationAdapter,
}: GitGraphViewProps): ReactElement {
  const model = useGitGraphViewModel({
    featureId,
    branch,
    onBackToBranches,
    registerNavigationAdapter,
  });
  const { data, isLoading, isError, error } = model.query;
  const components = useMemo(() => (model.hasMore ? { Footer: GraphFooter } : {}), [model.hasMore]);
  const itemContent = useGraphItemContent({
    commits: model.commits,
    layout: model.layout,
    activeIndex: model.list.activeIndex,
    onOpenIndex: model.list.navigation.openIndex,
    onOpenOnline: model.openOnline,
  });

  if (model.openedCommit) {
    return (
      <OpenedCommitDiff
        featureId={featureId}
        sha={model.openedCommit}
        commit={model.openedEntry}
        onBack={model.closeCommit}
        onOpenOnline={model.openOnline}
        registerNavigationAdapter={model.registerDetailAdapter}
      />
    );
  }

  const branchName = branch?.name;
  const showHeader = branchName != null || (!isError && model.commits.length > 0);
  return (
    <GraphListFrame
      header={
        showHeader ? (
          <GraphHeader
            currentBranch={branchName ?? data?.current_branch ?? null}
            targetBranch={branchName ? null : (data?.target_branch ?? null)}
            onBackToBranches={branchName ? onBackToBranches : undefined}
          />
        ) : null
      }
      body={
        <GraphBody
          commits={model.commits}
          isLoading={isLoading}
          isError={isError}
          error={error}
          itemContent={itemContent}
          onEndReached={model.endReached}
          components={components}
          viewportRef={model.list.viewportRef}
          virtuosoRef={model.list.virtuosoRef}
        />
      }
    />
  );
});

function GraphListFrame({
  header,
  body,
}: {
  header: ReactElement | null;
  body: ReactElement;
}): ReactElement {
  return (
    <div className="flex h-full flex-col">
      {header}
      <div className="min-h-0 flex-1">{body}</div>
    </div>
  );
}

function useGraphItemContent({
  commits,
  layout,
  activeIndex,
  onOpenIndex,
  onOpenOnline,
}: {
  commits: GitGraphRowData[];
  layout: ReturnType<typeof computeGraphLayout>;
  activeIndex: number;
  onOpenIndex: (index: number) => boolean;
  onOpenOnline: (sha: string) => Promise<void>;
}): (index: number) => ReactElement {
  return useCallback(
    (index: number): ReactElement => {
      const commit = commits[index];
      const row = layout.rows[index];
      if (!commit || !row) return <div style={{ height: ROW_HEIGHT }} />;
      return (
        <GitGraphRow
          commit={commit}
          row={row}
          columns={layout.columns}
          active={index === activeIndex}
          onOpenCommit={() => {
            onOpenIndex(index);
          }}
          onOpenOnline={onOpenOnline}
        />
      );
    },
    [activeIndex, commits, layout, onOpenIndex, onOpenOnline],
  );
}

function OpenedCommitDiff({
  featureId,
  sha,
  commit,
  onBack,
  onOpenOnline,
  registerNavigationAdapter,
}: {
  featureId: number;
  sha: string;
  commit: GitGraphRowData | null;
  onBack: () => void;
  onOpenOnline: (sha: string) => Promise<void>;
  registerNavigationAdapter: GitNavigationAdapterRegistrar;
}): ReactElement {
  return (
    <GitRevisionDiffView
      featureId={featureId}
      revision={sha}
      backLabel="Commits"
      label={commit?.shortSha ?? sha.slice(0, 7)}
      message={commit?.message}
      onBack={onBack}
      trailingAction={<CommitOnlineButton sha={sha} onOpen={onOpenOnline} />}
      registerNavigationAdapter={registerNavigationAdapter}
    />
  );
}

function CommitOnlineButton({
  sha,
  onOpen,
}: {
  sha: string;
  onOpen: (sha: string) => Promise<void>;
}): ReactElement {
  return (
    <button
      type="button"
      onClick={() => void onOpen(sha)}
      title="Open commit online"
      aria-label="Open commit online"
      className="inline-flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
    >
      <ExternalLinkIcon className="size-3.5" />
    </button>
  );
}

interface GraphBodyProps {
  commits: GitGraphRowData[];
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  itemContent: (index: number) => ReactElement;
  onEndReached: () => void;
  components: { Footer?: () => ReactElement };
  viewportRef: RefObject<HTMLDivElement | null>;
  virtuosoRef: RefObject<VirtuosoHandle | null>;
}

const GraphBody = memo(function GraphBody({
  commits,
  isLoading,
  isError,
  error,
  itemContent,
  onEndReached,
  components,
  viewportRef,
  virtuosoRef,
}: GraphBodyProps): ReactElement {
  if (isLoading && commits.length === 0) {
    return <GraphMessage variant="loading">Loading commits…</GraphMessage>;
  }
  if (isError) {
    return (
      <GraphMessage variant="error">
        {apiErrorMessage(error, "Could not load commits")}
      </GraphMessage>
    );
  }
  if (commits.length === 0) {
    return <GraphMessage variant="empty">No commits to show.</GraphMessage>;
  }
  return (
    <div ref={viewportRef} className="h-full">
      <Virtuoso
        ref={virtuosoRef}
        style={{ height: "100%" }}
        totalCount={commits.length}
        itemContent={itemContent}
        endReached={onEndReached}
        increaseViewportBy={ROW_HEIGHT * 6}
        components={components}
      />
    </div>
  );
});

function GraphMessage({
  children,
  variant,
}: {
  children: string;
  variant: "loading" | "error" | "empty";
}): ReactElement {
  return (
    <div
      className={cn(
        "flex h-full items-center justify-center gap-2 px-6 text-center text-sm",
        variant === "empty" && "flex-col",
        variant === "error" ? "text-destructive" : "text-muted-foreground",
      )}
    >
      {variant === "loading" ? (
        <Loader2Icon className="size-4 animate-spin" />
      ) : variant === "empty" ? (
        <GitBranchIcon className="size-5" />
      ) : null}
      {children}
    </div>
  );
}

function GraphHeader({
  currentBranch,
  targetBranch,
  onBackToBranches,
}: {
  currentBranch: string | null;
  targetBranch: string | null;
  onBackToBranches?: () => void;
}): ReactElement {
  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-1.5 text-xs">
      {onBackToBranches && (
        <button
          type="button"
          onClick={onBackToBranches}
          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <ArrowLeftIcon className="size-3.5" />
          Branches
        </button>
      )}
      <GitBranchIcon className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="truncate font-mono text-foreground">{currentBranch ?? "HEAD"}</span>
      {targetBranch && (
        <>
          <span className="shrink-0 text-muted-foreground">vs</span>
          <span className="truncate font-mono text-muted-foreground">{targetBranch}</span>
        </>
      )}
    </div>
  );
}

function GraphFooter(): ReactElement {
  return (
    <div className="flex items-center justify-center gap-2 py-3 text-xs text-muted-foreground">
      <Loader2Icon className="size-3 animate-spin" />
      Loading more…
    </div>
  );
}

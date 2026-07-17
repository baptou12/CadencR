import { memo, useCallback, useMemo, useState, type ReactElement } from "react";
import { Virtuoso } from "react-virtuoso";
import { toast } from "sonner";
import { Loader2Icon, GitBranchIcon, ArrowLeftIcon, ExternalLinkIcon } from "lucide-react";
import {
  getCommitUrl,
  useGetCommitGraph,
  type BranchInfo,
  type CommitGraphEntry,
  type GetCommitGraphParams,
} from "@/api/generated";
import { desktopBridge } from "@/lib/desktop-bridge";
import { apiErrorMessage } from "@/lib/api-errors";
import { computeGraphLayout, type GraphCommitInput } from "@/lib/git-graph-layout";
import { cn } from "@/lib/utils";
import { GitRevisionDiffView } from "./GitRevisionDiffView";
import { GitGraphRow, ROW_HEIGHT, type GitGraphRowData } from "./GitGraphRow";

const PAGE_SIZE = 50;

interface GitGraphViewProps {
  featureId: number;
  /** When set, show only this branch's history instead of HEAD + target. */
  branch?: Pick<BranchInfo, "name" | "is_local">;
  onBackToBranches?: () => void;
}

/** Virtualized, paginated commit graph with an optional single-branch scope. */
export const GitGraphView = memo(function GitGraphView({
  featureId,
  branch,
  onBackToBranches,
}: GitGraphViewProps): ReactElement {
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [openedCommit, setOpenedCommit] = useState<string | null>(null);

  const queryParams = useMemo<GetCommitGraphParams>(
    () => ({
      feature_id: featureId,
      branch: branch?.name,
      branch_is_local: branch?.is_local,
      skip: 0,
      limit,
    }),
    [branch, featureId, limit],
  );
  const { data, isLoading, isError, error } = useGetCommitGraph(queryParams, {
    query: { keepPreviousData: true },
  });

  const commits = useMemo(() => toGraphRows(data?.commits ?? []), [data]);
  const layout = useMemo(() => {
    const inputs: GraphCommitInput[] = commits.map((commit) => ({
      sha: commit.sha,
      parents: commit.parents,
    }));
    return computeGraphLayout(inputs);
  }, [commits]);

  const hasMore = data?.has_more ?? false;
  const handleEndReached = useCallback(() => {
    if (hasMore) setLimit((current) => current + PAGE_SIZE);
  }, [hasMore]);
  const components = useMemo(() => (hasMore ? { Footer: GraphFooter } : {}), [hasMore]);
  const handleOpenOnline = useOpenCommitOnline(featureId);
  const handleCloseCommit = useCallback((): void => setOpenedCommit(null), []);
  const itemContent = useCallback(
    (index: number): ReactElement => {
      const commit = commits[index];
      const row = layout.rows[index];
      if (!commit || !row) return <div style={{ height: ROW_HEIGHT }} />;
      return (
        <GitGraphRow
          commit={commit}
          row={row}
          columns={layout.columns}
          onOpenCommit={setOpenedCommit}
          onOpenOnline={handleOpenOnline}
        />
      );
    },
    [commits, handleOpenOnline, layout],
  );

  if (openedCommit) {
    const commit = commits.find((entry) => entry.sha === openedCommit);
    return (
      <GitRevisionDiffView
        featureId={featureId}
        revision={openedCommit}
        backLabel="Commits"
        label={commit?.shortSha ?? openedCommit.slice(0, 7)}
        message={commit?.message}
        onBack={handleCloseCommit}
        trailingAction={<CommitOnlineButton sha={openedCommit} onOpen={handleOpenOnline} />}
      />
    );
  }

  const branchName = branch?.name;
  const showHeader = branchName != null || (!isError && commits.length > 0);
  return (
    <div className="flex h-full flex-col">
      {showHeader && (
        <GraphHeader
          currentBranch={branchName ?? data?.current_branch ?? null}
          targetBranch={branchName ? null : (data?.target_branch ?? null)}
          onBackToBranches={branchName ? onBackToBranches : undefined}
        />
      )}
      <div className="min-h-0 flex-1">
        <GraphBody
          commits={commits}
          isLoading={isLoading}
          isError={isError}
          error={error}
          itemContent={itemContent}
          onEndReached={handleEndReached}
          components={components}
        />
      </div>
    </div>
  );
});

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

function toGraphRows(commits: CommitGraphEntry[]): GitGraphRowData[] {
  return commits.map((commit) => ({
    sha: commit.sha,
    shortSha: commit.short_sha,
    message: commit.message,
    body: commit.body,
    author: commit.author,
    date: commit.date,
    isPushed: commit.is_pushed,
    parents: commit.parents,
    refs: commit.refs,
    filesChanged: commit.files_changed,
    additions: commit.additions,
    deletions: commit.deletions,
  }));
}

function useOpenCommitOnline(featureId: number): (sha: string) => Promise<void> {
  return useCallback(
    async (sha: string) => {
      try {
        const response = await getCommitUrl({ feature_id: featureId, sha });
        if (!response.available || !response.url) {
          toast.error("No remote host is configured for this repository.");
          return;
        }
        await desktopBridge.openExternal(response.url);
      } catch (error) {
        const message = apiErrorMessage(error, "Unknown error");
        toast.error(`Could not open the commit online: ${message}`);
      }
    },
    [featureId],
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
}

const GraphBody = memo(function GraphBody({
  commits,
  isLoading,
  isError,
  error,
  itemContent,
  onEndReached,
  components,
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
    <Virtuoso
      style={{ height: "100%" }}
      totalCount={commits.length}
      itemContent={itemContent}
      endReached={onEndReached}
      increaseViewportBy={ROW_HEIGHT * 6}
      components={components}
    />
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

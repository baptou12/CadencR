import { memo, useCallback, useMemo, type Ref } from "react";
import { Loader2Icon } from "lucide-react";
import {
  Virtuoso,
  type Components,
  type FollowOutput,
  type ListRange,
  type VirtuosoHandle,
} from "react-virtuoso";
import { type AgentBlockData, buildToolResultMap } from "./AgentBlock";
import { AgentStreamItem } from "./agent-session/AgentStreamItem";
import { buildDisplayBlockKeys, filterRenderableBlocks } from "./agentStreamDisplay";

type ScrollRef = (el: HTMLElement | null) => void;
const FIRST_ITEM_INDEX_BASE = 1_000_000;
const HISTORY_PREFETCH_ROWS = 12;

interface AgentStreamVirtuosoContext {
  isStreaming: boolean;
  showStreamingIndicator: boolean;
  /**
   * Block id of the *currently* streaming item, or null when the session is
   * idle. Threaded through Virtuoso `context` (not closed over by
   * `renderItem`) so only items whose per-block `isStreaming` flag actually
   * flips bust their `React.memo` — older items stay stable across chunks
   * instead of re-rendering the entire list every time the cursor advances.
   */
  streamingBlockId: string | null;
}

interface AgentStreamProps {
  blocks: AgentBlockData[];
  /**
   * Pre-filtered subset of `blocks` excluding subagent children. When
   * provided, AgentStream uses it directly instead of recomputing the filter
   * on every render — the WS store maintains it incrementally. When omitted,
   * the stream falls back to filtering `blocks` itself.
   */
  rootBlocks?: AgentBlockData[];
  /**
   * Map from a tool_call's `toolUseId` to its `tool_result` block. Same
   * deal: provided by the WS store incrementally, falls back to a derived
   * map when omitted.
   */
  toolResultMap?: Map<string, AgentBlockData>;
  /** Whether the agent is currently streaming */
  isStreaming?: boolean;
  showStreamingIndicator?: boolean;
  /** Base path to strip from file paths in diffs */
  basePath?: string;
  /** Callback ref for the scrollable container (auto-scroll listeners attach here). */
  scrollContainerRef?: ScrollRef;
  /** Imperative handle to Virtuoso (used to scroll to the true last item). */
  virtuosoRef?: Ref<VirtuosoHandle>;
  /**
   * Virtuoso `followOutput` callback. Returns `'auto'` while auto-scroll is
   * engaged so the view stays pinned to the bottom across async item
   * measurement (markdown highlighting, BashBlock query loads, etc.).
   */
  followOutput?: FollowOutput;
  /** Virtuoso's measurement-aware bottom-state callback. */
  onAtBottomStateChange?: (atBottom: boolean) => void;
  /**
   * Fires whenever Virtuoso recomputes the total list height (i.e. after an
   * item remeasures). Used by the auto-scroll hook to keep the view pinned
   * to the bottom while measurements settle on cold-open.
   */
  onTotalListHeightChanged?: (height: number) => void;
  /** Called by Virtuoso when the first rendered item is reached. */
  onStartReached?: () => void;
  /** When true, a spinner is shown above the first item (older history loading). */
  isLoadingOlder?: boolean;
  /** Number of rendered Virtuoso rows prepended by older-history pagination. */
  historyPrependDisplayOffset?: number;
}

const StreamingCursor = memo(function StreamingCursor() {
  return (
    <div className="flex items-center px-3 py-2 text-xs text-muted-foreground">
      <span className="animate-pulse">█</span>
    </div>
  );
});

const StreamFooter = memo(function StreamFooter({
  context,
}: {
  context?: AgentStreamVirtuosoContext;
}) {
  if (!context?.isStreaming || !context.showStreamingIndicator) return null;
  return <StreamingCursor />;
});

const VIRTUOSO_COMPONENTS = {
  Footer: StreamFooter,
} satisfies Components<AgentBlockData, AgentStreamVirtuosoContext>;

function useRootBlocks(
  blocks: AgentBlockData[],
  rootBlocksProp: AgentBlockData[] | undefined,
): AgentBlockData[] {
  return useMemo(
    () => rootBlocksProp ?? blocks.filter((block) => !block.parentToolUseId),
    [rootBlocksProp, blocks],
  );
}

function useToolResultMap(
  blocks: AgentBlockData[],
  toolResultMapProp: Map<string, AgentBlockData> | undefined,
): Map<string, AgentBlockData> {
  const fallbackToolResultCount = useMemo(
    () =>
      toolResultMapProp ? 0 : blocks.reduce((n, b) => n + (b.type === "tool_result" ? 1 : 0), 0),
    [blocks, toolResultMapProp],
  );
  const fallbackToolResultMap = useMemo(
    () => (toolResultMapProp ? new Map<string, AgentBlockData>() : buildToolResultMap(blocks)),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: rebuild only on tool_result count change for the fallback path
    [fallbackToolResultCount, toolResultMapProp],
  );
  return toolResultMapProp ?? fallbackToolResultMap;
}

const LoadingOlderOverlay = memo(function LoadingOlderOverlay() {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-2 z-10 flex justify-center">
      <div className="rounded-full border bg-background/80 p-1 shadow-sm backdrop-blur">
        <Loader2Icon className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    </div>
  );
});

export const AgentStream = memo(function AgentStream({
  blocks,
  rootBlocks: rootBlocksProp,
  toolResultMap: toolResultMapProp,
  isStreaming,
  showStreamingIndicator = true,
  basePath,
  scrollContainerRef,
  virtuosoRef,
  followOutput,
  onAtBottomStateChange,
  onTotalListHeightChanged,
  onStartReached,
  isLoadingOlder = false,
  historyPrependDisplayOffset = 0,
}: AgentStreamProps) {
  const rootBlocks = useRootBlocks(blocks, rootBlocksProp);
  const displayBlocks = useMemo(() => filterRenderableBlocks(rootBlocks), [rootBlocks]);
  const toolResultMap = useToolResultMap(blocks, toolResultMapProp);
  const itemKeys = useMemo(() => buildDisplayBlockKeys(displayBlocks), [displayBlocks]);
  const firstItemIndex = FIRST_ITEM_INDEX_BASE - historyPrependDisplayOffset;

  // The streaming cursor is, by construction, the last displayed block —
  // there is no separate "active block" pointer in the store. Threading just
  // its id (not the whole `isStreaming` boolean) keeps the per-item
  // `isStreaming={ctx.streamingBlockId === block.id}` check from flipping for
  // any block other than the one actually receiving chunks.
  const lastBlockId = displayBlocks.at(-1)?.id;
  const virtuosoContext = useMemo(
    (): AgentStreamVirtuosoContext => ({
      isStreaming: Boolean(isStreaming),
      showStreamingIndicator,
      streamingBlockId: isStreaming && lastBlockId ? lastBlockId : null,
    }),
    [isStreaming, showStreamingIndicator, lastBlockId],
  );
  const onScroller = useCallback(
    (el: HTMLElement | Window | null): void => {
      scrollContainerRef?.(el instanceof HTMLElement ? el : null);
    },
    [scrollContainerRef],
  );
  const onRangeChanged = useCallback(
    (range: ListRange): void => {
      if (range.startIndex <= firstItemIndex + HISTORY_PREFETCH_ROWS) onStartReached?.();
    },
    [firstItemIndex, onStartReached],
  );
  const computeItemKey = useCallback(
    (i: number): string => {
      const localIndex = i - firstItemIndex;
      return itemKeys[localIndex] ?? displayBlocks[localIndex]?.id ?? String(i);
    },
    [displayBlocks, firstItemIndex, itemKeys],
  );
  // `renderItem` deliberately does NOT depend on `isStreaming` /
  // `streamingBlockId`. Those reach the item via Virtuoso `context` so
  // advancing the streaming cursor only re-renders the (up to) two blocks
  // whose per-block `isStreaming` flag actually flipped, not the entire list.
  const renderItem = useCallback(
    (_i: number, block: AgentBlockData, ctx: AgentStreamVirtuosoContext) => (
      <AgentStreamItem
        block={block}
        isStreaming={ctx.streamingBlockId === block.id}
        basePath={basePath}
        toolResultMap={toolResultMap}
      />
    ),
    [basePath, toolResultMap],
  );

  if (displayBlocks.length === 0) {
    return (
      <div className="p-3">{isStreaming && showStreamingIndicator && <StreamingCursor />}</div>
    );
  }

  return (
    <div className="relative h-full">
      {isLoadingOlder && <LoadingOlderOverlay />}
      <Virtuoso
        data-testid="agent-stream-scroller"
        className="h-full overflow-x-hidden"
        style={{ height: "100%" }}
        ref={virtuosoRef}
        scrollerRef={onScroller}
        data={displayBlocks}
        firstItemIndex={firstItemIndex}
        computeItemKey={computeItemKey}
        initialTopMostItemIndex={{ index: "LAST", align: "end" }}
        defaultItemHeight={40}
        increaseViewportBy={{ top: 1600, bottom: 800 }}
        minOverscanItemCount={{ top: 12, bottom: 8 }}
        overscan={{ main: 800, reverse: 800 }}
        components={VIRTUOSO_COMPONENTS}
        context={virtuosoContext}
        followOutput={followOutput}
        atBottomStateChange={onAtBottomStateChange}
        atBottomThreshold={16}
        totalListHeightChanged={onTotalListHeightChanged}
        startReached={onStartReached}
        rangeChanged={onRangeChanged}
        itemContent={renderItem}
      />
    </div>
  );
});

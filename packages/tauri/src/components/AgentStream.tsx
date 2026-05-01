import { memo, useCallback, useMemo, type RefObject } from "react";
import { Loader2Icon } from "lucide-react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import { type AgentBlockData, buildToolResultMap } from "./AgentBlock";
import { AgentStreamItem } from "./agent-session/AgentStreamItem";
import { isFileChangeTool } from "@/lib/tool-adapter";

interface AgentStreamProps {
  blocks: AgentBlockData[];
  /** Whether the agent is currently streaming */
  isStreaming?: boolean;
  showStreamingIndicator?: boolean;
  /** Base path to strip from file paths in diffs */
  basePath?: string;
  /** Imperative handle for scroll control (e.g. auto-scroll toggle). */
  virtuosoRef?: RefObject<VirtuosoHandle | null>;
  /**
   * Index of the first item in the conceptual list. Must decrement by the
   * number of prepended items when older history is loaded so that Virtuoso
   * preserves the user's scroll position. Defaults to 0.
   */
  firstItemIndex?: number;
  /** Fired when the user reaches (or leaves) the bottom of the stream. */
  onAtBottomChange?: (atBottom: boolean) => void;
  /** Fired when the user scrolls near the top of the stream. */
  onStartReached?: () => void;
  /** When true, a spinner is shown above the first item (older history loading). */
  isLoadingOlder?: boolean;
}

function isHiddenByRenderer(block: AgentBlockData): boolean {
  if (block.type === "thinking") return !block.content.trim();
  if (block.type !== "tool_result") return false;
  if (
    block.sourceToolName === "Bash" ||
    block.sourceToolName === "Agent" ||
    block.sourceToolName === "Task"
  ) {
    return false;
  }
  return !isFileChangeTool(block.sourceToolName);
}

function coalesceDisplayBlocks(blocks: AgentBlockData[]): AgentBlockData[] {
  const merged: AgentBlockData[] = [];
  for (const block of blocks) {
    if (isHiddenByRenderer(block)) continue;

    const previous = merged[merged.length - 1];
    const shouldMergeText =
      previous &&
      previous.type === "text" &&
      block.type === "text" &&
      !!previous.createdAt &&
      !!block.createdAt &&
      !!previous.model &&
      !!block.model &&
      previous.model === block.model &&
      previous.parentToolUseId === block.parentToolUseId;

    if (shouldMergeText) {
      merged[merged.length - 1] = {
        ...previous,
        content: previous.content + block.content,
      };
      continue;
    }
    merged.push(block);
  }
  return merged;
}

export const AgentStream = memo(function AgentStream({
  blocks,
  isStreaming,
  showStreamingIndicator = true,
  basePath,
  virtuosoRef,
  firstItemIndex,
  onAtBottomChange,
  onStartReached,
  isLoadingOlder = false,
}: AgentStreamProps) {
  const rootBlocks = useMemo(() => blocks.filter((b) => !b.parentToolUseId), [blocks]);
  const displayBlocks = useMemo(() => coalesceDisplayBlocks(rootBlocks), [rootBlocks]);
  // The tool-result map only changes when a new `tool_result` block lands;
  // text-deltas produce a new `blocks` reference every token but never add
  // one. Memoising on the count keeps the map (and downstream `itemContent`)
  // reference-stable across deltas so memoised items in the viewport actually
  // bail out of re-render during streaming.
  const toolResultCount = useMemo(
    () => blocks.reduce((n, b) => n + (b.type === "tool_result" ? 1 : 0), 0),
    [blocks],
  );
  const toolResultMap = useMemo(
    () => buildToolResultMap(blocks),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: rebuild only on tool_result count change (see comment above)
    [toolResultCount],
  );

  const itemContent = useCallback(
    (_index: number, block: AgentBlockData) => (
      <AgentStreamItem
        block={block}
        isStreaming={isStreaming}
        basePath={basePath}
        toolResultMap={toolResultMap}
      />
    ),
    [isStreaming, basePath, toolResultMap],
  );

  const computeItemKey = useCallback(
    (_index: number, block: AgentBlockData): string => block.id,
    [],
  );

  const followOutput = useCallback(
    (isAtBottom: boolean): "smooth" | false => (isAtBottom ? "smooth" : false),
    [],
  );

  const components = useMemo(
    () => ({
      Header: (): React.ReactElement | null =>
        isLoadingOlder ? (
          <div className="flex justify-center py-2">
            <Loader2Icon className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : null,
      Footer: (): React.ReactElement | null =>
        isStreaming && showStreamingIndicator ? (
          <div className="flex items-center px-3 py-2 text-xs text-muted-foreground">
            <span className="animate-pulse">█</span>
          </div>
        ) : null,
    }),
    [isLoadingOlder, isStreaming, showStreamingIndicator],
  );

  // Edge case: blocks present but all hidden by the renderer filters. Render
  // the streaming cursor inline so users see the agent is still working.
  if (displayBlocks.length === 0) {
    return (
      <div className="p-3">
        {isStreaming && showStreamingIndicator && (
          <div className="flex items-center py-2 text-xs text-muted-foreground">
            <span className="animate-pulse">█</span>
          </div>
        )}
      </div>
    );
  }

  return (
    <Virtuoso
      ref={virtuosoRef}
      data={displayBlocks}
      firstItemIndex={firstItemIndex}
      computeItemKey={computeItemKey}
      itemContent={itemContent}
      followOutput={followOutput}
      atBottomStateChange={onAtBottomChange}
      startReached={onStartReached}
      overscan={{ main: 800, reverse: 800 }}
      increaseViewportBy={{ top: 400, bottom: 400 }}
      components={components}
      className="h-full"
      style={{ overflowX: "hidden" }}
    />
  );
});

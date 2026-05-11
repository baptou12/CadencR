import { memo, useCallback, useMemo, useState } from "react";
import { Loader2Icon } from "lucide-react";
import { Virtuoso } from "react-virtuoso";
import { type AgentBlockData, buildToolResultMap } from "./AgentBlock";
import { AgentStreamItem } from "./agent-session/AgentStreamItem";
import { isFileChangeTool } from "@/lib/tool-adapter";

type DivRef = (el: HTMLDivElement | null) => void;

interface AgentStreamProps {
  blocks: AgentBlockData[];
  /**
   * Pre-filtered subset of `blocks` excluding subagent children. When
   * provided, AgentStream uses it directly instead of recomputing the filter
   * on every render — the WS store maintains it incrementally. When omitted
   * (e.g. workflow agents that don't go through ws-session-store yet), the
   * stream falls back to filtering `blocks` itself.
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
  scrollContainerRef?: DivRef;
  /** Callback ref for the 1px top sentinel (IntersectionObserver loadOlder). */
  topSentinelRef?: DivRef;
  /**
   * Callback ref for the content wrapper. The auto-scroll hook attaches a
   * `ResizeObserver` to this so it can re-anchor to the bottom as the
   * conversation lays out asynchronously (markdown, code highlighting,
   * images). Without this the initial render of a long session lands above
   * the bottom because `scrollHeight` hasn't settled when the layout effect
   * first runs.
   */
  scrollContentRef?: DivRef;
  /** When true, a spinner is shown above the first item (older history loading). */
  isLoadingOlder?: boolean;
}

const StreamingCursor = memo(function StreamingCursor() {
  return (
    <div className="flex items-center px-3 py-2 text-xs text-muted-foreground">
      <span className="animate-pulse">█</span>
    </div>
  );
});

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

function buildDisplayBlockKeys(blocks: AgentBlockData[]): string[] {
  const totalById = new Map<string, number>();
  for (const block of blocks) totalById.set(block.id, (totalById.get(block.id) ?? 0) + 1);

  const seenById = new Map<string, number>();
  return blocks.map((block: AgentBlockData): string => {
    const total = totalById.get(block.id) ?? 0;
    if (total <= 1) return block.id;
    const seen = seenById.get(block.id) ?? 0;
    seenById.set(block.id, seen + 1);
    return `${block.id}#${seen}`;
  });
}

export const AgentStream = memo(function AgentStream({
  blocks,
  rootBlocks: rootBlocksProp,
  toolResultMap: toolResultMapProp,
  isStreaming,
  showStreamingIndicator = true,
  basePath,
  scrollContainerRef,
  topSentinelRef,
  scrollContentRef,
  isLoadingOlder = false,
}: AgentStreamProps) {
  const rootBlocks = useMemo(
    () => rootBlocksProp ?? blocks.filter((b) => !b.parentToolUseId),
    [rootBlocksProp, blocks],
  );
  const displayBlocks = useMemo(() => coalesceDisplayBlocks(rootBlocks), [rootBlocks]);
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
  const toolResultMap = toolResultMapProp ?? fallbackToolResultMap;
  const itemKeys = useMemo(() => buildDisplayBlockKeys(displayBlocks), [displayBlocks]);

  // `customScrollParent` needs the actual scroller element (not just a ref),
  // so we mirror the callback ref into local state. The outer callback still
  // forwards the element to the parent-provided `scrollContainerRef` so
  // `useAgentSessionScroll` keeps owning scroll/wheel/touch listeners.
  const [scrollerEl, setScrollerEl] = useState<HTMLDivElement | null>(null);
  const onScroller = useCallback<DivRef>(
    (el) => {
      setScrollerEl(el);
      scrollContainerRef?.(el);
    },
    [scrollContainerRef],
  );

  if (displayBlocks.length === 0) {
    return (
      <div className="p-3">{isStreaming && showStreamingIndicator && <StreamingCursor />}</div>
    );
  }

  return (
    <div
      ref={onScroller}
      data-testid="agent-stream-scroller"
      className="h-full overflow-y-auto overflow-x-hidden"
    >
      <div ref={topSentinelRef} aria-hidden style={{ height: 1 }} />
      <div ref={scrollContentRef}>
        {isLoadingOlder && (
          <div className="flex justify-center py-2">
            <Loader2Icon className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        )}
        <Virtuoso
          customScrollParent={scrollerEl ?? undefined}
          data={displayBlocks}
          computeItemKey={(i) => itemKeys[i] ?? displayBlocks[i].id}
          initialTopMostItemIndex={displayBlocks.length - 1}
          overscan={{ main: 800, reverse: 800 }}
          itemContent={(_i, block) => (
            <AgentStreamItem
              block={block}
              isStreaming={isStreaming}
              basePath={basePath}
              toolResultMap={toolResultMap}
            />
          )}
        />
        {isStreaming && showStreamingIndicator && <StreamingCursor />}
      </div>
    </div>
  );
});

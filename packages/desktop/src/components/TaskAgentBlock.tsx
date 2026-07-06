import { useCallback, useRef, useEffect, useMemo, useState } from "react";
import { Loader2Icon, LayersIcon } from "lucide-react";
import { AgentBlock, type AgentBlockData, buildToolResultMap } from "@/components/AgentBlock";
import { extractTaskOutput } from "@/lib/tool-adapter";
import { parseToolArgsObject, stringArg } from "@/lib/tool-args";

/**
 * While a subagent streams it can emit hundreds of tool calls, but only ~20vh
 * is ever visible. Mounting every child as a full AgentBlock tree per frame is
 * the bottleneck, so cap the live view to the most recent N (a "show all"
 * affordance reveals the rest, and a completed task always renders in full).
 */
const MAX_STREAMING_CHILDREN = 30;

export function TaskAgentBlock({
  block,
  isStreaming,
  basePath,
}: {
  block: AgentBlockData;
  isStreaming?: boolean;
  basePath?: string;
}) {
  const children = useMemo(() => {
    const persistedOutput = extractTaskOutput(block.toolArgs);
    if (block.childBlocks?.length || !persistedOutput) return block.childBlocks ?? [];
    return [
      {
        id: `${block.id}-persisted-output`,
        type: "text",
        content: persistedOutput,
      } satisfies AgentBlockData,
    ];
  }, [block.childBlocks, block.id, block.toolArgs]);
  const isRunning = !!isStreaming && !block.taskComplete;

  const [showAllChildren, setShowAllChildren] = useState(false);
  const visibleChildren = useMemo(() => {
    if (showAllChildren || !isRunning || children.length <= MAX_STREAMING_CHILDREN) {
      return children;
    }
    return children.slice(-MAX_STREAMING_CHILDREN);
  }, [children, isRunning, showAllChildren]);
  const hiddenCount = children.length - visibleChildren.length;
  const childResultMap = useMemo(() => buildToolResultMap(visibleChildren), [visibleChildren]);

  const description = stringArg(parseToolArgsObject(block.toolArgs), "description") ?? "Subtask";

  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  useEffect(() => {
    // Only pin-to-bottom while streaming; once the task completes there is no
    // growth to follow, so skip the forced synchronous layout entirely.
    if (!isRunning) return;
    if (stickToBottom.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [visibleChildren.length, isRunning]);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 16;
    stickToBottom.current = atBottom;
  }, []);

  return (
    <div className="my-1 rounded-md border border-border bg-[var(--block-task-bg)] overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 text-xs border-b border-border">
        <LayersIcon className="size-3.5 text-muted-foreground shrink-0" />
        <span className="font-medium text-foreground">{block.toolName}</span>
        <span className="truncate text-muted-foreground text-xs">{description}</span>
        {isRunning && (
          <Loader2Icon className="size-3 animate-spin text-muted-foreground shrink-0 ml-auto" />
        )}
      </div>
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="px-3 py-2 space-y-0.5 max-h-[20vh] overflow-y-auto"
      >
        {hiddenCount > 0 && (
          <button
            type="button"
            onClick={() => setShowAllChildren(true)}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            Show {hiddenCount} earlier step{hiddenCount === 1 ? "" : "s"}
          </button>
        )}
        {visibleChildren.map((child) => (
          <AgentBlock
            key={child.id}
            block={child}
            isStreaming={isStreaming}
            basePath={basePath}
            toolResultMap={childResultMap}
          />
        ))}
      </div>
    </div>
  );
}

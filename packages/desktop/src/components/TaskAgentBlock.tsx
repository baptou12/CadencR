import { useMemo, useState } from "react";
import { Loader2Icon, LayersIcon, ArrowDownIcon } from "lucide-react";
import { type AgentBlockData, buildToolResultMap } from "@/components/AgentBlock";
import { AgentStreamItem } from "@/components/agent-session/AgentStreamItem";
import { extractTaskOutput } from "@/lib/tool-adapter";
import { parseToolArgsObject, stringArg } from "@/lib/tool-args";
import { useStickToBottom } from "@/hooks/useStickToBottom";
import { cn } from "@/lib/utils";

/**
 * While a subagent streams it can emit hundreds of tool calls, but only ~20vh
 * is ever visible. Mounting every child as a full AgentBlock tree per frame is
 * the bottleneck, so cap the live view to the most recent N (a "show all"
 * affordance reveals the rest, and a completed task always renders in full).
 */
const MAX_STREAMING_CHILDREN = 30;

export function TaskAgentBlock({ block, basePath }: { block: AgentBlockData; basePath?: string }) {
  // Note: "running" is derived from `!block.taskComplete`, NOT the parent turn's
  // streaming flag — that flag reflects the parent agent's own tokens, which
  // pause during tool execution, so it reads false while a subagent streams.
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
  // A subagent is live until its own `taskComplete` flips (set on turn_complete
  // and always true for DB-loaded history). This stays reliably true for the
  // whole subagent run — unlike the parent turn's `isStreaming` — so the
  // auto-scroll pin and header indicator persist while children stream in.
  const isRunning = !block.taskComplete;

  const [showAllChildren, setShowAllChildren] = useState(false);
  const visibleChildren = useMemo(() => {
    if (showAllChildren || !isRunning || children.length <= MAX_STREAMING_CHILDREN) {
      return children;
    }
    return children.slice(-MAX_STREAMING_CHILDREN);
  }, [children, isRunning, showAllChildren]);
  const hiddenCount = children.length - visibleChildren.length;
  const childResultMap = useMemo(() => buildToolResultMap(visibleChildren), [visibleChildren]);
  // Only the final child is actively receiving chunks while the task runs, so
  // scope `isStreaming` to it (drives the thinking glow + markdown throttle).
  const lastChildId = visibleChildren.at(-1)?.id;

  const description = stringArg(parseToolArgsObject(block.toolArgs), "description") ?? "Subtask";

  // Follow the newest event while the subagent runs. Growth is tracked via a
  // ResizeObserver (so blocks that keep growing after they appear stay pinned),
  // and only a real user scroll-up parks it — see the hook.
  const { scrollRef, contentRef, autoScroll, toggle } = useStickToBottom(isRunning);

  return (
    <div className="my-1 rounded-md border border-border bg-[var(--block-task-bg)] overflow-hidden">
      <TaskAgentHeader
        toolName={block.toolName}
        description={description}
        isRunning={isRunning}
        autoScroll={autoScroll}
        onToggleAutoScroll={toggle}
      />
      <div ref={scrollRef} className="px-3 py-2 max-h-[20vh] overflow-y-auto">
        <div ref={contentRef}>
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
            <AgentStreamItem
              key={child.id}
              block={child}
              isStreaming={isRunning && child.id === lastChildId}
              basePath={basePath}
              toolResultMap={childResultMap}
              verbosityMode="collapsed"
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function TaskAgentHeader({
  toolName,
  description,
  isRunning,
  autoScroll,
  onToggleAutoScroll,
}: {
  toolName?: string;
  description: string;
  isRunning: boolean;
  autoScroll: boolean;
  onToggleAutoScroll: () => void;
}) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 text-xs border-b border-border">
      <LayersIcon className="size-3.5 text-muted-foreground shrink-0" />
      <span className="font-medium text-foreground shrink-0">{toolName}</span>
      <span className="min-w-0 flex-1 truncate text-muted-foreground text-xs">{description}</span>
      {isRunning && (
        <>
          <button
            type="button"
            onClick={onToggleAutoScroll}
            aria-pressed={autoScroll}
            aria-label="Auto-scroll"
            title={
              autoScroll
                ? "Auto-scroll: on — following latest"
                : "Auto-scroll: off — click to follow latest"
            }
            className={cn(
              "shrink-0 rounded p-0.5 transition-colors",
              autoScroll
                ? "text-[var(--acc-green)]"
                : "text-muted-foreground/40 hover:text-muted-foreground",
            )}
          >
            <ArrowDownIcon className="size-3" />
          </button>
          <Loader2Icon className="size-3 animate-spin text-muted-foreground shrink-0" />
        </>
      )}
    </div>
  );
}

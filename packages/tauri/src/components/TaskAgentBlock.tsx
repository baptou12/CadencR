import { useCallback, useRef, useEffect, useMemo } from "react";
import { Loader2Icon, LayersIcon } from "lucide-react";
import {
  AgentBlock,
  type AgentBlockData,
  buildToolResultMap,
} from "@/components/AgentBlock";
import { extractTaskOutput } from "@/lib/tool-adapter";

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
    if (block.childBlocks?.length || !persistedOutput)
      return block.childBlocks ?? [];
    return [
      {
        id: `${block.id}-persisted-output`,
        type: "text",
        content: persistedOutput,
      } satisfies AgentBlockData,
    ];
  }, [block.childBlocks, block.id, block.toolArgs]);
  const childResultMap = useMemo(
    () => buildToolResultMap(children),
    [children],
  );
  const isRunning = !!isStreaming && !block.taskComplete;

  let description = "Subtask";
  if (block.toolArgs) {
    try {
      const args = JSON.parse(block.toolArgs) as Record<string, unknown>;
      if (typeof args.description === "string") description = args.description;
    } catch {
      // partial JSON during streaming
    }
  }

  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  useEffect(() => {
    if (stickToBottom.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [children.length]);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 16;
    stickToBottom.current = atBottom;
  }, []);

  return (
    <div className="my-1 rounded-md border border-border bg-black/30 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 text-xs border-b border-border">
        <LayersIcon className="size-3.5 text-muted-foreground shrink-0" />
        <span className="font-medium text-foreground">{block.toolName}</span>
        <span className="truncate text-muted-foreground text-xs">
          {description}
        </span>
        {isRunning && (
          <Loader2Icon className="size-3 animate-spin text-muted-foreground shrink-0 ml-auto" />
        )}
      </div>
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="px-3 py-2 space-y-0.5 max-h-[20vh] overflow-y-auto"
      >
        {children.map((child) => (
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

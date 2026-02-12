import { useCallback, useEffect, useRef, useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AgentBlock, type AgentBlockData } from "./AgentBlock";
import { getToolActivityLabel } from "@/lib/tool-call-parser";

function getActivityLabel(blocks: AgentBlockData[]): string {
  for (let i = blocks.length - 1; i >= 0; i--) {
    const block = blocks[i];
    if (block.type === "tool_call" && block.toolName) {
      return getToolActivityLabel(block.toolName, block.toolArgs);
    }
  }
  return "Generating";
}

interface AgentStreamProps {
  blocks: AgentBlockData[];
  /** Whether the agent is currently streaming */
  isStreaming?: boolean;
}

export function AgentStream({ blocks, isStreaming }: AgentStreamProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const [expandAllTasks, setExpandAllTasks] = useState(false);

  const handleExpandAllTasks = useCallback(() => {
    setExpandAllTasks(true);
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [blocks.length]);

  return (
    <ScrollArea className="flex-1">
      <div className="space-y-1 p-3">
        {blocks.filter((b) => !b.parentToolUseId).map((block) => (
          <AgentBlock
            key={block.id}
            block={block}
            isStreaming={isStreaming}
            expandAllTasks={expandAllTasks}
            onExpandAllTasks={handleExpandAllTasks}
          />
        ))}
        {isStreaming && (
          <div className="flex items-center gap-2 py-2 text-xs text-muted-foreground">
            <span className="inline-flex gap-0.5">
              <span className="size-1.5 animate-bounce rounded-full bg-current [animation-delay:0ms]" />
              <span className="size-1.5 animate-bounce rounded-full bg-current [animation-delay:150ms]" />
              <span className="size-1.5 animate-bounce rounded-full bg-current [animation-delay:300ms]" />
            </span>
            {getActivityLabel(blocks)}...
          </div>
        )}
        <div ref={bottomRef} />
      </div>
    </ScrollArea>
  );
}

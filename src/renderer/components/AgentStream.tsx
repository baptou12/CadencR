import { useEffect, useRef } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AgentBlock, type AgentBlockData } from "./AgentBlock";

interface AgentStreamProps {
  blocks: AgentBlockData[];
  /** Whether the agent is currently streaming */
  isStreaming?: boolean;
}

export function AgentStream({ blocks, isStreaming }: AgentStreamProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [blocks.length]);

  return (
    <ScrollArea className="flex-1">
      <div className="space-y-1 p-3">
        {blocks.map((block) => (
          <AgentBlock key={block.id} block={block} />
        ))}
        {isStreaming && (
          <div className="flex items-center gap-2 py-2 text-xs text-muted-foreground">
            <span className="inline-flex gap-0.5">
              <span className="size-1.5 animate-bounce rounded-full bg-current [animation-delay:0ms]" />
              <span className="size-1.5 animate-bounce rounded-full bg-current [animation-delay:150ms]" />
              <span className="size-1.5 animate-bounce rounded-full bg-current [animation-delay:300ms]" />
            </span>
            Generating...
          </div>
        )}
        <div ref={bottomRef} />
      </div>
    </ScrollArea>
  );
}

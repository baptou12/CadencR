import { memo, useMemo } from "react";
import { format, isToday } from "date-fns";
import { AgentBlock, type AgentBlockData } from "./AgentBlock";
import { parseUTCDateTime } from "@/lib/date-utils";

function formatTimestamp(iso: string): string {
  const date = parseUTCDateTime(iso);
  if (isToday(date)) return format(date, "HH:mm");
  return format(date, "yyyy/MM/dd HH:mm");
}

interface AgentStreamProps {
  blocks: AgentBlockData[];
  /** Whether the agent is currently streaming */
  isStreaming?: boolean;
  /** Base path to strip from file paths in diffs */
  basePath?: string;
}

export const AgentStream = memo(function AgentStream({ blocks, isStreaming, basePath }: AgentStreamProps) {
  const rootBlocks = useMemo(() => blocks.filter((b) => !b.parentToolUseId), [blocks]);

  return (
    <div className="space-y-1 p-3">
      {rootBlocks.map((block) => (
        <div key={block.id}>
          {(block.type === "text" || block.type === "user_message") && block.createdAt && (
            <div className={`text-xs text-muted-foreground/60 mt-2 mb-0.5 ${block.type === "user_message" ? "text-right" : ""}`}>
              <span className="font-medium">
                {block.type === "user_message" ? "User" : (block.model ?? "unknown")}
              </span>
              {" · "}
              {formatTimestamp(block.createdAt)}
            </div>
          )}
          <AgentBlock
            block={block}
            isStreaming={isStreaming}
            basePath={basePath}
          />
        </div>
      ))}
      {isStreaming && (
        <div className="flex items-center py-2 text-xs text-muted-foreground">
          <span className="animate-pulse">█</span>
        </div>
      )}
    </div>
  );
});

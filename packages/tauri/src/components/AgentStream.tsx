import { memo, useMemo } from "react";
import { format, isToday } from "date-fns";
import { AgentBlock, type AgentBlockData, buildToolResultMap } from "./AgentBlock";
import { parseUTCDateTime } from "@/lib/date-utils";
import { isFileChangeTool } from "@/lib/tool-adapter";

function formatTimestamp(iso: string): string {
  const date = parseUTCDateTime(iso);
  if (isToday(date)) return format(date, "HH:mm");
  return format(date, "yyyy/MM/dd HH:mm");
}

interface AgentStreamProps {
  blocks: AgentBlockData[];
  /** Whether the agent is currently streaming */
  isStreaming?: boolean;
  showStreamingIndicator?: boolean;
  /** Base path to strip from file paths in diffs */
  basePath?: string;
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
}: AgentStreamProps) {
  const rootBlocks = useMemo(() => blocks.filter((b) => !b.parentToolUseId), [blocks]);
  const displayBlocks = useMemo(() => coalesceDisplayBlocks(rootBlocks), [rootBlocks]);

  const toolResultMap = useMemo(() => buildToolResultMap(blocks), [blocks]);

  return (
    <div className="space-y-1 p-3">
      {displayBlocks.map((block) => (
        <div key={block.id}>
          {(block.type === "text" || block.type === "user_message") && block.createdAt && (
            <div
              className={`text-xs text-muted-foreground/60 mt-2 mb-0.5 ${block.type === "user_message" ? "text-right" : ""}`}
            >
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
            toolResultMap={toolResultMap}
          />
        </div>
      ))}
      {isStreaming && showStreamingIndicator && (
        <div className="flex items-center py-2 text-xs text-muted-foreground">
          <span className="animate-pulse">█</span>
        </div>
      )}
    </div>
  );
});

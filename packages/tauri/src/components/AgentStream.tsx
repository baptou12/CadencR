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
        // `content-visibility: auto` instructs the browser to skip layout +
        // paint work for any block that is currently outside the viewport,
        // and pick it back up just before it scrolls into view. Without
        // this, every drag-resize of the surrounding pane (sidebar, split
        // handle) forces *every* block in the conversation to re-wrap text
        // — for a long agent run that's hundreds of markdown / code blocks
        // reflowing per pixel of drag, which is what made the resize feel
        // sluggish at 5–10 fps.
        //
        // `contain-intrinsic-size: auto 120px` gives Chromium a placeholder
        // height for unmeasured blocks (so the scrollbar doesn't jump on
        // mount) and lets it remember the real measured size once a block
        // has been rendered. 120 px ≈ the median block height; the exact
        // number doesn't matter once the browser has measured the real one.
        <div
          key={block.id}
          style={{ contentVisibility: "auto", containIntrinsicSize: "auto 120px" }}
        >
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

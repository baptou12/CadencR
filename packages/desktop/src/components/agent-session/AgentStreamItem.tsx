import { memo, useCallback, useEffect, useRef, useState } from "react";
import { format, isToday } from "date-fns";
import { AgentBlock, type AgentBlockData } from "../AgentBlock";
import { parseUTCDateTime } from "@/lib/date-utils";
import AgentStreamContextMenu from "./AgentStreamContextMenu";
import {
  AGENT_AUTO_COLLAPSE_DELAY_MS,
  isToolAutoCollapsible,
  type AgentVerbosityMode,
} from "@/lib/agent-verbosity";

interface AgentStreamItemProps {
  block: AgentBlockData;
  isStreaming?: boolean;
  basePath?: string;
  toolResultMap: Map<string, AgentBlockData>;
  verbosityMode?: AgentVerbosityMode;
}

function formatTimestamp(iso: string): string {
  const date = parseUTCDateTime(iso);
  if (isToday(date)) return format(date, "HH:mm");
  return format(date, "yyyy/MM/dd HH:mm");
}

export const AgentStreamItem = memo(function AgentStreamItem({
  block,
  isStreaming,
  basePath,
  toolResultMap,
  verbosityMode = "maximal",
}: AgentStreamItemProps) {
  const [collapsedByPolicy, setCollapsedByPolicy] = useState(false);

  const wasStreamingRef = useRef(false);
  if (isStreaming) wasStreamingRef.current = true;

  const blockId = block.id;
  const blockType = block.type;
  const toolName = block.type === "tool_call" ? block.toolName : undefined;

  useEffect(() => {
    if (verbosityMode !== "auto_collapse") {
      setCollapsedByPolicy(false);
      return;
    }
    const autoCollapsible =
      blockType === "thinking" || (blockType === "tool_call" && isToolAutoCollapsible(toolName));
    if (!autoCollapsible) {
      setCollapsedByPolicy(false);
      return;
    }
    if (isStreaming) {
      setCollapsedByPolicy(false);
      return;
    }
    if (!wasStreamingRef.current) {
      setCollapsedByPolicy(true);
      return;
    }
    const timer = setTimeout(() => setCollapsedByPolicy(true), AGENT_AUTO_COLLAPSE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [blockId, blockType, toolName, isStreaming, verbosityMode]);

  const handleExpandedChange = useCallback((next: boolean) => setCollapsedByPolicy(!next), []);

  const showHeader = (block.type === "text" || block.type === "user_message") && !!block.createdAt;
  const isUserMessage = block.type === "user_message";

  return (
    <AgentStreamContextMenu block={block}>
      <div className="py-0.5">
        {showHeader && block.createdAt && (
          <div
            className={`text-xs text-muted-foreground/60 mt-2 mb-0.5 ${isUserMessage ? "text-right" : ""}`}
          >
            <span className="font-medium">
              {isUserMessage ? "User" : (block.model ?? "unknown")}
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
          verbosityMode={verbosityMode}
          isCollapsedByPolicy={collapsedByPolicy}
          onExpandedChange={handleExpandedChange}
        />
      </div>
    </AgentStreamContextMenu>
  );
});

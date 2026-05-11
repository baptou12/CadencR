import { memo } from "react";
import { format, isToday } from "date-fns";
import { AgentBlock, type AgentBlockData } from "../AgentBlock";
import { parseUTCDateTime } from "@/lib/date-utils";
import AgentStreamContextMenu from "./AgentStreamContextMenu";

interface AgentStreamItemProps {
  block: AgentBlockData;
  isStreaming?: boolean;
  basePath?: string;
  toolResultMap: Map<string, AgentBlockData>;
}

function formatTimestamp(iso: string): string {
  const date = parseUTCDateTime(iso);
  if (isToday(date)) return format(date, "HH:mm");
  return format(date, "yyyy/MM/dd HH:mm");
}

/**
 * Single item rendered inside `AgentStream`. Memoised so a parent re-render
 * (e.g. a panel resize that bubbles new layout dimensions) does not walk into
 * the underlying `AgentBlock` tree. Props must remain stable: `toolResultMap`
 * is memoised upstream, `basePath` / `isStreaming` are primitives.
 *
 * Keep this wrapper layout-neutral. Virtuoso owns measurement and scroll
 * anchoring; browser-level `content-visibility: auto` uses estimated
 * off-screen heights, which makes `scrollHeight` change while scrolling back
 * through long conversations and causes visible jumps/flicker.
 */
export const AgentStreamItem = memo(function AgentStreamItem({
  block,
  isStreaming,
  basePath,
  toolResultMap,
}: AgentStreamItemProps) {
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
        />
      </div>
    </AgentStreamContextMenu>
  );
});

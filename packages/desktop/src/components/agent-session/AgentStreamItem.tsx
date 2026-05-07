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
 * Tab-resize perf: the outer wrapper opts into `content-visibility: auto`.
 * The browser then skips layout, paint, and style for items outside the
 * viewport, which collapses the per-frame layout cost during a panel-resize
 * drag from O(all messages) to O(on-screen messages). `contain-intrinsic-size:
 * auto 200px` gives the browser a placeholder size for off-screen items
 * (`auto` keyword stores the last measured size, so heights stabilise after
 * an item has been scrolled into view once — keeping `scrollHeight` and the
 * stick-to-bottom anchor in `useAgentSessionScroll` predictable).
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
      <div className="py-0.5 [content-visibility:auto] [contain-intrinsic-size:auto_200px]">
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

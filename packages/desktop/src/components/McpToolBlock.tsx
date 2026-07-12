import { useState } from "react";
import { ChevronRightIcon } from "lucide-react";
import type { McpTool } from "@/lib/mcp-tool-parser";
import { cn } from "@/lib/utils";

/** Full-size MCP call with a provider badge and normalized arguments. */
export function McpToolBlock({ mcp }: { mcp: McpTool }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="my-1 rounded-md border border-primary/30 bg-primary/5">
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs"
        onClick={() => setExpanded(!expanded)}
      >
        <span className="shrink-0 rounded bg-primary/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
          {mcp.server}
        </span>
        <span className="shrink-0 whitespace-nowrap font-medium text-primary/80">{mcp.label}</span>
        {mcp.detail && <span className="truncate text-primary/50">{mcp.detail}</span>}
        <ChevronRightIcon
          className={cn(
            "ml-auto size-3 shrink-0 text-primary/40 transition-transform",
            expanded && "rotate-90",
          )}
        />
      </button>
      {expanded && Object.keys(mcp.arguments).length > 0 && (
        <pre className="border-t border-primary/20 bg-muted/30 p-3 text-xs overflow-x-auto">
          {JSON.stringify(mcp.arguments, null, 2)}
        </pre>
      )}
    </div>
  );
}

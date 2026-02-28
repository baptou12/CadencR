import { AgentBlock, type AgentBlockData } from "./AgentBlock";

function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  const hhmm = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
  if (isToday) return hhmm;
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}/${mm}/${dd} ${hhmm}`;
}

interface AgentStreamProps {
  blocks: AgentBlockData[];
  /** Whether the agent is currently streaming */
  isStreaming?: boolean;
  /** Base path to strip from file paths in diffs */
  basePath?: string;
}

export function AgentStream({ blocks, isStreaming, basePath }: AgentStreamProps) {
  return (
    <div className="space-y-1 p-3">
      {blocks.filter((b) => !b.parentToolUseId).map((block) => (
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
        <div className="flex items-center gap-2 py-2 text-xs text-muted-foreground">
          <span className="inline-flex gap-0.5 shrink-0">
            <span className="size-1.5 animate-bounce rounded-full bg-current [animation-delay:0ms]" />
            <span className="size-1.5 animate-bounce rounded-full bg-current [animation-delay:150ms]" />
            <span className="size-1.5 animate-bounce rounded-full bg-current [animation-delay:300ms]" />
          </span>
          Working...
        </div>
      )}
    </div>
  );
}

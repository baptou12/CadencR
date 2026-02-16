import { useState } from "react";
import { cn } from "@/lib/utils";
import { ChevronRightIcon, WrenchIcon, BrainIcon, CodeIcon, LayersIcon, LoaderIcon, TerminalIcon } from "lucide-react";
import { parseToolCall } from "@/lib/tool-call-parser";
import { Markdown } from "@/components/Markdown";
import { InlineDiffBlock } from "@/components/InlineDiffBlock";
import { ClipboardCheck } from "lucide-react";
import { CollapsibleBlock } from "@/components/ui/collapsible-block";

/** Reconstruct diff data from persisted tool args (for historical sessions). */
function diffFromToolArgs(
  toolName: string,
  toolArgs?: string,
): { filePath: string; oldContent: string; newContent: string } | null {
  if (!toolArgs) return null;
  try {
    const args = JSON.parse(toolArgs) as Record<string, unknown>;
    const filePath = args.file_path as string | undefined;
    if (!filePath) return null;

    if (toolName === "Edit") {
      const oldString = (args.old_string as string) ?? "";
      const newString = (args.new_string as string) ?? "";
      if (oldString || newString) {
        return { filePath, oldContent: oldString, newContent: newString };
      }
    } else if (toolName === "Write") {
      const content = (args.content as string) ?? "";
      if (content) {
        return { filePath, oldContent: "", newContent: content };
      }
    }
  } catch {
    // Partial JSON during streaming — skip
  }
  return null;
}

/** Block types that the agent stream can produce */
export type BlockType = "text" | "code" | "tool_call" | "tool_result" | "thinking" | "user_message";

export interface AgentBlockData {
  id: string;
  type: BlockType;
  content: string;
  /** For tool_call blocks */
  toolName?: string;
  /** For tool_call blocks — JSON string of arguments */
  toolArgs?: string;
  /** For tool_result blocks */
  isError?: boolean;
  /** For code blocks */
  language?: string;
  /** The tool_use_id from the SDK (for tool_call blocks) */
  toolUseId?: string;
  /** Parent tool_use_id if this block comes from a subagent */
  parentToolUseId?: string | null;
  /** Child blocks nested under this Task block */
  childBlocks?: AgentBlockData[];
  /** Whether this Task's subagent has completed */
  taskComplete?: boolean;
  /** DB message ID — used for deduplication against server data */
  messageDbId?: number;
  /** The tool name that produced this tool_result (resolved from parent tool_call) */
  sourceToolName?: string;
}

interface AgentBlockProps {
  block: AgentBlockData;
  /** Whether the parent agent is still streaming */
  isStreaming?: boolean;
}

export function AgentBlock({ block, isStreaming }: AgentBlockProps) {
  switch (block.type) {
    case "text":
      return <TextBlock content={block.content} />;
    case "code":
      return <CodeBlock content={block.content} language={block.language} />;
    case "tool_call":
      if (block.toolName === "TodoWrite") return null;
      if (block.toolName === "Task" && block.childBlocks) {
        return <TaskAgentBlock block={block} isStreaming={isStreaming} />;
      }
      if (block.toolName === "ExitPlanMode") {
        return <PlanBlock args={block.toolArgs} />;
      }
      if (block.toolName === "Write" || block.toolName === "Edit") {
        const diff = diffFromToolArgs(block.toolName, block.toolArgs);
        if (diff && !diff.filePath.includes("/.claude/plans/")) {
          return (
            <div>
              <ToolCallBlock name={block.toolName} args={block.toolArgs} />
              <InlineDiffBlock
                filePath={diff.filePath}
                oldContent={diff.oldContent}
                newContent={diff.newContent}
              />
            </div>
          );
        }
      }
      return <ToolCallBlock name={block.toolName ?? "unknown"} args={block.toolArgs} />;
    case "tool_result":
      if (block.sourceToolName === "Bash") {
        return <BashOutputBlock content={block.content} isError={block.isError} />;
      }
      // Only show output for tools with custom blocks (Bash above).
      // Hide generic tool results (Grep, Read, Glob, etc.) to reduce noise.
      return null;
    case "thinking":
      return <ThinkingBlock content={block.content} />;
    case "user_message":
      return <UserMessageBlock content={block.content} />;
    default:
      return null;
  }
}

function TextBlock({ content }: { content: string }) {
  return <Markdown content={content} />;
}

function PlanBlock({ args }: { args?: string }) {
  let plan: string | undefined;
  if (args) {
    try {
      const parsed = JSON.parse(args) as Record<string, unknown>;
      if (typeof parsed.plan === "string") plan = parsed.plan;
    } catch {
      // partial JSON during streaming
    }
  }

  if (!plan) return null;

  return (
    <div className="my-2 rounded-md border border-blue-800 bg-blue-500/5">
      <div className="flex items-center gap-2 border-b border-blue-800 px-3 py-1.5 text-xs">
        <ClipboardCheck className="size-3 text-blue-400" />
        <span className="font-medium text-blue-300">Plan</span>
      </div>
      <div className="px-3 py-2">
        <Markdown content={plan} />
      </div>
    </div>
  );
}

function CodeBlock({ content, language }: { content: string; language?: string }) {
  return (
    <div className="my-1 rounded-md border border-border bg-muted/50 overflow-hidden">
      {language && (
        <div className="flex items-center gap-1.5 border-b border-border bg-muted px-3 py-1 text-xs text-muted-foreground">
          <CodeIcon className="size-3" />
          {language}
        </div>
      )}
      <pre className="overflow-x-auto p-3 text-xs leading-relaxed">
        <code>{content}</code>
      </pre>
    </div>
  );
}

function ToolCallBlock({ name, args }: { name: string; args?: string }) {
  const [expanded, setExpanded] = useState(false);
  const summary = parseToolCall(name, args);

  return (
    <div className="my-1 rounded-md border border-border bg-blue-500/5">
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs"
        onClick={() => setExpanded(!expanded)}
      >
        <WrenchIcon className="size-3 text-blue-400" />
        <span className="font-medium text-blue-300">{name}</span>
        {summary?.detail && (
          <span className="truncate text-muted-foreground">{summary.detail}</span>
        )}
        <ChevronRightIcon
          className={cn(
            "ml-auto size-3 shrink-0 text-muted-foreground transition-transform",
            expanded && "rotate-90"
          )}
        />
      </button>
      {expanded && args && (
        <pre className="border-t border-border bg-muted/30 p-3 text-xs overflow-x-auto">
          {formatJson(args)}
        </pre>
      )}
    </div>
  );
}


const DEFAULT_BASH_LINES = 10;

function BashOutputBlock({ content, isError }: { content: string; isError?: boolean }) {
  const lines = content.split("\n");
  const totalLines = lines.length;

  return (
    <CollapsibleBlock
      totalCount={totalLines}
      visibleCount={DEFAULT_BASH_LINES}
      unit="lines"
      className={isError ? "border-red-800" : "border-zinc-700"}
      headerClassName={isError ? "bg-red-950 text-red-400 py-1" : "bg-zinc-900 text-zinc-400 py-1"}
      toggleClassName="ml-auto text-zinc-500 hover:text-zinc-300"
      bodyClassName={cn(
        "bg-zinc-950 px-3 py-2 text-xs leading-relaxed overflow-x-auto font-mono",
        isError ? "text-red-300" : "text-zinc-300"
      )}
      truncationClassName="text-zinc-600"
      header={<>
        <TerminalIcon className="size-3" />
        <span>Output ({totalLines} line{totalLines !== 1 ? "s" : ""})</span>
      </>}
    >
      {({ showAll }) => (
        <pre className="whitespace-pre-wrap">
          {showAll ? lines.join("\n") : lines.slice(-DEFAULT_BASH_LINES).join("\n")}
        </pre>
      )}
    </CollapsibleBlock>
  );
}

function ThinkingBlock({ content }: { content: string }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="my-1 rounded-md border border-border bg-purple-500/5">
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs"
        onClick={() => setExpanded(!expanded)}
      >
        <BrainIcon className="size-3 text-purple-400" />
        <span className="font-medium text-purple-300">Thinking</span>
        <ChevronRightIcon
          className={cn(
            "ml-auto size-3 text-muted-foreground transition-transform",
            expanded && "rotate-90"
          )}
        />
      </button>
      {expanded && (
        <div className="border-t border-border px-3 py-2 text-xs text-muted-foreground whitespace-pre-wrap">
          {content}
        </div>
      )}
    </div>
  );
}

function UserMessageBlock({ content }: { content: string }) {
  return (
    <div className="my-1 flex justify-end">
      <div className="rounded-md border border-primary/30 bg-primary/10 px-3 py-1.5 text-sm max-w-[80%]">
        <span className="whitespace-pre-wrap text-foreground">{content}</span>
      </div>
    </div>
  );
}

const DEFAULT_VISIBLE_CHILDREN = 5;

function TaskAgentBlock({ block, isStreaming }: { block: AgentBlockData; isStreaming?: boolean }) {
  const children = block.childBlocks ?? [];
  const isRunning = !block.taskComplete && !!isStreaming;

  // Parse description from args
  let description = "Subtask";
  if (block.toolArgs) {
    try {
      const args = JSON.parse(block.toolArgs) as Record<string, unknown>;
      if (typeof args.description === "string") description = args.description;
    } catch {
      // partial JSON during streaming
    }
  }

  return (
    <CollapsibleBlock
      totalCount={children.length}
      visibleCount={DEFAULT_VISIBLE_CHILDREN}
      unit="actions"
      className="border-indigo-700 bg-indigo-500/5"
      headerClassName=""
      toggleClassName="text-indigo-500 hover:text-indigo-300"
      bodyClassName="border-t border-indigo-800 px-3 py-2 space-y-0.5"
      truncationClassName="text-indigo-800"
      header={<>
        <LayersIcon className="size-3 text-indigo-400" />
        <span className="font-medium text-indigo-300">Task</span>
        <span className="truncate text-muted-foreground">{description}</span>
        {isRunning && (
          <LoaderIcon className="size-3 animate-spin text-indigo-500 shrink-0" />
        )}
        <span className="ml-auto text-muted-foreground shrink-0">{children.length} action{children.length !== 1 ? "s" : ""}</span>
      </>}
    >
      {({ showAll }) => (<>
        {(showAll ? children : children.slice(-DEFAULT_VISIBLE_CHILDREN)).map((child) => (
          <CompactBlock key={child.id} block={child} />
        ))}
        {isRunning && children.length > 0 && (
          <div className="flex items-center gap-1.5 pt-1 text-xs text-muted-foreground">
            <LoaderIcon className="size-3 animate-spin" />
            Working...
          </div>
        )}
      </>)}
    </CollapsibleBlock>
  );
}

function CompactBlock({ block }: { block: AgentBlockData }) {
  if (block.type === "tool_call" && block.toolName) {
    const summary = parseToolCall(block.toolName, block.toolArgs);
    return (
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground py-0.5">
        <WrenchIcon className="size-2.5 text-blue-500 shrink-0" />
        <span className="font-medium text-foreground/70">{block.toolName}</span>
        {summary?.detail && <span className="truncate">{summary.detail}</span>}
      </div>
    );
  }
  if (block.type === "text" && block.content) {
    const preview = block.content.length > 120 ? block.content.slice(0, 120) + "..." : block.content;
    return (
      <div className="text-xs text-muted-foreground py-0.5 truncate">{preview}</div>
    );
  }
  if (block.type === "tool_result") {
    if (block.sourceToolName === "Bash") {
      const lines = block.content.split("\n");
      const lastLine = lines[lines.length - 1] || lines[lines.length - 2] || "";
      return (
        <div className={cn(
          "text-xs py-0.5 truncate font-mono",
          block.isError ? "text-red-500" : "text-zinc-500"
        )}>
          {lastLine.slice(0, 100)}
        </div>
      );
    }
    // Hide generic tool results in compact view too
    return null;
  }
  return null;
}

function formatJson(str: string): string {
  try {
    return JSON.stringify(JSON.parse(str), null, 2);
  } catch {
    return str;
  }
}

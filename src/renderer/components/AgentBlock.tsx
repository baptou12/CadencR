import { useState } from "react";
import { cn } from "@/lib/utils";
import { ChevronRightIcon, ChevronDownIcon, WrenchIcon, BrainIcon, CodeIcon, LayersIcon, LoaderIcon } from "lucide-react";
import { parseToolCall } from "@/lib/tool-call-parser";

/** Block types that the agent stream can produce */
export type BlockType = "text" | "code" | "tool_call" | "tool_result" | "thinking";

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
}

interface AgentBlockProps {
  block: AgentBlockData;
  /** Whether the parent agent is still streaming */
  isStreaming?: boolean;
  /** Whether all Task blocks should show all children */
  expandAllTasks?: boolean;
  /** Callback to expand all Task blocks in the agent */
  onExpandAllTasks?: () => void;
}

export function AgentBlock({ block, isStreaming, expandAllTasks, onExpandAllTasks }: AgentBlockProps) {
  switch (block.type) {
    case "text":
      return <TextBlock content={block.content} />;
    case "code":
      return <CodeBlock content={block.content} language={block.language} />;
    case "tool_call":
      if (block.toolName === "Task" && block.childBlocks) {
        return <TaskAgentBlock block={block} isStreaming={isStreaming} expandAll={expandAllTasks} onExpandAll={onExpandAllTasks} />;
      }
      return <ToolCallBlock name={block.toolName ?? "unknown"} args={block.toolArgs} />;
    case "tool_result":
      return <ToolResultBlock content={block.content} isError={block.isError} />;
    case "thinking":
      return <ThinkingBlock content={block.content} />;
    default:
      return null;
  }
}

function TextBlock({ content }: { content: string }) {
  return (
    <div className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
      {content}
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

function ToolResultBlock({ content, isError }: { content: string; isError?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const preview = content.length > 200 ? content.slice(0, 200) + "..." : content;

  return (
    <div
      className={cn(
        "my-1 rounded-md border px-3 py-1.5 text-xs",
        isError
          ? "border-red-800 bg-red-500/5 text-red-300"
          : "border-border bg-muted/30 text-muted-foreground"
      )}
    >
      <button
        type="button"
        className="w-full text-left"
        onClick={() => setExpanded(!expanded)}
      >
        <pre className="whitespace-pre-wrap overflow-x-auto">
          {expanded ? content : preview}
        </pre>
      </button>
    </div>
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

const DEFAULT_VISIBLE_CHILDREN = 5;

function TaskAgentBlock({ block, isStreaming, expandAll, onExpandAll }: { block: AgentBlockData; isStreaming?: boolean; expandAll?: boolean; onExpandAll?: () => void }) {
  const [expanded, setExpanded] = useState(true);
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

  const showAll = !!expandAll;
  const visibleChildren = showAll ? children : children.slice(-DEFAULT_VISIBLE_CHILDREN);
  const hiddenCount = children.length - visibleChildren.length;

  return (
    <div className="my-1 rounded-md border border-indigo-700 bg-indigo-500/5">
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs"
        onClick={() => setExpanded(!expanded)}
      >
        <LayersIcon className="size-3 text-indigo-400" />
        <span className="font-medium text-indigo-300">Task</span>
        <span className="truncate text-muted-foreground">{description}</span>
        {isRunning && (
          <LoaderIcon className="size-3 animate-spin text-indigo-500 shrink-0" />
        )}
        <span className="ml-auto text-muted-foreground shrink-0">{children.length} action{children.length !== 1 ? "s" : ""}</span>
        {expanded ? (
          <ChevronDownIcon className="size-3 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRightIcon className="size-3 shrink-0 text-muted-foreground" />
        )}
      </button>
      {expanded && (
        <div className="border-t border-indigo-800 px-3 py-2 space-y-0.5">
          {hiddenCount > 0 && (
            <button
              type="button"
              className="text-xs text-indigo-400 hover:underline mb-1"
              onClick={onExpandAll}
            >
              Show all {children.length} actions ({hiddenCount} hidden)
            </button>
          )}
          {visibleChildren.map((child) => (
            <CompactBlock key={child.id} block={child} />
          ))}
          {isRunning && children.length > 0 && (
            <div className="flex items-center gap-1.5 pt-1 text-xs text-muted-foreground">
              <LoaderIcon className="size-3 animate-spin" />
              Working...
            </div>
          )}
        </div>
      )}
    </div>
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
    return (
      <div className={cn(
        "text-xs py-0.5 truncate",
        block.isError ? "text-red-500" : "text-muted-foreground/60"
      )}>
        {block.isError ? "Error: " : ""}{block.content.slice(0, 80)}
      </div>
    );
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

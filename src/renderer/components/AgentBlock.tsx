import { useState } from "react";
import { cn } from "@/lib/utils";
import { ChevronRightIcon, WrenchIcon, BrainIcon, CodeIcon } from "lucide-react";

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
}

interface AgentBlockProps {
  block: AgentBlockData;
}

export function AgentBlock({ block }: AgentBlockProps) {
  switch (block.type) {
    case "text":
      return <TextBlock content={block.content} />;
    case "code":
      return <CodeBlock content={block.content} language={block.language} />;
    case "tool_call":
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

  return (
    <div className="my-1 rounded-md border border-border bg-blue-500/5">
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs"
        onClick={() => setExpanded(!expanded)}
      >
        <WrenchIcon className="size-3 text-blue-600 dark:text-blue-400" />
        <span className="font-medium text-blue-700 dark:text-blue-300">{name}</span>
        <ChevronRightIcon
          className={cn(
            "ml-auto size-3 text-muted-foreground transition-transform",
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
          ? "border-red-300 bg-red-500/5 text-red-700 dark:border-red-800 dark:text-red-300"
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
        <BrainIcon className="size-3 text-purple-600 dark:text-purple-400" />
        <span className="font-medium text-purple-700 dark:text-purple-300">Thinking</span>
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

function formatJson(str: string): string {
  try {
    return JSON.stringify(JSON.parse(str), null, 2);
  } catch {
    return str;
  }
}

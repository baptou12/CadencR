import { useState, useCallback, memo, useMemo } from "react";
import { cn } from "@/lib/utils";
import { ChevronRightIcon, WrenchIcon, BrainIcon, LayersIcon, LoaderIcon, TerminalIcon, CopyIcon, CheckIcon, CircleCheckIcon, CircleXIcon } from "lucide-react";
import { parseToolCall, parseCadenceMcpTool } from "@/lib/tool-call-parser";
import { CadenceMcpBlock, CompactCadenceMcpBlock } from "@/components/CadenceMcpBlock";
import { Markdown } from "@/components/Markdown";
import { InlineDiffBlock } from "@/components/InlineDiffBlock";
import { ClipboardCheck } from "lucide-react";
import { CollapsibleBlock } from "@/components/ui/collapsible-block";
import { parseAnsi } from "@/lib/ansi-to-html";
import { CodeBlockHeader } from "@/components/CodeBlockHeader";
import { useCodeBlockActions } from "@/components/CodeBlockActionsContext";

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
export type BlockType = "text" | "code" | "tool_call" | "tool_result" | "thinking" | "user_message" | "compact_divider" | "clear_divider";

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
  /** ISO timestamp from the DB message */
  createdAt?: string;
  /** Model name for assistant messages (e.g. "claude-opus-4-6") */
  model?: string;
  /** Plan approval status — set after user approves or rejects */
  planApprovalStatus?: "approved" | "rejected";
}

interface AgentBlockProps {
  block: AgentBlockData;
  /** Whether the parent agent is still streaming */
  isStreaming?: boolean;
  /** Base path to strip from file paths in diffs */
  basePath?: string;
}

export const AgentBlock = memo(function AgentBlock({ block, isStreaming, basePath }: AgentBlockProps) {
  switch (block.type) {
    case "text":
      return <TextBlock content={block.content} />;
    case "code":
      return <CodeBlock content={block.content} language={block.language} />;
    case "tool_call":
      if (block.toolName === "TodoWrite") return null;
      if ((block.toolName === "Task" || block.toolName === "Agent") && block.childBlocks) {
        return <TaskAgentBlock block={block} isStreaming={isStreaming} basePath={basePath} />;
      }
      if (block.toolName === "ExitPlanMode" || block.toolName?.endsWith("__show_plan") || block.toolName?.endsWith("__show_prd")) {
        return <PlanBlock args={block.toolArgs} approvalStatus={block.planApprovalStatus} />;
      }
      if (block.toolName === "Write" || block.toolName === "Edit") {
        const diff = diffFromToolArgs(block.toolName, block.toolArgs);
        if (diff && !diff.filePath.includes("/.claude/plans/")) {
          return (
            <div>
              <ToolCallBlock name={block.toolName} args={block.toolArgs} basePath={basePath} />
              <InlineDiffBlock
                filePath={diff.filePath}
                oldContent={diff.oldContent}
                newContent={diff.newContent}
                basePath={basePath}
              />
            </div>
          );
        }
      }
      return <ToolCallBlock name={block.toolName ?? "unknown"} args={block.toolArgs} basePath={basePath} />;
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
    case "compact_divider":
      return <CompactDivider />;
    case "clear_divider":
      return <ClearDivider previousSessionId={block.content} />;
    default:
      return null;
  }
});

const TextBlock = memo(function TextBlock({ content }: { content: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [content]);

  return (
    <div className="group/textblock">
      <Markdown content={content} />
      <div className="opacity-0 group-hover/textblock:opacity-100 transition-colors">
        <button
          type="button"
          onClick={handleCopy}
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-foreground/70 hover:bg-accent hover:text-foreground transition-colors"
          title="Copy to clipboard"
        >
          {copied ? (
            <>
              <CheckIcon className="size-3 text-green-400" />
              <span className="text-green-400">Copied</span>
            </>
          ) : (
            <>
              <CopyIcon className="size-3" />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
});

function PlanBlock({ args, approvalStatus }: { args?: string; approvalStatus?: "approved" | "rejected" }) {
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
      {approvalStatus && (
        <div className={cn(
          "flex items-center gap-1.5 border-t px-3 py-1.5 text-xs font-medium",
          approvalStatus === "approved"
            ? "border-green-800/50 text-green-400"
            : "border-red-800/50 text-red-400",
        )}>
          {approvalStatus === "approved"
            ? <><CircleCheckIcon className="size-3" /> Approved</>
            : <><CircleXIcon className="size-3" /> Rejected</>}
        </div>
      )}
    </div>
  );
}

const SHELL_LANGUAGES = new Set(["bash", "sh", "zsh", "shell", "console", "terminal"]);

function CodeBlock({ content, language }: { content: string; language?: string }) {
  const { sendToTerminal } = useCodeBlockActions();
  const isShell = !!language && SHELL_LANGUAGES.has(language);

  return (
    <div className="my-1 rounded-md border border-border bg-muted/50 overflow-hidden group/codeblock">
      {language && (
        <CodeBlockHeader
          language={language}
          code={content}
          showTerminalButton={isShell && !!sendToTerminal}
          onSendToTerminal={sendToTerminal}
        />
      )}
      <pre className="overflow-x-auto p-3 text-xs leading-relaxed">
        <code>{content}</code>
      </pre>
    </div>
  );
}

/** Strip the project base path prefix to show a relative path. */
function toRelativePath(filePath: string, basePath?: string): string {
  if (!basePath || !filePath.startsWith(basePath)) return filePath;
  return filePath.slice(basePath.endsWith("/") ? basePath.length : basePath.length + 1);
}

function ToolCallBlock({ name, args, basePath }: { name: string; args?: string; basePath?: string }) {
  const [expanded, setExpanded] = useState(false);
  const cadenceMcp = parseCadenceMcpTool(name, args);
  if (cadenceMcp) return <CadenceMcpBlock mcp={cadenceMcp} args={args} />;

  const summary = parseToolCall(name, args);
  const detail = summary?.detail && basePath ? toRelativePath(summary.detail, basePath) : summary?.detail;

  return (
    <div className="my-1 rounded-md border border-border bg-blue-500/5">
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs"
        onClick={() => setExpanded(!expanded)}
      >
        <WrenchIcon className="size-3 text-blue-400" />
        <span className="font-medium text-blue-300">{name}</span>
        {detail && (
          <span className="truncate text-muted-foreground">{detail}</span>
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

const BashOutputBlock = memo(function BashOutputBlock({ content, isError }: { content: string; isError?: boolean }) {
  const lines = useMemo(() => content.split("\n"), [content]);
  const totalLines = lines.length;
  const truncatedAnsi = useMemo(() => parseAnsi(lines.slice(-DEFAULT_BASH_LINES).join("\n")), [lines]);

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
          {showAll ? parseAnsi(content) : truncatedAnsi}
        </pre>
      )}
    </CollapsibleBlock>
  );
});

const ThinkingBlock = memo(function ThinkingBlock({ content }: { content: string }) {
  const [expanded, setExpanded] = useState(true);

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
});

function CompactDivider() {
  return (
    <div className="flex items-center gap-3 py-3">
      <div className="h-px flex-1 bg-yellow-500/30" />
      <span className="text-xs font-medium text-yellow-500">Compacted</span>
      <div className="h-px flex-1 bg-yellow-500/30" />
    </div>
  );
}

function ClearDivider({ previousSessionId }: { previousSessionId?: string }) {
  return (
    <div className="flex flex-col items-center gap-1 py-3">
      {previousSessionId && (
        <span className="text-[10px] text-muted-foreground/50 font-mono">{previousSessionId}</span>
      )}
      <div className="flex w-full items-center gap-3">
        <div className="h-px flex-1 bg-cyan-500/30" />
        <span className="text-xs font-medium text-cyan-500">Cleared</span>
        <div className="h-px flex-1 bg-cyan-500/30" />
      </div>
    </div>
  );
}

function UserMessageBlock({ content }: { content: string }) {
  // Content may be a JSON-stringified array of content blocks (text + image)
  // when the user attached images to the message.
  let textContent = content;
  let imageBlocks: Array<{ source: { media_type: string; data: string } }> = [];

  if (content.startsWith("[")) {
    try {
      const parsed = JSON.parse(content) as Array<{ type: string; text?: string; source?: { media_type: string; data: string } }>;
      if (Array.isArray(parsed)) {
        const texts: string[] = [];
        for (const block of parsed) {
          if (block.type === "text" && block.text) texts.push(block.text);
          else if (block.type === "image" && block.source) imageBlocks.push({ source: block.source });
        }
        textContent = texts.join("\n");
      }
    } catch {
      // Not JSON — render as plain text
    }
  }

  return (
    <div className="my-1 flex justify-end">
      <div className="rounded-md border border-primary/30 bg-primary/10 px-3 py-1.5 text-sm max-w-[80%]">
        <Markdown content={textContent} className="user-message-markdown" />
        {imageBlocks.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {imageBlocks.map((img, i) => (
              <img
                key={i}
                src={`data:${img.source.media_type};base64,${img.source.data}`}
                alt={`Attachment ${i + 1}`}
                className="max-h-48 max-w-full rounded border border-border"
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

const DEFAULT_VISIBLE_CHILDREN = 5;

function TaskAgentBlock({ block, isStreaming, basePath }: { block: AgentBlockData; isStreaming?: boolean; basePath?: string }) {
  const toolCalls = (block.childBlocks ?? []).filter((c) => c.type === "tool_call");
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
      totalCount={toolCalls.length}
      visibleCount={DEFAULT_VISIBLE_CHILDREN}
      unit="actions"
      className="border-indigo-700 bg-indigo-500/5"
      headerClassName=""
      toggleClassName="ml-auto text-indigo-500 hover:text-indigo-300"
      bodyClassName="border-t border-indigo-800 px-3 py-2 space-y-0.5"
      truncationClassName="text-indigo-800"
      header={<>
        <LayersIcon className="size-3 text-indigo-400" />
        <span className="font-medium text-indigo-300">{block.toolName}</span>
        <span className="truncate text-muted-foreground">{description}</span>
        {isRunning && (
          <LoaderIcon className="size-3 animate-spin text-indigo-500 shrink-0" />
        )}
      </>}
    >
      {({ showAll }) => (<>
        {(showAll ? toolCalls : toolCalls.slice(-DEFAULT_VISIBLE_CHILDREN)).map((child) => (
          <CompactBlock key={child.id} block={child} basePath={basePath} />
        ))}
      </>)}
    </CollapsibleBlock>
  );
}

function CompactBlock({ block, basePath }: { block: AgentBlockData; basePath?: string }) {
  if (block.type === "tool_call" && block.toolName) {
    if (block.toolName === "ExitPlanMode" || block.toolName.endsWith("__show_plan") || block.toolName.endsWith("__show_prd")) {
      return <PlanBlock args={block.toolArgs} approvalStatus={block.planApprovalStatus} />;
    }
    const cadenceMcp = parseCadenceMcpTool(block.toolName, block.toolArgs);
    if (cadenceMcp) return <CompactCadenceMcpBlock mcp={cadenceMcp} />;
    const summary = parseToolCall(block.toolName, block.toolArgs);
    const detail = summary?.detail && basePath ? toRelativePath(summary.detail, basePath) : summary?.detail;
    return (
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground py-0.5">
        <WrenchIcon className="size-2.5 text-blue-500 shrink-0" />
        <span className="font-medium text-foreground/70">{block.toolName}</span>
        {detail && <span className="truncate">{detail}</span>}
      </div>
    );
  }
  if (block.type === "text" && block.content) {
    const preview = block.content.length > 120 ? block.content.slice(0, 120) + "..." : block.content;
    return (
      <div className="text-xs text-muted-foreground py-0.5 truncate">{preview}</div>
    );
  }
  if (block.type === "thinking" && block.content) {
    const preview = block.content.length > 120 ? block.content.slice(0, 120) + "..." : block.content;
    return (
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground py-0.5">
        <BrainIcon className="size-2.5 text-purple-500 shrink-0" />
        <span className="truncate">{preview}</span>
      </div>
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
          {parseAnsi(lastLine)}
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

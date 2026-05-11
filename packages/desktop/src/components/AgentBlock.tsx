import { useState, useCallback, memo, useMemo } from "react";
import { cn, toRelativePath } from "@/lib/utils";
import { ChevronRightIcon, WrenchIcon, CopyIcon, CheckIcon } from "lucide-react";
import {
  isCadencrPlanPresentationTool,
  parseCadencrMcpTool,
  parseToolCall,
} from "@/lib/tool-call-parser";
import {
  extractBashCommand,
  extractBashOutput,
  extractBashResultOutput,
  extractInlineDiffPreview,
  isFileChangeTool,
  isToolCallRunning,
  normalizeToolName,
} from "@/lib/tool-adapter";
import { CadencrMcpBlock } from "@/components/CadencrMcpBlock";
import { Markdown } from "@/components/Markdown";
import { InlineDiffBlock } from "@/components/InlineDiffBlock";
import { UserMessageBlock } from "@/components/UserMessageBlock";
import { TaskAgentBlock } from "@/components/TaskAgentBlock";
import { PlanBlock } from "@/components/PlanBlock";
import { BashBlock } from "@/components/BashBlock";
import { ThinkingBlock } from "@/components/ThinkingBlock";
import { CompactDivider, ClearDivider } from "@/components/StreamDividers";
import { CodeBlockHeader } from "@/components/CodeBlockHeader";
import { useCodeBlockActions } from "@/components/CodeBlockActionsContext";
import { parseToolArgsObject, stringArg } from "@/lib/tool-args";

/** Block types that the agent stream can produce */
export type BlockType =
  | "text"
  | "code"
  | "tool_call"
  | "tool_result"
  | "thinking"
  | "user_message"
  | "compact_divider"
  | "clear_divider";

/** Build a lookup map from toolUseId → tool_result block. */
export function buildToolResultMap(blocks: AgentBlockData[]): Map<string, AgentBlockData> {
  const map = new Map<string, AgentBlockData>();
  for (const b of blocks) {
    if (b.type === "tool_result" && b.toolUseId) map.set(b.toolUseId, b);
  }
  return map;
}

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
  /** Whether `content` was server-side truncated and needs full-content fetch on expand. */
  truncatedContent?: boolean;
}

interface AgentBlockProps {
  block: AgentBlockData;
  /** Whether the parent agent is still streaming */
  isStreaming?: boolean;
  /** Base path to strip from file paths in diffs */
  basePath?: string;
  /** Map of toolUseId → tool_result block for inlining results into tool_call blocks */
  toolResultMap?: Map<string, AgentBlockData>;
}

export const AgentBlock = memo(function AgentBlock({
  block,
  isStreaming,
  basePath,
  toolResultMap,
}: AgentBlockProps) {
  // Skip the Markdown cache for the actively streaming block so partial
  // states do not pollute the LRU. All other blocks (older history, idle
  // sessions) are stable and benefit from the cache when Virtuoso recycles
  // them in and out of the viewport.
  const markdownCacheKey = isStreaming ? undefined : block.id;
  switch (block.type) {
    case "text":
      return block.isError ? (
        <div className="text-red-400 text-sm">
          <TextBlock content={block.content} cacheKey={markdownCacheKey} />
        </div>
      ) : (
        <TextBlock content={block.content} cacheKey={markdownCacheKey} />
      );
    case "code":
      return <CodeBlock content={block.content} language={block.language} />;
    case "tool_call": {
      if (block.toolName === "TodoWrite") return null;
      if ((block.toolName === "Task" || block.toolName === "Agent") && block.childBlocks) {
        return <TaskAgentBlock block={block} isStreaming={isStreaming} basePath={basePath} />;
      }
      if (
        block.toolName === "ExitPlanMode" ||
        (isPlanPresentationTool(block.toolName) && hasAttachedPlanContent(block.toolArgs))
      ) {
        return <PlanBlock args={block.toolArgs} approvalStatus={block.planApprovalStatus} />;
      }
      // Bash: unified block with command header + output body
      if (block.toolName === "Bash") {
        const result = block.toolUseId ? toolResultMap?.get(block.toolUseId) : undefined;
        const running = !result && isToolCallRunning(block.toolArgs);
        const resultOutput = result ? extractBashResultOutput(result.content) : undefined;
        return (
          <BashBlock
            command={extractBashCommand(block.toolArgs)}
            content={resultOutput ?? extractBashOutput(block.toolArgs)}
            running={running}
            isError={result?.isError}
            messageId={result ? messageIdFromBlockId(result.id) : undefined}
            truncatedContent={result?.truncatedContent === true}
          />
        );
      }
      // Edit/Write: unified diff block (no separate ToolCallBlock header)
      if (isFileChangeTool(block.toolName)) {
        const diff = extractInlineDiffPreview(block.toolName ?? "", block.toolArgs);
        if (diff && !diff.filePath.includes("/.claude/plans/")) {
          return (
            <InlineDiffBlock
              filePath={diff.filePath}
              oldContent={diff.oldContent}
              newContent={diff.newContent}
              basePath={basePath}
              toolName={normalizeToolName(block.toolName ?? "")}
            />
          );
        }
      }
      return (
        <ToolCallBlock
          name={block.toolName ?? "unknown"}
          args={block.toolArgs}
          basePath={basePath}
        />
      );
    }
    case "tool_result": {
      // Bash results are inlined into the tool_call block — skip standalone rendering
      if (block.sourceToolName === "Bash") {
        return null;
      }
      // Edit/Write results are already shown via the diff — skip
      if (isFileChangeTool(block.sourceToolName)) {
        return null;
      }
      if (block.sourceToolName === "Agent" || block.sourceToolName === "Task") {
        return <AgentResultBlock content={block.content} />;
      }
      // Hide generic tool results (Grep, Read, Glob, etc.) to reduce noise.
      return null;
    }
    case "thinking":
      return <ThinkingBlock content={block.content} cacheKey={markdownCacheKey} />;
    case "user_message":
      return <UserMessageBlock content={block.content} />;
    case "compact_divider":
      return <CompactDivider metadata={block.content} />;
    case "clear_divider":
      return <ClearDivider previousSessionId={block.content} />;
    default:
      return null;
  }
});

function isPlanPresentationTool(toolName: string | undefined): boolean {
  return toolName === "ExitPlanMode" || isCadencrPlanPresentationTool(toolName);
}

function messageIdFromBlockId(id: string): number | undefined {
  if (!id.startsWith("msg-")) return undefined;
  const parsed = Number(id.slice(4));
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function hasAttachedPlanContent(args: string | undefined): boolean {
  return !!stringArg(parseToolArgsObject(args), "plan");
}

/** Render the final text output from an Agent/Task tool_result (JSON content blocks). */
function AgentResultBlock({ content }: { content: string }) {
  const text = useMemo(() => {
    try {
      const blocks = JSON.parse(content) as Array<{ type?: string; text?: string }>;
      return blocks
        .filter((b) => b.type === "text" || (!b.type && typeof b.text === "string"))
        .map((b) => b.text ?? "")
        .join("\n");
    } catch {
      return content;
    }
  }, [content]);
  if (!text) return null;
  return <TextBlock content={text} />;
}

const TextBlock = memo(function TextBlock({
  content,
  cacheKey,
}: {
  content: string;
  cacheKey?: string;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [content]);

  return (
    <div className="group/textblock">
      <Markdown content={content} cacheKey={cacheKey} />
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

function ToolCallBlock({
  name,
  args,
  basePath,
}: {
  name: string;
  args?: string;
  basePath?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const canonicalName = normalizeToolName(name);
  const cadencrMcp = parseCadencrMcpTool(canonicalName, args);
  if (cadencrMcp) return <CadencrMcpBlock mcp={cadencrMcp} args={args} />;

  const summary = parseToolCall(canonicalName, args);
  const detail =
    summary?.detail && basePath ? toRelativePath(summary.detail, basePath) : summary?.detail;

  return (
    <div className="my-1 rounded-md border border-border bg-[var(--block-tool-bg)]">
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs"
        onClick={() => setExpanded(!expanded)}
      >
        <WrenchIcon className="size-3 text-[var(--block-tool-accent)]" />
        <span className="font-medium text-[var(--block-tool-accent)]">{canonicalName}</span>
        {detail && <span className="truncate text-muted-foreground">{detail}</span>}
        <ChevronRightIcon
          className={cn(
            "ml-auto size-3 shrink-0 text-muted-foreground transition-transform",
            expanded && "rotate-90",
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

function formatJson(str: string): string {
  try {
    return JSON.stringify(JSON.parse(str), null, 2);
  } catch {
    return str;
  }
}

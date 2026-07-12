import { extractApplyPatchPrimaryPath } from "@/lib/apply-patch";
import { parseToolArgsObject, stringArg } from "@/lib/tool-args";
import { extractBashCommandFromArgs, normalizeToolName } from "@/lib/tool-adapter";
import { parseMcpTool } from "@/lib/mcp-tool-parser";

/**
 * Parses Claude Code tool call arguments into human-readable summaries.
 * Used to show what the agent is doing (e.g. "Reading src/main.ts").
 *
 * Add new tool parsers by extending the `toolParsers` map.
 */

interface ToolSummary {
  /** Short label like "Running subtask" */
  label: string;
  /** Detail string like "Find agent output parsing files" */
  detail?: string;
}

export function isCadencrPlanPresentationTool(_toolName: string | undefined): boolean {
  return false;
}

type ToolParser = (args: Record<string, unknown>) => ToolSummary;

const toolParsers: Record<string, ToolParser> = {
  Task: (args) => ({
    label: "Running subtask",
    detail: stringArg(args, "description"),
  }),

  Agent: (args) => ({
    label: "Running subtask",
    detail: stringArg(args, "description"),
  }),

  Bash: (args) => ({
    label: "Running command",
    detail: extractBashCommandFromArgs(args),
  }),

  exec_command: (args) => ({
    label: "Starting terminal command",
    detail: extractBashCommandFromArgs(args),
  }),

  write_stdin: (args) => ({
    label: "Writing to terminal",
    detail: writeStdinDetail(args),
  }),

  Glob: (args) => {
    const pattern = typeof args.pattern === "string" ? args.pattern : undefined;
    const path = typeof args.path === "string" ? args.path : undefined;
    const parts = [pattern, path].filter(Boolean);
    return {
      label: "Finding files",
      detail: parts.length > 0 ? parts.join(" in ") : undefined,
    };
  },

  Grep: (args) => {
    const pattern = typeof args.pattern === "string" ? args.pattern : undefined;
    const type = typeof args.type === "string" ? args.type : undefined;
    const path = typeof args.path === "string" ? args.path : undefined;
    const parts: string[] = [];
    if (pattern) parts.push(pattern);
    if (type) parts.push(`(${type})`);
    if (path) parts.push(`in ${path}`);
    return {
      label: "Searching code",
      detail: parts.length > 0 ? parts.join(" ") : undefined,
    };
  },

  Read: (args) => ({
    label: "Reading file",
    detail: stringArg(args, "file_path", "filePath", "path"),
  }),

  LS: (args) => ({
    label: "Listing files",
    detail: stringArg(args, "path", "directory", "dir"),
  }),

  Write: (args) => ({
    label: "Writing file",
    detail: stringArg(args, "file_path", "filePath", "path"),
  }),

  Edit: (args) => ({
    label: "Editing file",
    detail: stringArg(args, "file_path", "filePath", "path"),
  }),

  ApplyPatch: (args) => ({
    label: "Applying patch",
    detail: extractApplyPatchPrimaryPath(args),
  }),

  WebSearch: (args) => ({
    label: "Searching web",
    detail: stringArg(args, "query"),
  }),

  WebFetch: (args) => ({
    label: "Fetching page",
    detail: stringArg(args, "url"),
  }),

  Skill: (args) => ({
    label: "Running skill",
    detail: stringArg(args, "skill", "name"),
  }),

  ToolSearch: (args) => ({
    label: "Searching tools",
    detail: stringArg(args, "query"),
  }),

  ExitPlanMode: () => ({
    label: "Plan ready for review",
  }),
};

function writeStdinDetail(args: Record<string, unknown>): string | undefined {
  const sessionId = sessionIdDetail(args);
  const chars = typeof args.chars === "string" ? args.chars : undefined;
  const suffix = sessionId ? ` ${sessionId}` : "";

  if (chars === undefined || chars.length === 0) return `poll session${suffix}`.trim();
  if (chars === "\u0003") return `interrupt session${suffix}`.trim();
  if (chars === "\u0004") return `send EOF to session${suffix}`.trim();
  return `send ${chars.length.toLocaleString()} chars to session${suffix}`.trim();
}

function sessionIdDetail(args: Record<string, unknown>): string | undefined {
  const value = args.session_id ?? args.sessionId ?? args.processId;
  if (typeof value === "string" && value.length > 0) return value;
  if (typeof value === "number") return String(value);
  return undefined;
}

/**
 * Parse a tool call into a human-readable summary.
 * Returns undefined if the tool is not recognized.
 */
export function parseToolCall(toolName: string, toolArgs?: string): ToolSummary | undefined {
  const parser = toolParsers[normalizeToolName(toolName)];
  if (!parser) return undefined;

  const args = parseToolArgsObject(toolArgs) ?? {};

  return parser(args);
}

/**
 * Get an activity label for the streaming indicator.
 * Returns something like "Reading src/main.ts" or "Running command: git status".
 */
export function getToolActivityLabel(toolName: string, toolArgs?: string): string {
  const canonicalToolName = normalizeToolName(toolName);
  const mcp = parseMcpTool(canonicalToolName, toolArgs);
  if (mcp) {
    const prefix = `[${mcp.server}]`;
    return mcp.detail ? `${prefix} ${mcp.label}: ${mcp.detail}` : `${prefix} ${mcp.label}`;
  }
  const summary = parseToolCall(canonicalToolName, toolArgs);
  if (!summary) return `Running ${canonicalToolName}`;
  if (summary.detail) return `${summary.label}: ${summary.detail}`;
  return summary.label;
}

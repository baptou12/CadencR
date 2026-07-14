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
    detail: descriptionDetail(args) ?? stringArg(args, "prompt"),
  }),

  Agent: (args) => ({
    label: "Running subtask",
    detail: descriptionDetail(args) ?? stringArg(args, "prompt"),
  }),

  Bash: (args) => ({
    label: "Running command",
    detail: extractBashCommandFromArgs(args) ?? descriptionDetail(args),
  }),

  exec_command: (args) => ({
    label: "Starting terminal command",
    detail: extractBashCommandFromArgs(args),
  }),

  write_stdin: (args) => ({
    label: "Writing to terminal",
    detail: writeStdinDetail(args),
  }),

  Glob: (args) => ({
    label: "Finding files",
    detail: globDetail(args),
  }),

  Grep: (args) => ({
    label: "Searching code",
    detail: searchDetail(args),
  }),

  Search: (args) => ({
    label: "Searching code",
    detail: searchDetail(args),
  }),

  Read: (args) => ({
    label: "Reading file",
    detail: fileDetail(args),
  }),

  LS: (args) => ({
    label: "Listing files",
    detail: stringArg(args, "path", "directory", "dir") ?? descriptionDetail(args),
  }),

  Write: (args) => ({
    label: "Writing file",
    detail: fileDetail(args),
  }),

  Edit: (args) => ({
    label: "Editing file",
    detail: fileDetail(args),
  }),

  ApplyPatch: (args) => ({
    label: "Applying patch",
    detail: extractApplyPatchPrimaryPath(args) ?? descriptionDetail(args),
  }),

  Delete: (args) => ({
    label: "Deleting file",
    detail: fileDetail(args),
  }),

  Move: (args) => ({
    label: "Moving file",
    detail: moveDetail(args),
  }),

  Think: (args) => ({
    label: "Thinking",
    detail: descriptionDetail(args),
  }),

  Fetch: (args) => ({
    label: "Fetching resource",
    detail: stringArg(args, "url", "uri") ?? fileDetail(args),
  }),

  SwitchMode: (args) => ({
    label: "Switching mode",
    detail: stringArg(args, "targetModeId", "target_mode_id", "mode") ?? descriptionDetail(args),
  }),

  WebSearch: (args) => ({
    label: "Searching web",
    detail: stringArg(args, "query") ?? descriptionDetail(args),
  }),

  WebFetch: (args) => ({
    label: "Fetching page",
    detail: stringArg(args, "url") ?? descriptionDetail(args),
  }),

  GenerateImage: (args) => ({
    label: "Generating image",
    detail: stringArg(args, "filePath", "file_path") ?? descriptionDetail(args),
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

function descriptionDetail(args: Record<string, unknown>): string | undefined {
  return stringArg(args, "description", "title", "summary");
}

function fileDetail(args: Record<string, unknown>): string | undefined {
  return stringArg(args, "file_path", "filePath", "path") ?? descriptionDetail(args);
}

function globDetail(args: Record<string, unknown>): string | undefined {
  const pattern = stringArg(args, "pattern", "glob", "query") ?? descriptionDetail(args);
  const path = stringArg(args, "path", "directory", "dir");
  if (pattern && path && pattern !== path) return `${pattern} in ${path}`;
  return pattern ?? path;
}

function searchDetail(args: Record<string, unknown>): string | undefined {
  const query =
    stringArg(args, "pattern", "query", "searchTerm", "search_term") ?? descriptionDetail(args);
  const type = stringArg(args, "type");
  const path = stringArg(args, "path", "directory", "dir");
  const parts: string[] = [];
  if (query) parts.push(query);
  if (type) parts.push(`(${type})`);
  if (path && path !== query) parts.push(`in ${path}`);
  return parts.length > 0 ? parts.join(" ") : undefined;
}

function moveDetail(args: Record<string, unknown>): string | undefined {
  const source = stringArg(args, "source", "from", "oldPath", "old_path");
  const destination = stringArg(args, "destination", "to", "newPath", "new_path");
  if (source && destination) return `${source} → ${destination}`;
  return source ?? destination ?? fileDetail(args);
}

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
  const canonicalToolName = normalizeToolName(toolName);
  const args = parseToolArgsObject(toolArgs) ?? {};
  const parser = toolParsers[canonicalToolName];
  if (!parser) {
    const detail = genericDetail(args);
    return detail ? { label: `Running ${canonicalToolName}`, detail } : undefined;
  }

  return parser(args);
}

function genericDetail(args: Record<string, unknown>): string | undefined {
  return (
    descriptionDetail(args) ??
    stringArg(args, "file_path", "filePath", "path", "url", "uri", "query", "pattern")
  );
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

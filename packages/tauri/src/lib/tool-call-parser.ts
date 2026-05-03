import { extractApplyPatchPrimaryPath } from "@/lib/apply-patch";
import { parseToolArgsObject, stringArg } from "@/lib/tool-args";
import { extractBashCommandFromArgs, normalizeToolName } from "@/lib/tool-adapter";

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

/** Parsed Cadencr MCP tool name */
export interface CadencrMcpTool {
  /** Server name without prefix, e.g. "prd", "plan", "execute" */
  server: string;
  /** Raw tool name, e.g. "create_phase", "show_prd" */
  tool: string;
  /** Human-readable label, e.g. "Creating phase" */
  label: string;
  /** Detail extracted from args */
  detail?: string;
}

const CADENCR_MCP_PREFIX = "mcp__cadencr-";

/** Human-readable labels for known Cadencr MCP tools. Falls back to title-casing the tool name. */
const cadencrToolLabels: Record<string, string> = {
  read_plan: "Reading plan",
  create_phase: "Creating phase",
  update_phase: "Updating phase",
  remove_phase: "Removing phase",
  list_phases: "Listing phases",
  read_phase: "Reading phase",
  update_plan: "Updating plan",
  show_plan: "Showing plan",
  finalize_plan: "Finalizing plan",
  finalize_phases: "Finalizing phases",
  create_prd: "Creating PRD",
  edit_prd: "Editing PRD",
  show_prd: "Showing PRD",
  read_prd: "Reading PRD",
  mark_agent_done: "Marking done",
  mark_phase_done: "Marking phase done",
  list_conversations: "Listing conversations",
  read_conversation: "Reading conversation",
};

/**
 * Read a string arg, rejecting empty strings.
 *
 * OpenAI strict JSON schemas fill optional string fields with `""` when the
 * model doesn't provide them, so a naive `typeof === "string"` check would
 * short-circuit on that sentinel and prevent fall-back to the next field.
 */
function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** Extract a meaningful detail string from Cadencr MCP tool args. */
function cadencrDetail(tool: string, args: Record<string, unknown>): string | undefined {
  const title = nonEmptyString(args.title);
  if (title) return title;
  const summary = nonEmptyString(args.summary);
  if (summary) return summary;
  const commitMessage = nonEmptyString(args.commit_message);
  if (commitMessage) return commitMessage;
  const prompt = nonEmptyString(args.prompt);
  if (prompt) return prompt.slice(0, 80);
  const prd = nonEmptyString(args.prd);
  if (prd) return prd.slice(0, 80);
  if (tool === "read_phase" || tool === "mark_phase_done") {
    if (typeof args.phase_id === "number") return `Phase #${args.phase_id}`;
  }
  return undefined;
}

/** Title-case a snake_case tool name as fallback label. */
function snakeToLabel(name: string): string {
  return name
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * Try to parse a tool name as a Cadencr MCP tool (mcp__cadencr-<server>__<tool>).
 * Returns undefined if the tool name doesn't match.
 */
export function parseCadencrMcpTool(
  toolName: string,
  toolArgs?: string,
): CadencrMcpTool | undefined {
  if (!toolName.startsWith(CADENCR_MCP_PREFIX)) return undefined;
  const rest = toolName.slice(CADENCR_MCP_PREFIX.length);
  const sep = rest.indexOf("__");
  if (sep === -1) return undefined;

  const server = rest.slice(0, sep);
  const tool = rest.slice(sep + 2);

  const args = parseToolArgsObject(toolArgs) ?? {};

  return {
    server,
    tool,
    label: cadencrToolLabels[tool] ?? snakeToLabel(tool),
    detail: cadencrDetail(tool, args),
  };
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
  const cadencr = parseCadencrMcpTool(canonicalToolName, toolArgs);
  if (cadencr) {
    const prefix = `[${cadencr.server}]`;
    return cadencr.detail
      ? `${prefix} ${cadencr.label}: ${cadencr.detail}`
      : `${prefix} ${cadencr.label}`;
  }
  const summary = parseToolCall(canonicalToolName, toolArgs);
  if (!summary) return `Running ${canonicalToolName}`;
  if (summary.detail) return `${summary.label}: ${summary.detail}`;
  return summary.label;
}

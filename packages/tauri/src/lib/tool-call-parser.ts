import { extractApplyPatchPrimaryPath } from "@/lib/apply-patch";
import { stringArg } from "@/lib/tool-args";
import { normalizeToolName } from "@/lib/tool-adapter";

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

/** Parsed Cadence MCP tool name */
export interface CadenceMcpTool {
  /** Server name without prefix, e.g. "prd", "plan", "execute" */
  server: string;
  /** Raw tool name, e.g. "create_phase", "show_prd" */
  tool: string;
  /** Human-readable label, e.g. "Creating phase" */
  label: string;
  /** Detail extracted from args */
  detail?: string;
}

const CADENCE_MCP_PREFIX = "mcp__cadence-";

/** Human-readable labels for known Cadence MCP tools. Falls back to title-casing the tool name. */
const cadenceToolLabels: Record<string, string> = {
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

/** Extract a meaningful detail string from Cadence MCP tool args. */
function cadenceDetail(tool: string, args: Record<string, unknown>): string | undefined {
  if (typeof args.title === "string") return args.title;
  if (typeof args.summary === "string") return args.summary;
  if (typeof args.prd === "string") return args.prd.slice(0, 80);
  if (tool === "read_phase" || tool === "mark_phase_done") {
    if (typeof args.phase_id === "number") return `Phase #${args.phase_id}`;
  }
  return undefined;
}

/** Title-case a snake_case tool name as fallback label. */
function snakeToLabel(name: string): string {
  return name.split("_").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

/**
 * Try to parse a tool name as a Cadence MCP tool (mcp__cadence-<server>__<tool>).
 * Returns undefined if the tool name doesn't match.
 */
export function parseCadenceMcpTool(toolName: string, toolArgs?: string): CadenceMcpTool | undefined {
  if (!toolName.startsWith(CADENCE_MCP_PREFIX)) return undefined;
  const rest = toolName.slice(CADENCE_MCP_PREFIX.length);
  const sep = rest.indexOf("__");
  if (sep === -1) return undefined;

  const server = rest.slice(0, sep);
  const tool = rest.slice(sep + 2);

  let args: Record<string, unknown> = {};
  if (toolArgs) {
    try { args = JSON.parse(toolArgs) as Record<string, unknown>; } catch { /* streaming */ }
  }

  return {
    server,
    tool,
    label: cadenceToolLabels[tool] ?? snakeToLabel(tool),
    detail: cadenceDetail(tool, args),
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
    detail: stringArg(args, "command"),
  }),

  Glob: (args) => {
    const pattern =
      typeof args.pattern === "string" ? args.pattern : undefined;
    const path = typeof args.path === "string" ? args.path : undefined;
    const parts = [pattern, path].filter(Boolean);
    return {
      label: "Finding files",
      detail: parts.length > 0 ? parts.join(" in ") : undefined,
    };
  },

  Grep: (args) => {
    const pattern =
      typeof args.pattern === "string" ? args.pattern : undefined;
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

/**
 * Parse a tool call into a human-readable summary.
 * Returns undefined if the tool is not recognized.
 */
export function parseToolCall(
  toolName: string,
  toolArgs?: string,
): ToolSummary | undefined {
  const parser = toolParsers[normalizeToolName(toolName)];
  if (!parser) return undefined;

  let args: Record<string, unknown> = {};
  if (toolArgs) {
    try {
      args = JSON.parse(toolArgs) as Record<string, unknown>;
    } catch {
      // Args may be partial JSON during streaming — that's fine
      return { label: parser({}).label };
    }
  }

  return parser(args);
}

/**
 * Get an activity label for the streaming indicator.
 * Returns something like "Reading src/main.ts" or "Running command: git status".
 */
export function getToolActivityLabel(
  toolName: string,
  toolArgs?: string,
): string {
  const canonicalToolName = normalizeToolName(toolName);
  const cadence = parseCadenceMcpTool(canonicalToolName, toolArgs);
  if (cadence) {
    const prefix = `[${cadence.server}]`;
    return cadence.detail ? `${prefix} ${cadence.label}: ${cadence.detail}` : `${prefix} ${cadence.label}`;
  }
  const summary = parseToolCall(canonicalToolName, toolArgs);
  if (!summary) return `Running ${canonicalToolName}`;
  if (summary.detail) return `${summary.label}: ${summary.detail}`;
  return summary.label;
}

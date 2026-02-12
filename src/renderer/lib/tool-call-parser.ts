/**
 * Parses Claude Code tool call arguments into human-readable summaries.
 * Used to show what the agent is doing (e.g. "Reading src/main.ts").
 *
 * Add new tool parsers by extending the `toolParsers` map.
 */

export interface ToolSummary {
  /** Short label like "Running subtask" */
  label: string;
  /** Detail string like "Find agent output parsing files" */
  detail?: string;
}

type ToolParser = (args: Record<string, unknown>) => ToolSummary;

const toolParsers: Record<string, ToolParser> = {
  Task: (args) => ({
    label: "Running subtask",
    detail: typeof args.description === "string" ? args.description : undefined,
  }),

  Bash: (args) => ({
    label: "Running command",
    detail: typeof args.command === "string" ? args.command : undefined,
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
    detail: typeof args.file_path === "string" ? args.file_path : undefined,
  }),

  Write: (args) => ({
    label: "Writing file",
    detail: typeof args.file_path === "string" ? args.file_path : undefined,
  }),

  Edit: (args) => ({
    label: "Editing file",
    detail: typeof args.file_path === "string" ? args.file_path : undefined,
  }),

  WebSearch: (args) => ({
    label: "Searching web",
    detail: typeof args.query === "string" ? args.query : undefined,
  }),

  WebFetch: (args) => ({
    label: "Fetching page",
    detail: typeof args.url === "string" ? args.url : undefined,
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
  const parser = toolParsers[toolName];
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
  const summary = parseToolCall(toolName, toolArgs);
  if (!summary) return `Running ${toolName}`;
  if (summary.detail) return `${summary.label}: ${summary.detail}`;
  return summary.label;
}

import { extractApplyPatchPreview, isApplyPatchToolName } from "@/lib/apply-patch";
import { stringArg } from "@/lib/tool-args";

export interface InlineDiffPreview {
  filePath: string;
  oldContent: string;
  newContent: string;
}

const FILE_CHANGE_TOOLS = new Set(["Write", "Edit", "NotebookEdit", "ApplyPatch"]);

function parseToolArgsObject(toolArgs?: string): Record<string, unknown> | null {
  if (!toolArgs) return null;
  try {
    return JSON.parse(toolArgs) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function normalizeToolName(toolName: string): string {
  if (isApplyPatchToolName(toolName)) return "ApplyPatch";
  return toolName;
}

export function isFileChangeTool(toolName: string | undefined): boolean {
  if (!toolName) return false;
  return FILE_CHANGE_TOOLS.has(normalizeToolName(toolName));
}

export function extractBashOutput(toolArgs?: string): string | undefined {
  const args = parseToolArgsObject(toolArgs);
  if (!args) return undefined;
  // OpenCode keeps tool output/status under __opencode_* for some tool events.
  // We read both canonical and legacy keys so persisted history and live stream match.
  const output = args.output ?? args.__opencode_output;
  if (typeof output === "string") return output;
  if (output && typeof output === "object") {
    const structured = output as Record<string, unknown>;
    if (typeof structured.stdout === "string") return structured.stdout;
    if (typeof structured.output === "string") return structured.output;
  }
  return undefined;
}

export function extractToolStatus(toolArgs?: string): string | undefined {
  const args = parseToolArgsObject(toolArgs);
  if (!args) return undefined;
  const status = args.status ?? args.__opencode_status;
  return typeof status === "string" ? status.toLowerCase() : undefined;
}

export function isToolCallRunning(toolArgs?: string): boolean {
  const status = extractToolStatus(toolArgs);
  if (!status) return true;
  return status === "pending" || status === "running" || status === "active";
}

export function extractInlineDiffPreview(
  toolName: string,
  toolArgs?: string,
): InlineDiffPreview | null {
  const args = parseToolArgsObject(toolArgs);
  if (!args) return null;

  if (normalizeToolName(toolName) === "ApplyPatch") {
    return extractApplyPatchPreview(args);
  }

  const filePath = stringArg(args, "file_path", "filePath", "path");
  if (!filePath) return null;

  if (toolName === "Edit") {
    const oldString = stringArg(args, "old_string", "oldString") ?? "";
    const newString = stringArg(args, "new_string", "newString") ?? "";
    if (oldString || newString) {
      return { filePath, oldContent: oldString, newContent: newString };
    }
  }

  if (toolName === "Write") {
    const content = stringArg(args, "content") ?? "";
    if (content) {
      return { filePath, oldContent: "", newContent: content };
    }
  }

  return null;
}

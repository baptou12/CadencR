/**
 * Permission resolution module for agent tool calls.
 *
 * Determines whether a tool call should be auto-allowed or needs user approval.
 * Auto-allows operations within the worktree or /tmp, prompts for everything else.
 * Handles persisting user approvals to `.claude/settings.local.json`.
 */

import * as path from "node:path";
import * as fs from "node:fs";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Result when a tool is auto-allowed */
export type PermissionAllow = "allow";

/** Result when a tool is always denied (e.g. git push) */
export interface PermissionDeny {
  denied: true;
  /** Human-readable reason for the denial */
  reason: string;
}

/** Result when a tool needs user approval */
export interface PermissionPrompt {
  needs_prompt: true;
  /** Human-readable description of what the tool is trying to do */
  description: string;
  /** Pattern for settings.local.json (e.g. "Read(/path/**)" or "Bash(git push:*)") */
  pattern: string;
}

export type PermissionResult = PermissionAllow | PermissionDeny | PermissionPrompt;

// ---------------------------------------------------------------------------
// Tool → path field mapping
// ---------------------------------------------------------------------------

/** Tools that use `file_path` for their target path */
const FILE_PATH_TOOLS = new Set([
  "Read",
  "Write",
  "Edit",
  "MultiEdit",
  "NotebookRead",
  "NotebookEdit",
]);

/** Tools that use `path` for their target path */
const PATH_TOOLS = new Set(["Glob", "Grep"]);

/** Tools that have no file-system side effects and are always safe */
const ALWAYS_ALLOW_TOOLS = new Set([
  "WebSearch",
  "WebFetch",
  "AskUserQuestion",
  "ExitPlanMode",
  "TodoRead",
  "TodoWrite",
]);

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

/**
 * Check whether a resolved absolute path is within the worktree or /tmp.
 */
function isPathAllowed(resolvedPath: string, worktreePath: string): boolean {
  const normalizedWorktree = path.resolve(worktreePath);
  const normalizedPath = path.resolve(resolvedPath);

  return (
    normalizedPath.startsWith(normalizedWorktree + path.sep) ||
    normalizedPath === normalizedWorktree ||
    normalizedPath.startsWith("/tmp/") ||
    normalizedPath === "/tmp"
  );
}

/**
 * Extract the primary path from a tool's input based on tool name.
 * Returns null if the tool doesn't operate on file paths.
 */
function extractToolPath(
  toolName: string,
  input: Record<string, unknown>,
): string | null {
  if (FILE_PATH_TOOLS.has(toolName)) {
    const filePath = input.file_path ?? input.notebook_path;
    return typeof filePath === "string" ? filePath : null;
  }

  if (PATH_TOOLS.has(toolName)) {
    const p = input.path;
    return typeof p === "string" ? p : null;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Bash command analysis
// ---------------------------------------------------------------------------

/**
 * Check if a bash command contains `git push`.
 */
function containsGitPush(command: string): boolean {
  // Match "git push" as a standalone command (not inside a string like "echo git push")
  // Simple heuristic: look for git push at word boundaries
  return /\bgit\s+push\b/.test(command);
}

/**
 * Extract absolute paths from a bash command and check if any are outside the worktree.
 * Returns the first offending path, or null if all paths are within bounds.
 */
function findOutsidePath(
  command: string,
  worktreePath: string,
): string | null {
  // Match absolute paths (starting with /) in the command
  // This regex captures sequences starting with / followed by non-whitespace, non-special chars
  const pathRegex = /(?:^|\s|=|")(\/[^\s"'`;|&><()]+)/g;
  let match: RegExpExecArray | null;

  while ((match = pathRegex.exec(command)) !== null) {
    const candidate = match[1];
    // Skip common safe paths that aren't real file references
    if (
      candidate === "/dev/null" ||
      candidate.startsWith("/dev/") ||
      candidate.startsWith("/proc/")
    ) {
      continue;
    }
    if (!isPathAllowed(candidate, worktreePath)) {
      return candidate;
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Main resolution function
// ---------------------------------------------------------------------------

/**
 * Resolve whether a tool call should be allowed or needs user permission.
 *
 * @param toolName - The name of the tool being called
 * @param input - The tool's input parameters
 * @param worktreePath - The absolute path to the worktree directory
 * @param sessionCache - Set of patterns already approved in this session
 * @returns "allow" if the tool is safe, or a PermissionPrompt if user approval is needed
 */
export function resolvePermission(
  toolName: string,
  input: Record<string, unknown>,
  worktreePath: string,
  sessionCache: Set<string>,
): PermissionResult {
  // Always-allowed tools (no file system impact)
  if (ALWAYS_ALLOW_TOOLS.has(toolName)) {
    return "allow";
  }

  // MCP tools (prefixed with "mcp__") — auto-allow
  if (toolName.startsWith("mcp__")) {
    return "allow";
  }

  // Handle Bash specially
  if (toolName === "Bash") {
    const command =
      typeof input.command === "string" ? input.command : "";

    // Always deny git push — pushing is never allowed from agents
    if (containsGitPush(command)) {
      return {
        denied: true,
        reason: "git push is not allowed from agents. Push changes manually.",
      };
    }

    // Check for absolute paths outside the worktree
    const outsidePath = findOutsidePath(command, worktreePath);
    if (outsidePath) {
      const pattern = `Bash(${outsidePath}:*)`;
      if (sessionCache.has(pattern)) {
        return "allow";
      }
      return {
        needs_prompt: true,
        description: `Bash command references path outside worktree: \`${outsidePath}\``,
        pattern,
      };
    }

    // Bash command is within the worktree
    return "allow";
  }

  // Path-based tools (Read, Write, Edit, Glob, Grep, etc.)
  const toolPath = extractToolPath(toolName, input);
  if (toolPath !== null) {
    const resolvedPath = path.isAbsolute(toolPath)
      ? path.resolve(toolPath)
      : path.resolve(worktreePath, toolPath);

    if (isPathAllowed(resolvedPath, worktreePath)) {
      return "allow";
    }

    const pattern = `${toolName}(${resolvedPath})`;
    if (sessionCache.has(pattern)) {
      return "allow";
    }

    return {
      needs_prompt: true,
      description: `${toolName} wants to access \`${resolvedPath}\`, which is outside the worktree.`,
      pattern,
    };
  }

  // Unknown tool — auto-allow (safer than blocking unknown SDK-internal tools)
  return "allow";
}

// ---------------------------------------------------------------------------
// Settings local persistence
// ---------------------------------------------------------------------------

/**
 * Append a permission pattern to `<worktreePath>/.claude/settings.local.json`.
 *
 * Creates the file and directory if they don't exist.
 * Ensures no duplicate patterns.
 *
 * @param worktreePath - The worktree root directory
 * @param pattern - The permission pattern to add (e.g. "Read(/some/path)")
 */
export function appendToSettingsLocal(
  worktreePath: string,
  pattern: string,
): void {
  const claudeDir = path.join(worktreePath, ".claude");
  const settingsPath = path.join(claudeDir, "settings.local.json");

  // Read existing settings or create empty structure
  let settings: Record<string, unknown> = {};
  try {
    const content = fs.readFileSync(settingsPath, "utf-8");
    settings = JSON.parse(content) as Record<string, unknown>;
  } catch {
    // File doesn't exist or is invalid JSON — start fresh
  }

  // Ensure permissions.allow array exists
  if (
    !settings.permissions ||
    typeof settings.permissions !== "object"
  ) {
    settings.permissions = {};
  }
  const permissions = settings.permissions as Record<string, unknown>;

  if (!Array.isArray(permissions.allow)) {
    permissions.allow = [];
  }
  const allowList = permissions.allow as string[];

  // Add pattern if not already present
  if (!allowList.includes(pattern)) {
    allowList.push(pattern);
  }

  // Ensure .claude directory exists
  fs.mkdirSync(claudeDir, { recursive: true });

  // Write back
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n", "utf-8");
}

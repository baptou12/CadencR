/**
 * Permission resolution module for agent tool calls.
 *
 * Determines whether a tool call should be auto-allowed or needs user approval.
 * Auto-allows operations within the worktree or /tmp, prompts for everything else.
 * Handles persisting user approvals to `.claude/settings.local.json`.
 */

import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Result when a tool is auto-allowed */
export type PermissionAllow = "allow";

/** Result when a tool is always denied */
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
 * Check if a resolved path is an .env file (contains secrets).
 */
function isEnvFile(resolvedPath: string): boolean {
  const basename = path.basename(resolvedPath);
  return basename === ".env" || basename.startsWith(".env.") || basename.endsWith(".env");
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

interface DestructiveCommandMatch {
  description: string;
  pattern: string;
}

/**
 * Detect destructive or sensitive bash commands that require user confirmation.
 * Returns a prompt descriptor if the command matches, null otherwise.
 */
function detectDestructiveCommand(command: string): DestructiveCommandMatch | null {
  if (/\bgit\s+push\b/.test(command)) {
    return {
      description: "git push will push commits to a remote repository",
      pattern: "Bash(git push:*)",
    };
  }
  if (/\brm\s+(?:-\w*[rR]\w*[fF]\w*|-\w*[fF]\w*[rR]\w*)\b/.test(command)) {
    return {
      description: "rm -rf will recursively and forcefully delete files",
      pattern: "Bash(rm -rf:*)",
    };
  }
  if (/\bgit\s+reset\s+--hard\b/.test(command)) {
    return {
      description: "git reset --hard will discard all uncommitted changes",
      pattern: "Bash(git reset --hard:*)",
    };
  }
  if (/\bgit\s+clean\s+-\w*[fF]/.test(command)) {
    return {
      description: "git clean -f will remove untracked files from the repository",
      pattern: "Bash(git clean -f:*)",
    };
  }
  if (/\bgit\s+checkout\s+--\s/.test(command)) {
    return {
      description: "git checkout -- will discard changes in working files",
      pattern: "Bash(git checkout --:*)",
    };
  }
  if (/\bsudo\s+rm\b/.test(command)) {
    return {
      description: "sudo rm will delete files with root privileges",
      pattern: "Bash(sudo rm:*)",
    };
  }
  return null;
}

/**
 * Check if a candidate string looks like a real filesystem path
 * rather than a sed/awk substitution pattern or regex.
 *
 * Sed patterns like `s/foo/bar/g` produce candidates like `/foo/bar/g`
 * which are clearly not real paths.
 */
function looksLikeRealPath(candidate: string): boolean {
  // Must have at least two characters (/ + something)
  if (candidate.length < 2) return false;

  // Real paths have a meaningful first component after the leading /.
  // Sed/awk patterns like /foo/bar/g have short, flag-like trailing segments.
  // Reject candidates where the second-to-last segment is a single char
  // commonly used as sed/awk flags (e.g. /g, /p, /d, /i, /I, /w).
  // More importantly: reject anything that doesn't start with a plausible
  // directory name (letters, dots, ~) after the leading slash.
  const firstComponent = candidate.split("/")[1];
  if (!firstComponent) return false;

  // If the first path component looks like a top-level directory, it's likely real
  // e.g., /Users, /home, /opt, /var, /etc, /usr, /Library, /Applications
  // If it looks like a short regex token or sed command char, it's likely not
  if (firstComponent.length <= 1) return false;

  // Reject patterns that end with common sed/awk flags: /g, /p, /d, /i, /I, /w, /e
  if (/\/[gGpPdDiIwWe]$/.test(candidate)) {
    // But allow if the path has enough real-looking directory depth (3+ components)
    const components = candidate.split("/").filter(Boolean);
    if (components.length < 3) return false;
  }

  return true;
}

/**
 * Extract absolute paths from a bash command and check if any are outside the worktree.
 * Returns the first offending path, or null if all paths are within bounds.
 */
function findOutsidePath(
  command: string,
  worktreePath: string,
): string | null {
  // Match absolute paths (starting with /) in the command.
  // Must be preceded by whitespace, =, ", or start of string.
  // The path must start with / followed by a plausible directory name component.
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
    // Skip sed/awk substitution patterns and regex-like strings
    if (!looksLikeRealPath(candidate)) {
      continue;
    }
    if (!isPathAllowed(candidate, worktreePath)) {
      return candidate;
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Settings loading
// ---------------------------------------------------------------------------

/**
 * Load pre-approved permission patterns from settings files.
 * Reads from three locations (union, no duplicates):
 * 1. ~/.claude/settings.json (global user settings)
 * 2. <worktreePath>/.claude/settings.json (project settings)
 * 3. <worktreePath>/.claude/settings.local.json (local settings, where "Allow future" writes)
 */
export function loadAllowedPatterns(worktreePath: string): Set<string> {
  const patterns = new Set<string>();

  const settingsFiles = [
    path.join(os.homedir(), ".claude", "settings.json"),
    path.join(worktreePath, ".claude", "settings.json"),
    path.join(worktreePath, ".claude", "settings.local.json"),
  ];

  for (const filePath of settingsFiles) {
    try {
      const content = fs.readFileSync(filePath, "utf-8");
      const parsed = JSON.parse(content) as Record<string, unknown>;
      const permissions = parsed.permissions;
      if (
        permissions &&
        typeof permissions === "object" &&
        !Array.isArray(permissions)
      ) {
        const allow = (permissions as Record<string, unknown>).allow;
        if (Array.isArray(allow)) {
          for (const pattern of allow) {
            if (typeof pattern === "string") {
              patterns.add(pattern);
            }
          }
        }
      }
    } catch {
      // File doesn't exist or has invalid JSON — skip
    }
  }

  return patterns;
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

    // Check for destructive commands — prompt user rather than hard-deny
    const destructive = detectDestructiveCommand(command);
    if (destructive) {
      if (sessionCache.has(destructive.pattern)) {
        return "allow";
      }
      return {
        needs_prompt: true,
        description: destructive.description,
        pattern: destructive.pattern,
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

    // Protect .env files — prompt even within the worktree (may contain secrets)
    if (FILE_PATH_TOOLS.has(toolName) && isEnvFile(resolvedPath)) {
      const pattern = `${toolName}(${resolvedPath})`;
      if (sessionCache.has(pattern)) {
        return "allow";
      }
      return {
        needs_prompt: true,
        description: `${toolName} wants to read \`${resolvedPath}\`, which may contain secrets.`,
        pattern,
      };
    }

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

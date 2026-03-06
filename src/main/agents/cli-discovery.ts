import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execAsync } from "../git/worktree";
import { getDatabase } from "../db/database";

const COMMON_LOCATIONS = [
  "/usr/local/bin/claude",
  "/usr/bin/claude",
  "/opt/homebrew/bin/claude",
  path.join(os.homedir(), ".local/bin/claude"),
  path.join(os.homedir(), ".npm-global/bin/claude"),
  path.join(os.homedir(), ".yarn/bin/claude"),
];

/**
 * Get the user's shell PATH by sourcing their shell profile.
 * macOS GUI apps don't inherit the shell PATH, so we need to
 * explicitly source the user's profile to find binaries.
 */
async function getShellPath(): Promise<string> {
  try {
    const shell = process.env.SHELL || "/bin/zsh";
    const { stdout } = await execAsync(`${shell} -ilc 'echo $PATH'`, {
      encoding: "utf-8",
      timeout: 5000,
      env: { ...process.env, HOME: os.homedir() },
    });
    return stdout.trim();
  } catch {
    return process.env.PATH || "";
  }
}

/**
 * Try to find `claude` binary using the shell PATH (resolves macOS GUI PATH issue).
 */
async function findClaudeInShellPath(): Promise<string | null> {
  try {
    const shell = process.env.SHELL || "/bin/zsh";
    const { stdout } = await execAsync(`${shell} -ilc 'which claude'`, {
      encoding: "utf-8",
      timeout: 5000,
      env: { ...process.env, HOME: os.homedir() },
    });
    const result = stdout.trim();
    if (result) {
      try {
        await fs.promises.access(result);
        return result;
      } catch {
        return null;
      }
    }
  } catch {
    // claude not found in shell PATH
  }
  return null;
}

/**
 * Check if the configured path in settings is valid.
 */
async function getConfiguredPath(): Promise<string | null> {
  try {
    const db = getDatabase();
    const row = db.prepare("SELECT value FROM settings WHERE key = ?").get("claude_cli_path") as
      | { value: string }
      | undefined;
    if (row?.value) {
      try {
        await fs.promises.access(row.value);
        return row.value;
      } catch {
        return null;
      }
    }
  } catch {
    // DB not ready or setting not found
  }
  return null;
}

/**
 * Check common installation locations for the claude binary.
 */
async function findClaudeInCommonLocations(): Promise<string | null> {
  for (const location of COMMON_LOCATIONS) {
    try {
      await fs.promises.access(location);
      return location;
    } catch {
      // not found at this location
    }
  }
  return null;
}

/**
 * Try to find `claude` in the current process PATH (works if launched from terminal).
 */
async function findClaudeInProcessPath(): Promise<string | null> {
  const pathDirs = (process.env.PATH || "").split(path.delimiter);
  for (const dir of pathDirs) {
    const candidate = path.join(dir, "claude");
    try {
      await fs.promises.access(candidate);
      return candidate;
    } catch {
      // not found in this dir
    }
  }
  return null;
}

export interface ClaudeCliInfo {
  path: string;
  source: "settings" | "shell-path" | "process-path" | "common-location";
}

/**
 * Discover the Claude CLI binary path.
 * Priority: user settings > shell PATH > process PATH > common locations.
 */
export async function discoverClaudeCli(): Promise<ClaudeCliInfo | null> {
  // 1. Check user-configured path in settings
  const configured = await getConfiguredPath();
  if (configured) {
    return { path: configured, source: "settings" };
  }

  // 2. Source user's shell profile to get full PATH (handles macOS GUI issue)
  const shellPath = await findClaudeInShellPath();
  if (shellPath) {
    return { path: shellPath, source: "shell-path" };
  }

  // 3. Check process PATH (works when launched from terminal)
  const processPath = await findClaudeInProcessPath();
  if (processPath) {
    return { path: processPath, source: "process-path" };
  }

  // 4. Check common installation locations
  const commonPath = await findClaudeInCommonLocations();
  if (commonPath) {
    return { path: commonPath, source: "common-location" };
  }

  return null;
}

/**
 * Get the shell environment PATH (with user profile sourced).
 * Useful for spawning subprocesses with the correct PATH.
 */
export async function getResolvedPath(): Promise<string> {
  return getShellPath();
}

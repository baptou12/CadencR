import { Effect } from "effect";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execAsync } from "../git/worktree";
import { getDatabase } from "../db/database";
import { CliNotFoundError, CliDiscoveryError } from "../effect/errors";

const COMMON_LOCATIONS = [
  "/usr/local/bin/claude",
  "/usr/bin/claude",
  "/opt/homebrew/bin/claude",
  path.join(os.homedir(), ".local/bin/claude"),
  path.join(os.homedir(), ".npm-global/bin/claude"),
  path.join(os.homedir(), ".yarn/bin/claude"),
];

export interface ClaudeCliInfo {
  path: string;
  source: "settings" | "shell-path" | "process-path" | "common-location";
}

/**
 * Get the user's shell PATH by sourcing their shell profile.
 * macOS GUI apps don't inherit the shell PATH, so we need to
 * explicitly source the user's profile to find binaries.
 */
function getShellPath(): Effect.Effect<string> {
  const shell = process.env.SHELL || "/bin/zsh";
  return Effect.tryPromise({
    try: () =>
      execAsync(`${shell} -ilc 'echo $PATH'`, {
        encoding: "utf-8",
        timeout: 5000,
        env: { ...process.env, HOME: os.homedir() },
      }),
    catch: (e) =>
      new CliDiscoveryError({ message: "Failed to get shell PATH", cause: e }),
  }).pipe(
    Effect.map(({ stdout }) => stdout.trim()),
    Effect.orElse(() => Effect.succeed(process.env.PATH || "")),
  );
}

/**
 * Try to find `claude` binary using the shell PATH (resolves macOS GUI PATH issue).
 */
function findClaudeInShellPath(): Effect.Effect<string, CliDiscoveryError> {
  const shell = process.env.SHELL || "/bin/zsh";
  return Effect.tryPromise({
    try: () =>
      execAsync(`${shell} -ilc 'which claude'`, {
        encoding: "utf-8",
        timeout: 5000,
        env: { ...process.env, HOME: os.homedir() },
      }),
    catch: (e) =>
      new CliDiscoveryError({ message: "which claude failed", cause: e }),
  }).pipe(
    Effect.flatMap(({ stdout }) => {
      const result = stdout.trim();
      if (!result) {
        return Effect.fail(
          new CliDiscoveryError({ message: "which claude returned empty result" }),
        );
      }
      return Effect.tryPromise({
        try: () => fs.promises.access(result).then(() => result),
        catch: (e) =>
          new CliDiscoveryError({
            message: `Cannot access path from which claude: ${result}`,
            cause: e,
          }),
      });
    }),
  );
}

/**
 * Check if the configured path in settings is valid.
 */
function getConfiguredPath(): Effect.Effect<string, CliDiscoveryError> {
  return Effect.try({
    try: () => {
      const db = getDatabase();
      const row = db
        .prepare("SELECT value FROM settings WHERE key = ?")
        .get("claude_cli_path") as { value: string } | undefined;
      return row?.value ?? null;
    },
    catch: (e) =>
      new CliDiscoveryError({ message: "DB lookup failed", cause: e }),
  }).pipe(
    Effect.flatMap((value) => {
      if (!value) {
        return Effect.fail(
          new CliDiscoveryError({ message: "No claude_cli_path configured in settings" }),
        );
      }
      return Effect.tryPromise({
        try: () => fs.promises.access(value).then(() => value),
        catch: (e) =>
          new CliDiscoveryError({
            message: `Cannot access configured path: ${value}`,
            cause: e,
          }),
      });
    }),
  );
}

/**
 * Check common installation locations for the claude binary.
 */
function findClaudeInCommonLocations(): Effect.Effect<string, CliDiscoveryError> {
  return Effect.firstSuccessOf(
    COMMON_LOCATIONS.map((loc) =>
      Effect.tryPromise({
        try: () => fs.promises.access(loc).then(() => loc),
        catch: () =>
          new CliDiscoveryError({ message: `Claude not found at ${loc}` }),
      }),
    ),
  );
}

/**
 * Try to find `claude` in the current process PATH (works if launched from terminal).
 */
function findClaudeInProcessPath(): Effect.Effect<string, CliDiscoveryError> {
  const pathDirs = (process.env.PATH || "").split(path.delimiter).filter(Boolean);
  const candidates = pathDirs.map((dir) => path.join(dir, "claude"));
  if (candidates.length === 0) {
    return Effect.fail(
      new CliDiscoveryError({ message: "No directories in process PATH" }),
    );
  }
  return Effect.firstSuccessOf(
    candidates.map((candidate) =>
      Effect.tryPromise({
        try: () => fs.promises.access(candidate).then(() => candidate),
        catch: () =>
          new CliDiscoveryError({ message: `Claude not found at ${candidate}` }),
      }),
    ),
  );
}

/**
 * Discover the Claude CLI binary path.
 * Priority: user settings > shell PATH > process PATH > common locations.
 *
 * Returns Effect.Effect<ClaudeCliInfo, CliNotFoundError>.
 * Use Effect.option or Effect.catchTag("CliNotFoundError", ...) to handle not-found.
 *
 * Implementation note: probes run sequentially via Effect.firstSuccessOf rather than
 * concurrently via Effect.raceAll. The concurrent approach would require priority-based
 * delays (settings=0ms, shell=10ms, ...) to avoid ties, but would still spawn expensive
 * shell processes (`shell -ilc 'which claude'`) even when the instant DB settings lookup
 * succeeds. Sequential short-circuiting avoids this wasted work in the common case.
 */
export function discoverClaudeCli(): Effect.Effect<ClaudeCliInfo, CliNotFoundError> {
  return Effect.firstSuccessOf([
    getConfiguredPath().pipe(
      Effect.map((p) => ({ path: p, source: "settings" as const })),
    ),
    findClaudeInShellPath().pipe(
      Effect.map((p) => ({ path: p, source: "shell-path" as const })),
    ),
    findClaudeInProcessPath().pipe(
      Effect.map((p) => ({ path: p, source: "process-path" as const })),
    ),
    findClaudeInCommonLocations().pipe(
      Effect.map((p) => ({ path: p, source: "common-location" as const })),
    ),
  ]).pipe(
    Effect.catchAll(() =>
      Effect.fail(new CliNotFoundError({ searchedPaths: COMMON_LOCATIONS })),
    ),
  );
}

/**
 * Get the shell environment PATH (with user profile sourced).
 * Useful for spawning subprocesses with the correct PATH.
 */
export function getResolvedPath(): Effect.Effect<string> {
  return getShellPath();
}

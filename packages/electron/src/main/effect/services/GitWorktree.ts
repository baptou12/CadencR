/**
 * Effect-based git worktree lifecycle and query functions.
 *
 * This is a stateless module — no Effect.Tag. All functions return Effects
 * that can be run via AppRuntime.runPromise(). Functions that track progress
 * (setupWorktreeForFeatureEffect) depend on the Database service in AppLayer.
 *
 * Query functions (getCurrentBranchEffect, getDiffEffect, etc.) return
 * Effect<T, never> swallowing errors at the boundary, or Effect<T, GitCommandError>
 * when error propagation is desired.
 */

import { Effect, Either } from "effect";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import crypto from "node:crypto";
import { Database } from "./Database.js";
import {
  CommandError,
  GitCommandError,
  WorktreeError,
  FileSystemError,
  DatabaseError,
} from "../errors.js";

export const execAsync = promisify(exec);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type ExecOptions = {
  cwd?: string;
  maxBuffer?: number;
  timeout?: number;
  shell?: string;
  encoding?: string;
};

/** Wrap execAsync in an Effect, capturing command/stderr/exitCode on failure. */
export function execGit(
  command: string,
  options?: ExecOptions,
): Effect.Effect<{ stdout: string; stderr: string }, GitCommandError> {
  return Effect.tryPromise({
    try: () =>
      execAsync(command, {
        encoding: "utf-8",
        ...options,
      }) as Promise<{ stdout: string; stderr: string }>,
    catch: (e) => {
      const err = e as { stderr?: string; code?: number; stdout?: string; message?: string };
      return new GitCommandError({
        command,
        stderr: err.stderr ?? err.message ?? String(e),
        exitCode: typeof err.code === "number" ? err.code : undefined,
        cause: e,
      });
    },
  });
}

/**
 * Wrap execAsync in an Effect for non-git shell commands (e.g., setup commands like
 * `pnpm install`). Errors are tagged as CommandError rather than GitCommandError to
 * accurately reflect that these are general-purpose commands.
 */
export function execCommand(
  command: string,
  options?: ExecOptions,
): Effect.Effect<{ stdout: string; stderr: string }, CommandError> {
  return Effect.tryPromise({
    try: () =>
      execAsync(command, {
        encoding: "utf-8",
        ...options,
      }) as Promise<{ stdout: string; stderr: string }>,
    catch: (e) => {
      const err = e as { stderr?: string; code?: number; stdout?: string; message?: string };
      return new CommandError({
        command,
        stderr: err.stderr ?? err.message ?? String(e),
        exitCode: typeof err.code === "number" ? err.code : undefined,
        cause: e,
      });
    },
  });
}

/** Wrap fs.promises.access in an Effect. */
export function accessFileEffect(
  filePath: string,
): Effect.Effect<void, FileSystemError> {
  return Effect.tryPromise({
    try: () => fs.promises.access(filePath),
    catch: (e) =>
      new FileSystemError({ path: filePath, operation: "access", cause: e }),
  });
}

// ---------------------------------------------------------------------------
// Re-export WorktreeInfo type
// ---------------------------------------------------------------------------

export interface WorktreeInfo {
  path: string;
  branch: string;
  head: string;
  isBare: boolean;
}

// ---------------------------------------------------------------------------
// Core lifecycle functions
// ---------------------------------------------------------------------------

/**
 * List all worktrees for a repository.
 */
export function listWorktreesEffect(
  repoPath: string,
): Effect.Effect<WorktreeInfo[], GitCommandError> {
  return Effect.gen(function* () {
    const { stdout: output } = yield* execGit(
      "git worktree list --porcelain",
      { cwd: repoPath },
    );

    const worktrees: WorktreeInfo[] = [];
    let current: Partial<WorktreeInfo> = {};

    for (const line of output.split("\n")) {
      if (line.startsWith("worktree ")) {
        if (current.path) {
          worktrees.push(current as WorktreeInfo);
        }
        current = { path: line.slice("worktree ".length), isBare: false };
      } else if (line.startsWith("HEAD ")) {
        current.head = line.slice("HEAD ".length);
      } else if (line.startsWith("branch ")) {
        current.branch = line.slice("branch ".length).replace("refs/heads/", "");
      } else if (line === "bare") {
        current.isBare = true;
      } else if (line === "" && current.path) {
        worktrees.push({
          path: current.path,
          branch: current.branch ?? "(detached)",
          head: current.head ?? "",
          isBare: current.isBare ?? false,
        });
        current = {};
      }
    }

    // Push last entry if not yet pushed
    if (current.path) {
      worktrees.push({
        path: current.path,
        branch: current.branch ?? "(detached)",
        head: current.head ?? "",
        isBare: current.isBare ?? false,
      });
    }

    return worktrees;
  });
}

/**
 * Create a git worktree with a new branch.
 * Places the worktree at ~/.cadence/<projectName>/<safeBranch>.
 */
export function createWorktreeEffect(
  repoPath: string,
  branchName: string,
  projectName: string,
): Effect.Effect<
  { worktreePath: string; branch: string },
  GitCommandError | WorktreeError | FileSystemError
> {
  return Effect.gen(function* () {
    // Pre-flight: verify repoPath is a git repo
    yield* execGit("git rev-parse --git-dir", { cwd: repoPath }).pipe(
      Effect.mapError(
        () =>
          new WorktreeError({
            message: `Not a git repository: ${repoPath}. Ensure the project path points to a valid git repo.`,
          }),
      ),
    );

    // Pre-flight: verify branch name is valid
    if (!branchName || /[\s~^:?*[\\]/.test(branchName)) {
      return yield* Effect.fail(
        new WorktreeError({
          message: `Invalid branch name: "${branchName}". Branch names cannot contain spaces or special characters like ~ ^ : ? * [ \\`,
        }),
      );
    }

    // Sanitize branch name for directory path
    const safeBranch = branchName.replace(/\//g, "-");
    const worktreePath = path.join(
      os.homedir(),
      ".cadence",
      projectName,
      safeBranch,
    );

    // Check if directory already exists
    const dirExists = yield* accessFileEffect(worktreePath).pipe(
      Effect.map(() => true),
      Effect.catchAll(() => Effect.succeed(false)),
    );

    if (dirExists) {
      // Check if it's already a valid worktree
      const existing = yield* listWorktreesEffect(repoPath);
      const alreadyExists = existing.find((w) => w.path === worktreePath);
      if (alreadyExists) {
        return { worktreePath, branch: branchName };
      }
      return yield* Effect.fail(
        new WorktreeError({
          message: `Directory already exists but is not a worktree: ${worktreePath}`,
        }),
      );
    }

    // Create parent directory
    yield* Effect.tryPromise({
      try: () =>
        fs.promises.mkdir(path.dirname(worktreePath), { recursive: true }),
      catch: (e) =>
        new FileSystemError({
          path: path.dirname(worktreePath),
          operation: "mkdir",
          cause: e,
        }),
    });

    // Try with -b first; fall back without -b if branch already exists
    const addResult: Either.Either<
      { stdout: string; stderr: string },
      GitCommandError
    > = yield* execGit(
      `git worktree add "${worktreePath}" -b "${branchName}"`,
      { cwd: repoPath },
    ).pipe(Effect.either);

    if (Either.isLeft(addResult)) {
      const { left: err } = addResult;
      const errMsg =
        err.stderr +
        (err.cause instanceof Error ? err.cause.message : String(err.cause ?? ""));
      if (errMsg.includes("already exists")) {
        yield* execGit(
          `git worktree add "${worktreePath}" "${branchName}"`,
          { cwd: repoPath },
        );
      } else {
        return yield* Effect.fail(err);
      }
    }

    return { worktreePath, branch: branchName };
  });
}

/**
 * Remove a git worktree.
 */
export function removeWorktreeEffect(
  repoPath: string,
  worktreePath: string,
): Effect.Effect<void, GitCommandError> {
  return execGit(
    `git worktree remove "${worktreePath}" --force`,
    { cwd: repoPath },
  ).pipe(Effect.asVoid);
}

/**
 * Get info for a specific worktree by its path.
 */
export function getWorktreeInfoEffect(
  repoPath: string,
  worktreePath: string,
): Effect.Effect<WorktreeInfo | null, GitCommandError> {
  return listWorktreesEffect(repoPath).pipe(
    Effect.map((all) => all.find((w) => w.path === worktreePath) ?? null),
  );
}

/**
 * Build a branch name from a prefix and feature title.
 * Pure function — no Effect needed.
 */
export function buildBranchName(prefix: string, featureTitle: string): string {
  const slug = featureTitle
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50);
  const suffix = crypto.randomBytes(2).toString("hex"); // 4-char hex
  return `${prefix}${slug}-${suffix}`;
}

// ---------------------------------------------------------------------------
// Setup helpers (need Database + EventBroadcaster)
// ---------------------------------------------------------------------------

/** Upsert a feature_settings row. */
function setFeatureSettingEffect(
  featureId: number,
  key: string,
  value: string,
): Effect.Effect<void, DatabaseError, Database> {
  return Effect.gen(function* () {
    const db = yield* Database;
    yield* db.execute(
      "INSERT INTO feature_settings (feature_id, key, value) VALUES (?, ?, ?) ON CONFLICT(feature_id, key) DO UPDATE SET value = excluded.value",
      featureId,
      key,
      value,
    );
  });
}

/**
 * Run setup commands in a worktree directory, tracking progress in feature_settings.
 */
function runSetupCommandsEffect(
  projectId: number,
  featureId: number,
  worktreePath: string,
): Effect.Effect<void, DatabaseError, Database | EventBroadcaster> {
  return Effect.gen(function* () {
    const db = yield* Database;

    const setupRow = yield* db.queryOne<{ value: string }>(
      "SELECT value FROM project_settings WHERE project_id = ? AND key = 'setup_worktree'",
      projectId,
    );
    const setupCommands = setupRow?.value?.trim();

    if (!setupCommands) return;

    yield* setFeatureSettingEffect(featureId, "worktree_setup_step", "setup");
    yield* setFeatureSettingEffect(featureId, "worktree_setup_log", "");

    const lines = setupCommands.split("\n").filter((l) => l.trim());
    let accumulatedLog = "";

    for (const cmd of lines) {
      accumulatedLog += `$ ${cmd}\n`;
      yield* setFeatureSettingEffect(featureId, "worktree_setup_log", accumulatedLog);
  
      const cmdResult = yield* execCommand(cmd, {
        cwd: worktreePath,
        timeout: 120_000,
      }).pipe(Effect.either);

      if (Either.isRight(cmdResult)) {
        const { stdout, stderr } = cmdResult.right;
        if (stdout) accumulatedLog += stdout;
        if (stderr) accumulatedLog += stderr;
        yield* setFeatureSettingEffect(featureId, "worktree_setup_log", accumulatedLog);
          } else {
        const err = cmdResult.left;
        const errorMessage = err.stderr || String(err.cause ?? err);
        accumulatedLog += `ERROR: ${errorMessage}\n`;
        yield* setFeatureSettingEffect(featureId, "worktree_setup_log", accumulatedLog);
        yield* setFeatureSettingEffect(featureId, "worktree_setup_step", "error");
        yield* setFeatureSettingEffect(featureId, "worktree_setup_error", errorMessage);
            return; // stop on first error, like the original
      }
    }
  });
}

/**
 * Setup a worktree for a feature: create the worktree and run setup commands.
 * Tracks progress via feature_settings (worktree_setup_step) and notifies the renderer.
 */
export function setupWorktreeForFeatureEffect(
  projectId: number,
  featureId: number,
  options?: { skipSetupCommands?: boolean; onlySetupCommands?: boolean },
): Effect.Effect<
  string | void,
  WorktreeError | DatabaseError,
  Database
> {
  return Effect.gen(function* () {
    const db = yield* Database;

    const feature = yield* db.queryOne<{ title: string; type: string }>(
      "SELECT title, type FROM features WHERE id = ?",
      featureId,
    );
    if (!feature) {
      return yield* Effect.fail(
        new WorktreeError({ message: `Feature not found: ${featureId}` }),
      );
    }

    // Session-type features must never have worktrees
    if (feature.type === "ws-session") {
      console.warn(
        `[worktree-setup] Skipping worktree for session-type feature ${featureId}`,
      );
      return;
    }

    const project = yield* db.queryOne<{ name: string; path: string }>(
      "SELECT name, path FROM projects WHERE id = ?",
      projectId,
    );
    if (!project?.path) {
      return yield* Effect.fail(
        new WorktreeError({ message: `Project path not found: ${projectId}` }),
      );
    }

    // If onlySetupCommands, skip straight to running setup commands
    if (options?.onlySetupCommands) {
      const wtRow = yield* db.queryOne<{ value: string }>(
        "SELECT value FROM feature_settings WHERE feature_id = ? AND key = 'worktree_path'",
        featureId,
      );
      if (!wtRow) {
        return yield* Effect.fail(
          new WorktreeError({
            message: `No worktree path found for feature ${featureId}`,
          }),
        );
      }
      yield* runSetupCommandsEffect(projectId, featureId, wtRow.value);
      yield* setFeatureSettingEffect(featureId, "worktree_setup_step", "done");
        return;
    }

    // Step 1: Named
    yield* setFeatureSettingEffect(featureId, "worktree_setup_step", "named");

    // Step 2: Create worktree (catch errors and store in DB like original)
    const createResult = yield* Effect.gen(function* () {
      yield* setFeatureSettingEffect(featureId, "worktree_setup_step", "creating");
  
      const prefixRow = yield* db.queryOne<{ branch_prefix: string | null }>(
        "SELECT branch_prefix FROM projects WHERE id = ?",
        projectId,
      );
      const prefix = prefixRow?.branch_prefix ?? "feature/";
      const branchName = buildBranchName(prefix, feature.title);

      const wt = yield* createWorktreeEffect(project.path, branchName, project.name);

      yield* setFeatureSettingEffect(featureId, "worktree_path", wt.worktreePath);
      yield* setFeatureSettingEffect(featureId, "worktree_branch", wt.branch);
      yield* setFeatureSettingEffect(featureId, "worktree_setup_step", "created");
  
      return wt;
    }).pipe(
      Effect.catchAll((err) =>
        Effect.gen(function* () {
          const errorMessage =
            err instanceof Error ? err.message : String(err);
          console.error("[worktree-setup] Failed:", errorMessage);
          yield* setFeatureSettingEffect(featureId, "worktree_setup_step", "error");
          yield* setFeatureSettingEffect(featureId, "worktree_setup_error", errorMessage);
                return null;
        }),
      ),
    );

    if (!createResult) return;

    if (options?.skipSetupCommands) {
      return createResult.worktreePath;
    }

    // Step 3: Run setup commands (errors stored in DB by runSetupCommandsEffect)
    yield* runSetupCommandsEffect(projectId, featureId, createResult.worktreePath);
    yield* setFeatureSettingEffect(featureId, "worktree_setup_step", "done");
  });
}

// ---------------------------------------------------------------------------
// Git query functions (no Context requirements)
// ---------------------------------------------------------------------------

/**
 * Shared stat-line regex for git diff --stat output.
 */
const STAT_REGEX =
  /(\d+)\s+files?\s+changed(?:,\s+(\d+)\s+insertions?\(\+\))?(?:,\s+(\d+)\s+deletions?\(-\))?/;

function parseStatLine(
  output: string,
): { filesChanged: number; insertions: number; deletions: number } | null {
  const m = output.match(STAT_REGEX);
  if (!m) return null;
  return {
    filesChanged: parseInt(m[1], 10),
    insertions: parseInt(m[2] ?? "0", 10),
    deletions: parseInt(m[3] ?? "0", 10),
  };
}

// Record separator for git log format (ASCII 0x1e)
const LOG_RS = "\x1e";
const GIT_LOG_FORMAT = `${LOG_RS}%H%n%h%n%s%n%an%n%ai%n%b`;

export interface CommitInfo {
  sha: string;
  shortSha: string;
  message: string;
  body: string;
  author: string;
  date: string;
  isPushed: boolean;
}

export interface ChangedFile {
  file: string;
  status: string;
  oldFile?: string;
  additions: number;
  deletions: number;
}

function parseGitLog(output: string): CommitInfo[] {
  if (!output.trim()) return [];
  const entries = output.trim().split(LOG_RS).filter(Boolean);
  const commits: CommitInfo[] = [];
  for (const entry of entries) {
    const lines = entry.trim().split("\n");
    if (lines.length < 5) continue;
    commits.push({
      sha: lines[0],
      shortSha: lines[1],
      message: lines[2],
      body: lines.slice(5).join("\n").trim(),
      author: lines[3],
      date: lines[4],
      isPushed: true,
    });
  }
  return commits;
}

/** Determine which SHAs have NOT been pushed to the remote. */
function getUnpushedShasEffect(
  repoPath: string,
  branchName: string,
): Effect.Effect<Set<string> | "all", never> {
  return execGit(`git rev-list "origin/${branchName}..HEAD"`, {
    cwd: repoPath,
  }).pipe(
    Effect.map(({ stdout }) => new Set(stdout.trim().split("\n").filter(Boolean))),
    Effect.catchAll(() => Effect.succeed("all" as const)),
  );
}

function applyPushedStatus(commits: CommitInfo[], unpushed: Set<string> | "all"): void {
  for (const c of commits) {
    c.isPushed = unpushed === "all" ? false : !unpushed.has(c.sha);
  }
}

/**
 * Get the current branch name for a repo path.
 * Returns null on error (e.g. detached HEAD, not a git repo).
 */
export function getCurrentBranchEffect(
  repoPath: string,
): Effect.Effect<string | null, never> {
  return execGit("git rev-parse --abbrev-ref HEAD", { cwd: repoPath }).pipe(
    Effect.map(({ stdout }) => stdout.trim() || null),
    Effect.catchAll(() => Effect.succeed(null)),
  );
}

/**
 * Get git diff stats (lines added/removed) for a worktree.
 * Always succeeds — returns zeros on error.
 */
export function getGitStatsEffect(
  worktreePath: string,
  mode: "worktree" | "branch" = "worktree",
  targetBranch?: string,
): Effect.Effect<{ filesChanged: number; insertions: number; deletions: number }, never> {
  return Effect.gen(function* () {
    const opts = { cwd: worktreePath };

    if (mode === "branch") {
      const branch = targetBranch ?? "main";
      const { stdout } = yield* execGit(`git diff ${branch}...HEAD --stat`, opts);
      const result = parseStatLine(stdout);
      return result ?? { filesChanged: 0, insertions: 0, deletions: 0 };
    }

    // Worktree mode: unstaged + staged + untracked
    const [unstagedResult, stagedResult, untrackedResult] = yield* Effect.all(
      [
        execGit("git diff --stat", opts),
        execGit("git diff --cached --stat", opts),
        execGit("git ls-files --others --exclude-standard", opts),
      ],
      { concurrency: "unbounded" },
    );

    const unstaged = parseStatLine(unstagedResult.stdout);
    const staged = parseStatLine(stagedResult.stdout);
    let filesChanged = (unstaged?.filesChanged ?? 0) + (staged?.filesChanged ?? 0);
    let insertions = (unstaged?.insertions ?? 0) + (staged?.insertions ?? 0);
    let deletions = (unstaged?.deletions ?? 0) + (staged?.deletions ?? 0);

    // Count untracked files — each line is an insertion
    const untrackedFiles = untrackedResult.stdout.trim().split("\n").filter(Boolean);
    for (const file of untrackedFiles) {
      const fullPath = path.join(worktreePath, file);
      const content = yield* Effect.tryPromise(() =>
        fs.promises.readFile(fullPath, "utf-8"),
      ).pipe(Effect.catchAll(() => Effect.succeed(null)));
      if (content !== null) {
        const lineCount = content
          .split("\n")
          .filter((_, i, arr) => i < arr.length - 1 || arr[arr.length - 1] !== "").length;
        filesChanged++;
        insertions += lineCount;
      }
    }

    return { filesChanged, insertions, deletions };
  }).pipe(
    Effect.catchAll(() => Effect.succeed({ filesChanged: 0, insertions: 0, deletions: 0 })),
  );
}

/**
 * Get a unified diff string for a worktree.
 * Always succeeds — returns "" on error.
 */
export function getDiffEffect(
  worktreePath: string,
  mode: "worktree" | "branch",
  targetBranch?: string,
): Effect.Effect<string, never> {
  const branch = targetBranch ?? "main";

  if (mode === "branch") {
    return execGit(`git diff ${branch}...HEAD`, {
      cwd: worktreePath,
      maxBuffer: 50 * 1024 * 1024,
    }).pipe(
      Effect.map(({ stdout }) => stdout),
      Effect.catchAll(() => Effect.succeed("")),
    );
  }

  // Worktree mode
  return Effect.gen(function* () {
    const opts = { cwd: worktreePath, maxBuffer: 50 * 1024 * 1024 };
    const [unstagedResult, stagedResult, untrackedResult] = yield* Effect.all(
      [
        execGit("git diff", opts),
        execGit("git diff --cached", opts),
        execGit("git ls-files --others --exclude-standard", {
          cwd: worktreePath,
          maxBuffer: 1024 * 1024,
        }),
      ],
      { concurrency: "unbounded" },
    );

    const unstagedDiff = unstagedResult.stdout;
    const stagedDiff = stagedResult.stdout;
    const untrackedFiles = untrackedResult.stdout.trim().split("\n").filter(Boolean);

    const untrackedDiffs: string[] = [];
    for (const file of untrackedFiles) {
      const fullPath = path.join(worktreePath, file);
      const content = yield* Effect.tryPromise(() =>
        fs.promises.readFile(fullPath, "utf-8"),
      ).pipe(Effect.catchAll(() => Effect.succeed(null)));
      if (content !== null) {
        const lines = content.split("\n");
        if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
        const lineCount = lines.length;
        const addedLines = lines.map((l) => `+${l}`).join("\n");
        untrackedDiffs.push(
          `diff --git a/${file} b/${file}\nnew file mode 100644\n--- /dev/null\n+++ b/${file}\n@@ -0,0 +1,${lineCount} @@\n${addedLines}\n`,
        );
      }
    }

    return unstagedDiff + stagedDiff + untrackedDiffs.join("");
  }).pipe(Effect.catchAll(() => Effect.succeed("")));
}

/**
 * Get list of changed files with per-file addition/deletion counts.
 * Always succeeds — returns [] on error.
 */
export function getChangedFilesEffect(
  worktreePath: string,
  mode: "worktree" | "branch",
  targetBranch?: string,
): Effect.Effect<ChangedFile[], never> {
  const branch = targetBranch ?? "main";
  const diffArg = mode === "worktree" ? "" : `${branch}...HEAD`;

  return Effect.gen(function* () {
    const [nameStatusResult, numstatResult] = yield* Effect.all(
      [
        execGit(`git diff --name-status ${diffArg}`, { cwd: worktreePath }),
        execGit(`git diff --numstat ${diffArg}`, { cwd: worktreePath }),
      ],
      { concurrency: "unbounded" },
    );

    const nameStatus = nameStatusResult.stdout.trim();
    if (!nameStatus) return [];

    const numstat = numstatResult.stdout.trim();
    const statMap = new Map<string, { additions: number; deletions: number }>();
    for (const line of numstat.split("\n")) {
      if (!line) continue;
      const parts = line.split("\t");
      if (parts.length >= 3) {
        const additions = parts[0] === "-" ? 0 : parseInt(parts[0], 10);
        const deletions = parts[1] === "-" ? 0 : parseInt(parts[1], 10);
        const file = parts.slice(2).join("\t");
        statMap.set(file, { additions, deletions });
      }
    }

    const files: ChangedFile[] = [];
    for (const line of nameStatus.split("\n")) {
      if (!line) continue;
      const parts = line.split("\t");
      const statusCode = parts[0];
      let file: string;
      let oldFile: string | undefined;

      if (statusCode.startsWith("R") || statusCode.startsWith("C")) {
        oldFile = parts[1];
        file = parts[2];
      } else {
        file = parts[1];
      }

      const stats =
        statMap.get(file) ??
        (oldFile ? statMap.get(`${oldFile} => ${file}`) : undefined) ??
        { additions: 0, deletions: 0 };

      files.push({ file, status: statusCode, oldFile, additions: stats.additions, deletions: stats.deletions });
    }

    return files;
  }).pipe(Effect.catchAll(() => Effect.succeed([])));
}

/**
 * Detect the original branch from which a worktree branch was created.
 * Uses tracking config → remote HEAD → common defaults fallback chain.
 * Fails with GitCommandError if no branch can be determined.
 */
export function getOriginalBranchEffect(
  repoPath: string,
  worktreeBranch: string,
): Effect.Effect<string, GitCommandError> {
  const opts = { cwd: repoPath };
  const noOriginal = new GitCommandError({
    command: "getOriginalBranch",
    stderr: `Cannot determine original branch for worktree branch: ${worktreeBranch}`,
  });

  return (
    // 1. Try tracking config
    execGit(`git config --get branch.${worktreeBranch}.merge`, opts).pipe(
      Effect.flatMap(({ stdout }) => {
        const merge = stdout.trim();
        return merge
          ? Effect.succeed(merge.replace(/^refs\/heads\//, ""))
          : Effect.fail(noOriginal);
      }),
    )
  ).pipe(
    // 2. Try remote HEAD
    Effect.orElse(() =>
      execGit("git symbolic-ref refs/remotes/origin/HEAD", opts).pipe(
        Effect.flatMap(({ stdout }) => {
          const remoteHead = stdout.trim();
          return remoteHead
            ? Effect.succeed(remoteHead.replace(/^refs\/remotes\/origin\//, ""))
            : Effect.fail(noOriginal);
        }),
      ),
    ),
    // 3. Try common default branch names
    Effect.orElse(() =>
      Effect.firstSuccessOf(
        ["main", "master", "develop", "trunk"].map((candidate) =>
          execGit(`git rev-parse --verify ${candidate}`, opts).pipe(
            Effect.map(() => candidate),
          ),
        ),
      ).pipe(Effect.mapError(() => noOriginal)),
    ),
  );
}

/**
 * Check if merging sourceBranch into targetBranch would produce conflicts.
 * Fails with GitCommandError if git commands fail unexpectedly.
 */
export function checkMergeConflictsEffect(
  repoPath: string,
  sourceBranch: string,
  targetBranch: string,
): Effect.Effect<{ hasConflicts: boolean; conflictFiles: string[] }, GitCommandError> {
  const opts = { cwd: repoPath };

  return Effect.gen(function* () {
    const { stdout: mergeBaseRaw } = yield* execGit(
      `git merge-base "${targetBranch}" "${sourceBranch}"`,
      opts,
    );
    const mergeBase = mergeBaseRaw.trim();

    // merge-tree may exit non-zero when it detects conflicts
    const mergeTreeResult = yield* execGit(
      `git merge-tree "${mergeBase}" "${targetBranch}" "${sourceBranch}"`,
      { ...opts, maxBuffer: 50 * 1024 * 1024 },
    ).pipe(Effect.either);

    let mergeTreeOutput: string;
    if (Either.isRight(mergeTreeResult)) {
      mergeTreeOutput = mergeTreeResult.right.stdout;
    } else {
      // Extract stdout from the cause (node exec error includes stdout on non-zero exit)
      const cause = mergeTreeResult.left.cause as { stdout?: string } | null | undefined;
      mergeTreeOutput = cause?.stdout ?? mergeTreeResult.left.stderr;
    }

    const hasConflicts = /^<{7} /m.test(mergeTreeOutput);
    if (!hasConflicts) {
      return { hasConflicts: false, conflictFiles: [] };
    }

    // Identify conflicting files (changed in both branches)
    const [sourceResult, targetResult] = yield* Effect.all(
      [
        execGit(`git diff --name-only "${mergeBase}" "${sourceBranch}"`, opts),
        execGit(`git diff --name-only "${mergeBase}" "${targetBranch}"`, opts),
      ],
      { concurrency: "unbounded" },
    );

    const sourceFiles = new Set(sourceResult.stdout.trim().split("\n").filter(Boolean));
    const conflictFiles: string[] = [];
    for (const f of targetResult.stdout.trim().split("\n").filter(Boolean)) {
      if (sourceFiles.has(f)) conflictFiles.push(f);
    }

    return { hasConflicts: true, conflictFiles };
  });
}

/**
 * Merge sourceBranch into targetBranch using --no-ff from the main repo.
 * Always succeeds — returns { success, error? }.
 */
export function mergeBranchEffect(
  repoPath: string,
  sourceBranch: string,
  targetBranch: string,
): Effect.Effect<{ success: boolean; error?: string }, never> {
  const opts = { cwd: repoPath };

  return Effect.gen(function* () {
    // Get current branch so we can restore it
    const originalBranch = yield* execGit("git rev-parse --abbrev-ref HEAD", opts).pipe(
      Effect.map(({ stdout }) => stdout.trim() as string | null),
      Effect.catchAll(() => Effect.succeed(null)),
    );

    // Checkout target and merge
    const mergeResult = yield* execGit(`git checkout "${targetBranch}"`, opts).pipe(
      Effect.flatMap(() => execGit(`git merge --no-ff "${sourceBranch}"`, opts)),
      Effect.map(() => ({ success: true as const })),
      Effect.catchAll((err) =>
        execGit("git merge --abort", opts).pipe(
          Effect.catchAll(() => Effect.succeed(undefined)),
          Effect.map(() => ({
            success: false as const,
            error:
              err.stderr ||
              (err.cause instanceof Error ? err.cause.message : String(err.cause ?? "")),
          })),
        ),
      ),
    );

    // Restore original branch if needed
    if (originalBranch && originalBranch !== targetBranch) {
      yield* execGit(`git checkout "${originalBranch}"`, opts).pipe(
        Effect.catchAll(() => Effect.succeed(undefined)),
      );
    }

    return mergeResult;
  });
}

/**
 * Delete a local branch using -d (safe — only if fully merged).
 * Always succeeds — returns { success, error? }.
 */
export function deleteLocalBranchEffect(
  repoPath: string,
  branchName: string,
): Effect.Effect<{ success: boolean; error?: string }, never> {
  return execGit(`git branch -d "${branchName}"`, { cwd: repoPath }).pipe(
    Effect.map(() => ({ success: true as const })),
    Effect.catchAll((err) =>
      Effect.succeed({
        success: false as const,
        error:
          err.stderr ||
          (err.cause instanceof Error ? err.cause.message : String(err.cause ?? "")),
      }),
    ),
  );
}

/**
 * Check if a worktree has any uncommitted or untracked changes.
 * Always succeeds — returns false on error.
 */
export function hasUncommittedChangesEffect(
  worktreePath: string,
): Effect.Effect<boolean, never> {
  return execGit("git status --porcelain", { cwd: worktreePath }).pipe(
    Effect.map(({ stdout }) => stdout.trim().length > 0),
    Effect.catchAll(() => Effect.succeed(false)),
  );
}

/**
 * Get file content at a given ref, or from the working tree if no ref is provided.
 * Always succeeds — returns "" on error.
 */
export function getFileContentEffect(
  worktreePath: string,
  filePath: string,
  ref?: string,
): Effect.Effect<string, never> {
  if (!ref) {
    return Effect.tryPromise(() =>
      fs.promises.readFile(path.join(worktreePath, filePath), "utf-8"),
    ).pipe(Effect.catchAll(() => Effect.succeed("")));
  }

  return execGit(`git show "${ref}:${filePath}"`, {
    cwd: worktreePath,
    maxBuffer: 50 * 1024 * 1024,
  }).pipe(
    Effect.map(({ stdout }) => stdout),
    Effect.catchAll(() => Effect.succeed("")),
  );
}

/**
 * Run a git command and return raw binary output as a Buffer.
 * Uses `encoding: "binary"` (latin1) to preserve all bytes, then converts to Buffer.
 * Used for `git archive` which outputs binary tar data.
 */
function execGitBinary(
  command: string,
  options?: ExecOptions,
): Effect.Effect<Buffer, GitCommandError> {
  return Effect.tryPromise({
    try: () =>
      (execAsync(command, {
        ...options,
        encoding: "binary",
        maxBuffer: options?.maxBuffer ?? 200 * 1024 * 1024,
      }) as Promise<{ stdout: string; stderr: string }>).then(
        ({ stdout }) => Buffer.from(stdout, "binary"),
      ),
    catch: (e) => {
      const err = e as { stderr?: string; code?: number; message?: string };
      return new GitCommandError({
        command,
        stderr: err.stderr ?? err.message ?? String(e),
        exitCode: typeof err.code === "number" ? err.code : undefined,
        cause: e,
      });
    },
  });
}

/** Read a null-terminated string from a tar header field. */
function tarReadString(buffer: Buffer, offset: number, maxLen: number): string {
  const end = Math.min(offset + maxLen, buffer.length);
  let nullIdx = -1;
  for (let i = offset; i < end; i++) {
    if (buffer[i] === 0) {
      nullIdx = i;
      break;
    }
  }
  return buffer.subarray(offset, nullIdx === -1 ? end : nullIdx).toString("utf8");
}

/**
 * Parse a POSIX/ustar tar buffer and return a map of filename → content string.
 * Only regular files are included; directories and other entry types are skipped.
 * Handles both basic POSIX tar and ustar (extended filename prefix) format.
 */
function parseTarBuffer(buffer: Buffer): Map<string, string> {
  const files = new Map<string, string>();
  let offset = 0;

  while (offset + 512 <= buffer.length) {
    // Check for end-of-archive marker (512 zero bytes)
    let allZero = true;
    for (let i = 0; i < 512; i++) {
      if (buffer[offset + i] !== 0) {
        allZero = false;
        break;
      }
    }
    if (allZero) break;

    // Read name and ustar prefix (ustar format splits long paths: prefix + '/' + name)
    const name = tarReadString(buffer, offset, 100);
    const prefix = tarReadString(buffer, offset + 345, 155);
    const fullName = prefix ? `${prefix}/${name}` : name;
    const normalizedName = fullName.replace(/^\.\//, "");

    // File size stored as null-terminated octal ASCII at offset 124
    const sizeStr = tarReadString(buffer, offset + 124, 12);
    const size = sizeStr ? parseInt(sizeStr, 8) : 0;
    if (Number.isNaN(size)) break; // Malformed archive, stop parsing

    // Type flag at offset 156: 0x00 or '0' (0x30) = regular file
    const typeFlag = buffer[offset + 156];

    offset += 512; // Advance past the 512-byte header

    if ((typeFlag === 0 || typeFlag === 48) && normalizedName) {
      const content = buffer.subarray(offset, offset + size).toString("utf8");
      files.set(normalizedName, content);
    }

    // Advance past content, padded to 512-byte block boundary.
    // For empty files (size === 0), Math.ceil(0/512)*512 === 0, so we stay
    // at the current offset — correct because there are no content bytes to skip.
    offset += Math.ceil(size / 512) * 512;
  }

  return files;
}

/**
 * Wrap a string in single quotes and escape any internal single quotes so it
 * is safe to embed in a POSIX shell command string.
 * e.g. shellEscape(`a'b`) → `'a'\''b'`
 */
function shellEscape(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/**
 * Fetch file contents from a git ref using a single `git archive` call.
 * Returns a Map<filePath, content>. Falls back to concurrent `git show` calls
 * if git archive fails (e.g. when files don't exist at the given ref).
 */
function fetchArchiveContents(
  gitPath: string,
  ref: string,
  filePaths: string[],
): Effect.Effect<Map<string, string>, never> {
  const fileArgs = filePaths.map(shellEscape).join(" ");
  const command = `git archive ${shellEscape(ref)} -- ${fileArgs}`;

  return execGitBinary(command, { cwd: gitPath }).pipe(
    Effect.map((tarBuffer) => {
      const parsed = parseTarBuffer(tarBuffer);
      const result = new Map<string, string>();
      for (const filePath of filePaths) {
        // git archive may strip or keep './' prefix depending on git version
        const content =
          parsed.get(filePath) ?? parsed.get(`./${filePath}`) ?? "";
        result.set(filePath, content);
      }
      return result;
    }),
    // Fallback: concurrent git show calls (handles missing files at ref, renamed files, etc.)
    Effect.catchAll(() =>
      Effect.forEach(
        filePaths,
        (filePath) =>
          getFileContentEffect(gitPath, filePath, ref).pipe(
            Effect.map((content) => [filePath, content] as const),
          ),
        { concurrency: 10 },
      ).pipe(
        Effect.map((entries) => new Map(entries)),
        Effect.catchAll(() => Effect.succeed(new Map<string, string>())),
      ),
    ),
  );
}

/**
 * Read files from the working tree directly from disk (for newRef === null case).
 * Returns a Map<filePath, content>.
 */
function fetchWorkingTreeContents(
  gitPath: string,
  filePaths: string[],
): Effect.Effect<Map<string, string>, never> {
  return Effect.forEach(
    filePaths,
    (filePath) =>
      Effect.tryPromise(() =>
        fs.promises.readFile(path.join(gitPath, filePath), "utf-8"),
      ).pipe(
        Effect.map((content) => [filePath, content] as const),
        Effect.catchAll(() => Effect.succeed([filePath, ""] as const)),
      ),
    { concurrency: "unbounded" },
  ).pipe(
    Effect.map((entries) => new Map(entries)),
    Effect.catchAll(() => Effect.succeed(new Map<string, string>())),
  );
}

/**
 * Get file content for multiple files in a single batched operation.
 * Uses `git archive` to fetch all files from a ref in one subprocess call per ref,
 * reducing 2×N subprocess calls to just 2. For the working tree case (newRef === null),
 * files are read directly from disk without spawning any subprocess.
 *
 * Falls back to concurrent `git show` calls per-file if `git archive` fails (e.g. when
 * some files have been deleted or renamed at the given ref).
 *
 * Always succeeds — returns {} on error, empty strings for missing files.
 *
 * @param gitPath - Path to the git worktree or repo
 * @param filePaths - List of file paths to fetch
 * @param oldRef - Git ref for the "old" version (branch name, commit SHA, etc.)
 * @param newRef - Git ref for the "new" version, or null for working tree
 */
export function getFileContentBatchEffect(
  gitPath: string,
  filePaths: string[],
  oldRef: string,
  newRef: string | null,
): Effect.Effect<Record<string, { oldContent: string; newContent: string }>, never> {
  if (filePaths.length === 0) {
    return Effect.succeed({});
  }

  return Effect.gen(function* () {
    // Fetch old and new content concurrently
    const [oldContentMap, newContentMap] = yield* Effect.all(
      [
        fetchArchiveContents(gitPath, oldRef, filePaths),
        newRef !== null
          ? fetchArchiveContents(gitPath, newRef, filePaths)
          : fetchWorkingTreeContents(gitPath, filePaths),
      ],
      { concurrency: "unbounded" },
    );

    const result: Record<string, { oldContent: string; newContent: string }> = {};
    for (const filePath of filePaths) {
      result[filePath] = {
        oldContent: oldContentMap.get(filePath) ?? "",
        newContent: newContentMap.get(filePath) ?? "",
      };
    }
    return result;
  }).pipe(
    Effect.catchAll(() =>
      Effect.succeed({} as Record<string, { oldContent: string; newContent: string }>),
    ),
  );
}

/**
 * Get commit log for the current branch relative to a base branch.
 * Always succeeds — returns [] on error.
 */
export function getCommitLogEffect(
  worktreePath: string,
  baseBranch: string,
  branchName: string,
): Effect.Effect<CommitInfo[], never> {
  return Effect.gen(function* () {
    const { stdout: logOutput } = yield* execGit(
      `git log "${baseBranch}..HEAD" --format="${GIT_LOG_FORMAT}" --reverse`,
      { cwd: worktreePath },
    ).pipe(Effect.catchAll(() => Effect.succeed({ stdout: "", stderr: "" })));

    const commits = parseGitLog(logOutput);
    const unpushed = yield* getUnpushedShasEffect(worktreePath, branchName);
    applyPushedStatus(commits, unpushed);
    return commits;
  });
}

/**
 * Get recent commits on the current branch.
 * Always succeeds — returns [] on error.
 */
export function getRecentCommitsEffect(
  repoPath: string,
  branchName: string,
  limit: number,
): Effect.Effect<CommitInfo[], never> {
  return Effect.gen(function* () {
    const { stdout: logOutput } = yield* execGit(
      `git log --format="${GIT_LOG_FORMAT}" -${limit}`,
      { cwd: repoPath },
    ).pipe(Effect.catchAll(() => Effect.succeed({ stdout: "", stderr: "" })));

    const commits = parseGitLog(logOutput);
    const unpushed = yield* getUnpushedShasEffect(repoPath, branchName);
    applyPushedStatus(commits, unpushed);
    return commits;
  });
}

/**
 * Get diff for a specific commit.
 * Always succeeds — returns "" on error.
 */
export function getCommitDiffEffect(
  worktreePath: string,
  commitSha: string,
): Effect.Effect<string, never> {
  const opts = { cwd: worktreePath, maxBuffer: 50 * 1024 * 1024 };
  return execGit(`git diff "${commitSha}^..${commitSha}"`, opts).pipe(
    Effect.map(({ stdout }) => stdout),
    Effect.catchAll(() =>
      execGit(`git diff-tree --root -p "${commitSha}"`, opts).pipe(
        Effect.map(({ stdout }) => stdout),
        Effect.catchAll(() => Effect.succeed("")),
      ),
    ),
  );
}

// ---------------------------------------------------------------------------
// Editor / terminal launch helpers
// ---------------------------------------------------------------------------

/**
 * Open a directory in the system terminal.
 * Tries platform-appropriate terminal emulators; on Linux falls back to xterm.
 */
export function openInTerminalEffect(dirPath: string): Effect.Effect<void, CommandError> {
  return Effect.tryPromise({
    try: async () => {
      if (process.platform === "darwin") {
        await execAsync(`open -a iTerm "${dirPath}"`);
      } else if (process.platform === "win32") {
        await execAsync(`start cmd /K "cd /d ${dirPath}"`, { shell: "cmd.exe" });
      } else {
        // Linux — try common terminal emulators
        try {
          await execAsync(`x-terminal-emulator --working-directory="${dirPath}"`);
        } catch {
          // fallback to xterm
          await execAsync(`xterm -e "cd '${dirPath}' && $SHELL"`);
        }
      }
    },
    catch: (err) =>
      new CommandError({
        command: `openInTerminal ${dirPath}`,
        stderr: err instanceof Error ? err.message : String(err),
      }),
  });
}

/**
 * Open a directory in the Zed editor.
 */
export function openInZedEffect(dirPath: string): Effect.Effect<void, CommandError> {
  return Effect.tryPromise({
    try: () => execAsync(`zed "${dirPath}"`).then(() => undefined),
    catch: (err) =>
      new CommandError({
        command: `zed "${dirPath}"`,
        stderr: err instanceof Error ? err.message : String(err),
      }),
  });
}

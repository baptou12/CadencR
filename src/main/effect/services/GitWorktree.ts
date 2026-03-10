/**
 * Effect-based git worktree lifecycle functions.
 *
 * This is a stateless module — no Context.Tag. All functions return Effects
 * that can be run via AppRuntime.runPromise(). Functions that track progress
 * (setupWorktreeForFeatureEffect) depend on the Database and EventBroadcaster
 * services already in AppLayer.
 */

import { Effect, Either } from "effect";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import crypto from "node:crypto";
import { Database } from "./Database.js";
import { EventBroadcaster } from "./EventBroadcaster.js";
import {
  GitCommandError,
  WorktreeError,
  FileSystemError,
  DatabaseError,
} from "../errors.js";

const execAsync = promisify(exec);

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
    const eb = yield* EventBroadcaster;

    const setupRow = yield* db.queryOne<{ value: string }>(
      "SELECT value FROM project_settings WHERE project_id = ? AND key = 'setup_worktree'",
      projectId,
    );
    const setupCommands = setupRow?.value?.trim();

    if (!setupCommands) return;

    yield* setFeatureSettingEffect(featureId, "worktree_setup_step", "setup");
    yield* setFeatureSettingEffect(featureId, "worktree_setup_log", "");
    yield* eb.notifyDbUpdated("feature", featureId);

    const lines = setupCommands.split("\n").filter((l) => l.trim());
    let accumulatedLog = "";

    for (const cmd of lines) {
      accumulatedLog += `$ ${cmd}\n`;
      yield* setFeatureSettingEffect(featureId, "worktree_setup_log", accumulatedLog);
      yield* eb.notifyDbUpdated("feature", featureId);

      const cmdResult = yield* execGit(cmd, {
        cwd: worktreePath,
        timeout: 120_000,
      }).pipe(Effect.either);

      if (Either.isRight(cmdResult)) {
        const { stdout, stderr } = cmdResult.right;
        if (stdout) accumulatedLog += stdout;
        if (stderr) accumulatedLog += stderr;
        yield* setFeatureSettingEffect(featureId, "worktree_setup_log", accumulatedLog);
        yield* eb.notifyDbUpdated("feature", featureId);
      } else {
        const err = cmdResult.left;
        const errorMessage = err.stderr || String(err.cause ?? err);
        accumulatedLog += `ERROR: ${errorMessage}\n`;
        yield* setFeatureSettingEffect(featureId, "worktree_setup_log", accumulatedLog);
        yield* setFeatureSettingEffect(featureId, "worktree_setup_step", "error");
        yield* setFeatureSettingEffect(featureId, "worktree_setup_error", errorMessage);
        yield* eb.notifyDbUpdated("feature", featureId);
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
  Database | EventBroadcaster
> {
  return Effect.gen(function* () {
    const db = yield* Database;
    const eb = yield* EventBroadcaster;

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
    if (feature.type === "session") {
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
      yield* eb.notifyDbUpdated("feature", featureId);
      return;
    }

    // Step 1: Named
    yield* setFeatureSettingEffect(featureId, "worktree_setup_step", "named");
    yield* eb.notifyDbUpdated("feature", featureId);

    // Step 2: Create worktree (catch errors and store in DB like original)
    const createResult = yield* Effect.gen(function* () {
      yield* setFeatureSettingEffect(featureId, "worktree_setup_step", "creating");
      yield* eb.notifyDbUpdated("feature", featureId);

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
      yield* eb.notifyDbUpdated("feature", featureId);

      return wt;
    }).pipe(
      Effect.catchAll((err) =>
        Effect.gen(function* () {
          const errorMessage =
            err instanceof Error ? err.message : String(err);
          console.error("[worktree-setup] Failed:", errorMessage);
          yield* setFeatureSettingEffect(featureId, "worktree_setup_step", "error");
          yield* setFeatureSettingEffect(featureId, "worktree_setup_error", errorMessage);
          yield* eb.notifyDbUpdated("feature", featureId);
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
    yield* eb.notifyDbUpdated("feature", featureId);
  });
}

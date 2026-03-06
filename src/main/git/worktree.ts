import { exec } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import crypto from "node:crypto";
import { getDatabase } from "../db/database";
import { notifyDbUpdated } from "../agents/session-persistence";

export const execAsync = promisify(exec);
export interface WorktreeInfo {
  path: string;
  branch: string;
  head: string;
  isBare: boolean;
}

/**
 * Create a git worktree with a new branch.
 * Places the worktree at `../<project-name>-<branch>` relative to the repo root.
 */
export async function createWorktree(
  repoPath: string,
  branchName: string,
  projectName: string,
): Promise<{ worktreePath: string; branch: string }> {
  // Pre-flight: verify repoPath is a git repo
  try {
    await execAsync("git rev-parse --git-dir", {
      cwd: repoPath,
      encoding: "utf-8",
    });
  } catch {
    throw new Error(
      `Not a git repository: ${repoPath}. Ensure the project path points to a valid git repo.`,
    );
  }

  // Pre-flight: verify branch name is valid
  if (!branchName || /[\s~^:?*[\\]/.test(branchName)) {
    throw new Error(
      `Invalid branch name: "${branchName}". Branch names cannot contain spaces or special characters like ~ ^ : ? * [ \\`,
    );
  }

  // Sanitize branch name for use in directory names
  const safeBranch = branchName.replace(/\//g, "-");
  const worktreePath = path.join(os.homedir(), ".cadence", projectName, safeBranch);

  // Check if worktree directory already exists
  const dirExists = await fs.promises.access(worktreePath).then(() => true).catch(() => false);
  if (dirExists) {
    // Check if it's already a valid worktree
    const existing = await listWorktrees(repoPath);
    const alreadyExists = existing.find((w) => w.path === worktreePath);
    if (alreadyExists) {
      return { worktreePath, branch: branchName };
    }
    throw new Error(`Directory already exists but is not a worktree: ${worktreePath}`);
  }

  await fs.promises.mkdir(path.dirname(worktreePath), { recursive: true });

  try {
    await execAsync(`git worktree add "${worktreePath}" -b "${branchName}"`, {
      cwd: repoPath,
      encoding: "utf-8",
    });
  } catch (err: unknown) {
    // If branch already exists, try without -b
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("already exists")) {
      await execAsync(`git worktree add "${worktreePath}" "${branchName}"`, {
        cwd: repoPath,
        encoding: "utf-8",
      });
    } else {
      throw err;
    }
  }

  return { worktreePath, branch: branchName };
}

/**
 * List all worktrees for a repository.
 */
export async function listWorktrees(repoPath: string): Promise<WorktreeInfo[]> {
  const { stdout: output } = await execAsync("git worktree list --porcelain", {
    cwd: repoPath,
    encoding: "utf-8",
  });

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
}

/**
 * Remove a git worktree.
 */
export async function removeWorktree(repoPath: string, worktreePath: string): Promise<void> {
  await execAsync(`git worktree remove "${worktreePath}" --force`, {
    cwd: repoPath,
    encoding: "utf-8",
  });
}

/**
 * Get info for a specific worktree by its path.
 */
export async function getWorktreeInfo(
  repoPath: string,
  worktreePath: string,
): Promise<WorktreeInfo | null> {
  const all = await listWorktrees(repoPath);
  return all.find((w) => w.path === worktreePath) ?? null;
}

/**
 * Build a branch name from a feature title using the project's configured prefix.
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

/**
 * Set a feature setting in the DB (upsert).
 */
function setFeatureSetting(featureId: number, key: string, value: string): void {
  const db = getDatabase();
  db.prepare(
    "INSERT INTO feature_settings (feature_id, key, value) VALUES (?, ?, ?) ON CONFLICT(feature_id, key) DO UPDATE SET value = excluded.value",
  ).run(featureId, key, value);
}

/**
 * Setup a worktree for a feature: create the worktree and run setup commands.
 * Tracks progress via feature_settings (worktree_setup_step) and notifies the renderer.
 */
export async function setupWorktreeForFeature(
  projectId: number,
  featureId: number,
  options?: { skipSetupCommands?: boolean; onlySetupCommands?: boolean },
): Promise<string | void> {
  const db = getDatabase();

  const feature = db
    .prepare("SELECT title FROM features WHERE id = ?")
    .get(featureId) as { title: string } | undefined;
  if (!feature) throw new Error(`Feature not found: ${featureId}`);

  const project = db
    .prepare("SELECT name, path FROM projects WHERE id = ?")
    .get(projectId) as { name: string; path: string } | undefined;
  if (!project?.path) throw new Error(`Project path not found: ${projectId}`);

  // If onlySetupCommands, skip straight to running setup commands on an existing worktree
  if (options?.onlySetupCommands) {
    const wtRow = db
      .prepare(
        "SELECT value FROM feature_settings WHERE feature_id = ? AND key = 'worktree_path'",
      )
      .get(featureId) as { value: string } | undefined;
    if (!wtRow) throw new Error(`No worktree path found for feature ${featureId}`);
    await runSetupCommands(projectId, featureId, wtRow.value);
    setFeatureSetting(featureId, "worktree_setup_step", "done");
    notifyDbUpdated("feature", featureId);
    return;
  }

  // Step 1: Naming is already done
  setFeatureSetting(featureId, "worktree_setup_step", "named");
  notifyDbUpdated("feature", featureId);

  // Step 2: Create worktree
  try {
    setFeatureSetting(featureId, "worktree_setup_step", "creating");
    notifyDbUpdated("feature", featureId);

    const prefixRow = db
      .prepare("SELECT branch_prefix FROM projects WHERE id = ?")
      .get(projectId) as { branch_prefix: string | null } | undefined;
    const prefix = prefixRow?.branch_prefix ?? "feature/";
    const branchName = buildBranchName(prefix, feature.title);
    const wt = await createWorktree(project.path, branchName, project.name);

    setFeatureSetting(featureId, "worktree_path", wt.worktreePath);
    setFeatureSetting(featureId, "worktree_branch", wt.branch);
    setFeatureSetting(featureId, "worktree_setup_step", "created");
    notifyDbUpdated("feature", featureId);

    // If skipSetupCommands, return the worktree path immediately without running setup commands
    if (options?.skipSetupCommands) {
      return wt.worktreePath;
    }

    // Step 3: Run setup commands
    await runSetupCommands(projectId, featureId, wt.worktreePath);

    setFeatureSetting(featureId, "worktree_setup_step", "done");
    notifyDbUpdated("feature", featureId);
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error("[worktree-setup] Failed:", errorMessage);
    setFeatureSetting(featureId, "worktree_setup_step", "error");
    setFeatureSetting(featureId, "worktree_setup_error", errorMessage);
    notifyDbUpdated("feature", featureId);
  }
}

/**
 * Run setup commands in a worktree directory.
 * Extracted from setupWorktreeForFeature to allow running setup commands separately.
 */
async function runSetupCommands(
  projectId: number,
  featureId: number,
  worktreePath: string,
): Promise<void> {
  const db = getDatabase();
  const setupRow = db
    .prepare(
      "SELECT value FROM project_settings WHERE project_id = ? AND key = 'setup_worktree'",
    )
    .get(projectId) as { value: string } | undefined;
  const setupCommands = setupRow?.value?.trim();

  if (setupCommands) {
    setFeatureSetting(featureId, "worktree_setup_step", "setup");
    setFeatureSetting(featureId, "worktree_setup_log", "");
    notifyDbUpdated("feature", featureId);

    const lines = setupCommands.split("\n").filter((l) => l.trim());
    let accumulatedLog = "";

    for (const cmd of lines) {
      try {
        accumulatedLog += `$ ${cmd}\n`;
        setFeatureSetting(featureId, "worktree_setup_log", accumulatedLog);
        notifyDbUpdated("feature", featureId);

        const { stdout, stderr } = await execAsync(cmd, {
          cwd: worktreePath,
          timeout: 120_000,
        });
        if (stdout) accumulatedLog += stdout;
        if (stderr) accumulatedLog += stderr;
        setFeatureSetting(featureId, "worktree_setup_log", accumulatedLog);
        notifyDbUpdated("feature", featureId);
      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        accumulatedLog += `ERROR: ${errorMessage}\n`;
        setFeatureSetting(featureId, "worktree_setup_log", accumulatedLog);
        setFeatureSetting(featureId, "worktree_setup_step", "error");
        setFeatureSetting(featureId, "worktree_setup_error", errorMessage);
        notifyDbUpdated("feature", featureId);
        return;
      }
    }
  }
}

export async function getCurrentBranch(repoPath: string): Promise<string | null> {
  try {
    const { stdout } = await execAsync("git rev-parse --abbrev-ref HEAD", {
      cwd: repoPath,
      encoding: "utf-8",
    });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

/**
 * Get git diff stats for a worktree (lines added/removed).
 */
export async function getGitStats(
  worktreePath: string,
  mode: "worktree" | "branch" = "worktree",
  targetBranch?: string,
): Promise<{
  filesChanged: number;
  insertions: number;
  deletions: number;
}> {
  try {
    const opts = { cwd: worktreePath, encoding: "utf-8" as const };
    const statRegex =
      /(\d+)\s+files?\s+changed(?:,\s+(\d+)\s+insertions?\(\+\))?(?:,\s+(\d+)\s+deletions?\(-\))?/;

    function parseStatLine(output: string) {
      const m = output.match(statRegex);
      if (!m) return null;
      return {
        filesChanged: parseInt(m[1], 10),
        insertions: parseInt(m[2] ?? "0", 10),
        deletions: parseInt(m[3] ?? "0", 10),
      };
    }

    if (mode === "branch") {
      const branch = targetBranch ?? "main";
      const { stdout } = await execAsync(`git diff ${branch}...HEAD --stat`, opts);
      const result = parseStatLine(stdout);
      return result ?? { filesChanged: 0, insertions: 0, deletions: 0 };
    }

    // Worktree mode: unstaged + staged + untracked
    const [unstagedResult, stagedResult, untrackedResult] = await Promise.all([
      execAsync("git diff --stat", opts),
      execAsync("git diff --cached --stat", opts),
      execAsync("git ls-files --others --exclude-standard", opts),
    ]);

    const unstaged = parseStatLine(unstagedResult.stdout);
    const staged = parseStatLine(stagedResult.stdout);

    let filesChanged = (unstaged?.filesChanged ?? 0) + (staged?.filesChanged ?? 0);
    let insertions = (unstaged?.insertions ?? 0) + (staged?.insertions ?? 0);
    let deletions = (unstaged?.deletions ?? 0) + (staged?.deletions ?? 0);

    // Count untracked files — each line counts as an insertion
    const untrackedFiles = untrackedResult.stdout.trim().split("\n").filter(Boolean);
    const fileReadResults = await Promise.all(
      untrackedFiles.map(async (file) => {
        try {
          const fullPath = path.join(worktreePath, file);
          const content = await fs.promises.readFile(fullPath, "utf-8");
          const lineCount = content.split("\n").filter((_, i, arr) => i < arr.length - 1 || arr[arr.length - 1] !== "").length;
          return { lines: lineCount };
        } catch {
          return null;
        }
      }),
    );
    for (const result of fileReadResults) {
      if (result) {
        filesChanged++;
        insertions += result.lines;
      }
    }

    return { filesChanged, insertions, deletions };
  } catch {
    return { filesChanged: 0, insertions: 0, deletions: 0 };
  }
}

/**
 * Open a directory in the system's default terminal.
 */
export interface ChangedFile {
  file: string;
  status: string;
  oldFile?: string;
  additions: number;
  deletions: number;
}

/**
 * Get a unified diff string for a worktree.
 * - "worktree" mode: unstaged + staged + untracked changes
 * - "branch" mode: `git diff <targetBranch>...HEAD`
 */
export async function getDiff(
  worktreePath: string,
  mode: "worktree" | "branch",
  targetBranch?: string,
): Promise<string> {
  const branch = targetBranch ?? "main";
  try {
    if (mode === "worktree") {
      const opts = { cwd: worktreePath, encoding: "utf-8" as const, maxBuffer: 50 * 1024 * 1024 };
      // Run git commands in parallel
      const [unstagedResult, stagedResult, untrackedResult] = await Promise.all([
        execAsync("git diff", opts),
        execAsync("git diff --cached", opts),
        execAsync("git ls-files --others --exclude-standard", { ...opts, maxBuffer: 1024 * 1024 }),
      ]);

      const unstagedDiff = unstagedResult.stdout;
      const stagedDiff = stagedResult.stdout;
      const untrackedFiles = untrackedResult.stdout.trim().split("\n").filter(Boolean);

      // Build unified diffs for untracked (new) files by reading their content
      const untrackedDiffs = await Promise.all(
        untrackedFiles.map(async (file) => {
          try {
            const fullPath = path.join(worktreePath, file);
            const content = await fs.promises.readFile(fullPath, "utf-8");
            const lines = content.split("\n");
            // Remove trailing empty line from final newline
            if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
            const lineCount = lines.length;
            const addedLines = lines.map((l) => `+${l}`).join("\n");
            return `diff --git a/${file} b/${file}\nnew file mode 100644\n--- /dev/null\n+++ b/${file}\n@@ -0,0 +1,${lineCount} @@\n${addedLines}\n`;
          } catch {
            return "";
          }
        }),
      );

      return unstagedDiff + stagedDiff + untrackedDiffs.join("");
    }
    const { stdout } = await execAsync(`git diff ${branch}...HEAD`, {
      cwd: worktreePath,
      encoding: "utf-8",
      maxBuffer: 50 * 1024 * 1024,
    });
    return stdout;
  } catch {
    return "";
  }
}

/**
 * Get list of changed files with per-file addition/deletion counts.
 */
export async function getChangedFiles(
  worktreePath: string,
  mode: "worktree" | "branch",
  targetBranch?: string,
): Promise<ChangedFile[]> {
  const branch = targetBranch ?? "main";
  const diffArg = mode === "worktree" ? "" : `${branch}...HEAD`;

  try {
    // Get name-status and numstat in parallel
    const [nameStatusResult, numstatResult] = await Promise.all([
      execAsync(`git diff --name-status ${diffArg}`, {
        cwd: worktreePath,
        encoding: "utf-8",
      }),
      execAsync(`git diff --numstat ${diffArg}`, {
        cwd: worktreePath,
        encoding: "utf-8",
      }),
    ]);

    const nameStatus = nameStatusResult.stdout.trim();
    if (!nameStatus) return [];

    const numstat = numstatResult.stdout.trim();

    // Build numstat lookup: file -> { additions, deletions }
    const statMap = new Map<string, { additions: number; deletions: number }>();
    for (const line of numstat.split("\n")) {
      if (!line) continue;
      const parts = line.split("\t");
      if (parts.length >= 3) {
        const additions = parts[0] === "-" ? 0 : parseInt(parts[0], 10);
        const deletions = parts[1] === "-" ? 0 : parseInt(parts[1], 10);
        const file = parts.slice(2).join("\t"); // handle renames with => in name
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
        // Rename or copy: status\toldFile\tnewFile
        oldFile = parts[1];
        file = parts[2];
      } else {
        file = parts[1];
      }

      const stats = statMap.get(file) ??
        (oldFile ? statMap.get(`${oldFile} => ${file}`) : undefined) ??
        { additions: 0, deletions: 0 };

      files.push({
        file,
        status: statusCode,
        oldFile,
        additions: stats.additions,
        deletions: stats.deletions,
      });
    }

    return files;
  } catch {
    return [];
  }
}

/**
 * Detect the original branch from which a worktree branch was created.
 * Tries tracking config first, then falls back to detecting the default branch.
 */
export async function getOriginalBranch(repoPath: string, worktreeBranch: string): Promise<string> {
  const opts = { cwd: repoPath, encoding: "utf-8" as const };

  // 1. Try tracking config: branch.<name>.merge
  try {
    const { stdout } = await execAsync(`git config --get branch.${worktreeBranch}.merge`, opts);
    const merge = stdout.trim();
    if (merge) {
      // merge is like refs/heads/main — strip the prefix
      return merge.replace(/^refs\/heads\//, "");
    }
  } catch {
    // not configured
  }

  // 2. Try detecting the remote HEAD (origin/HEAD -> origin/main etc.)
  try {
    const { stdout } = await execAsync("git symbolic-ref refs/remotes/origin/HEAD", opts);
    const remoteHead = stdout.trim();
    if (remoteHead) {
      return remoteHead.replace(/^refs\/remotes\/origin\//, "");
    }
  } catch {
    // no remote HEAD
  }

  // 3. Fall back to checking for common default branch names
  for (const candidate of ["main", "master", "develop", "trunk"]) {
    try {
      await execAsync(`git rev-parse --verify ${candidate}`, opts);
      return candidate;
    } catch {
      // not found
    }
  }

  throw new Error(`Cannot determine original branch for worktree branch: ${worktreeBranch}`);
}

/**
 * Check if merging sourceBranch into targetBranch would produce conflicts.
 * Uses `git merge-tree` for a read-only dry-run — does not touch the working tree or index.
 * Must be run in the main repo (not a worktree).
 */
export async function checkMergeConflicts(
  repoPath: string,
  sourceBranch: string,
  targetBranch: string,
): Promise<{ hasConflicts: boolean; conflictFiles: string[] }> {
  const opts = { cwd: repoPath, encoding: "utf-8" as const };

  // Find the common ancestor (merge base)
  const { stdout: mergeBaseRaw } = await execAsync(`git merge-base "${targetBranch}" "${sourceBranch}"`, opts);
  const mergeBase = mergeBaseRaw.trim();

  // git merge-tree performs a three-way merge entirely in-memory — no checkout needed.
  // If the output contains conflict markers (<<<<<<<), there are conflicts.
  let mergeTreeOutput = "";
  try {
    const { stdout } = await execAsync(
      `git merge-tree "${mergeBase}" "${targetBranch}" "${sourceBranch}"`,
      { ...opts, maxBuffer: 50 * 1024 * 1024 },
    );
    mergeTreeOutput = stdout;
  } catch (err) {
    // merge-tree exits non-zero when it detects conflicts on some git versions
    mergeTreeOutput = err instanceof Error ? (err as NodeJS.ErrnoException & { stdout?: string }).stdout ?? err.message : String(err);
  }

  const hasConflicts = /^<{7} /m.test(mergeTreeOutput);

  // Identify conflicting files: files changed in both branches since the merge base
  const conflictFiles: string[] = [];
  if (hasConflicts) {
    const [sourceResult, targetResult] = await Promise.all([
      execAsync(`git diff --name-only "${mergeBase}" "${sourceBranch}"`, opts),
      execAsync(`git diff --name-only "${mergeBase}" "${targetBranch}"`, opts),
    ]);
    const sourceFiles = new Set(sourceResult.stdout.trim().split("\n").filter(Boolean));
    for (const f of targetResult.stdout.trim().split("\n").filter(Boolean)) {
      if (sourceFiles.has(f)) conflictFiles.push(f);
    }
  }

  return { hasConflicts, conflictFiles };
}

/**
 * Merge sourceBranch into targetBranch using --no-ff from the main repo.
 * Checks out target, merges, then restores the original branch.
 */
export async function mergeBranch(
  repoPath: string,
  sourceBranch: string,
  targetBranch: string,
): Promise<{ success: boolean; error?: string }> {
  const opts = { cwd: repoPath, encoding: "utf-8" as const };

  let originalBranch: string | null = null;
  try {
    const { stdout } = await execAsync("git rev-parse --abbrev-ref HEAD", opts);
    originalBranch = stdout.trim();
  } catch {
    // ignore
  }

  try {
    await execAsync(`git checkout "${targetBranch}"`, opts);
    await execAsync(`git merge --no-ff "${sourceBranch}"`, opts);
    return { success: true };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    // Try to abort any partial merge
    try { await execAsync("git merge --abort", opts); } catch { /* ignore */ }
    return { success: false, error };
  } finally {
    // Restore original branch if different
    if (originalBranch && originalBranch !== targetBranch) {
      try { await execAsync(`git checkout "${originalBranch}"`, opts); } catch { /* ignore */ }
    }
  }
}

/**
 * Delete a local branch using -d (safe — only if fully merged).
 */
export async function deleteLocalBranch(
  repoPath: string,
  branchName: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    await execAsync(`git branch -d "${branchName}"`, {
      cwd: repoPath,
      encoding: "utf-8",
    });
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Check if a worktree has any uncommitted or untracked changes.
 */
export async function hasUncommittedChanges(worktreePath: string): Promise<boolean> {
  try {
    const { stdout } = await execAsync("git status --porcelain", {
      cwd: worktreePath,
      encoding: "utf-8",
    });
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}

/**
 * Open a directory in the system's default terminal.
 */
export async function openInTerminal(dirPath: string): Promise<void> {
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
}

/**
 * Open a directory in the Zed editor.
 */
export async function openInZed(dirPath: string): Promise<void> {
  await execAsync(`zed "${dirPath}"`);
}

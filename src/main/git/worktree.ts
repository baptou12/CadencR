import { execSync } from "node:child_process";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
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
export function createWorktree(
  repoPath: string,
  branchName: string,
  projectName: string,
): { worktreePath: string; branch: string } {
  // Sanitize branch name for use in directory names
  const safeBranch = branchName.replace(/\//g, "-");
  const worktreePath = path.join(os.homedir(), ".productdevr", projectName, safeBranch);

  // Check if worktree directory already exists
  if (fs.existsSync(worktreePath)) {
    // Check if it's already a valid worktree
    const existing = listWorktrees(repoPath);
    const alreadyExists = existing.find((w) => w.path === worktreePath);
    if (alreadyExists) {
      return { worktreePath, branch: branchName };
    }
    throw new Error(`Directory already exists but is not a worktree: ${worktreePath}`);
  }

  fs.mkdirSync(path.dirname(worktreePath), { recursive: true });

  try {
    execSync(`git worktree add "${worktreePath}" -b "${branchName}"`, {
      cwd: repoPath,
      stdio: "pipe",
      encoding: "utf-8",
    });
  } catch (err: unknown) {
    // If branch already exists, try without -b
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("already exists")) {
      execSync(`git worktree add "${worktreePath}" "${branchName}"`, {
        cwd: repoPath,
        stdio: "pipe",
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
export function listWorktrees(repoPath: string): WorktreeInfo[] {
  const output = execSync("git worktree list --porcelain", {
    cwd: repoPath,
    stdio: "pipe",
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
export function removeWorktree(repoPath: string, worktreePath: string): void {
  execSync(`git worktree remove "${worktreePath}" --force`, {
    cwd: repoPath,
    stdio: "pipe",
    encoding: "utf-8",
  });
}

/**
 * Get info for a specific worktree by its path.
 */
export function getWorktreeInfo(
  repoPath: string,
  worktreePath: string,
): WorktreeInfo | null {
  const all = listWorktrees(repoPath);
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
  return `${prefix}${slug}`;
}

/**
 * Get git diff stats for a worktree (lines added/removed).
 */
export function getGitStats(worktreePath: string): {
  filesChanged: number;
  insertions: number;
  deletions: number;
} {
  try {
    const output = execSync("git diff --stat", {
      cwd: worktreePath,
      stdio: "pipe",
      encoding: "utf-8",
    });

    // Parse the summary line, e.g. " 3 files changed, 10 insertions(+), 2 deletions(-)"
    const summaryMatch = output.match(
      /(\d+)\s+files?\s+changed(?:,\s+(\d+)\s+insertions?\(\+\))?(?:,\s+(\d+)\s+deletions?\(-\))?/,
    );

    if (!summaryMatch) {
      // Also check staged changes
      const stagedOutput = execSync("git diff --cached --stat", {
        cwd: worktreePath,
        stdio: "pipe",
        encoding: "utf-8",
      });
      const stagedMatch = stagedOutput.match(
        /(\d+)\s+files?\s+changed(?:,\s+(\d+)\s+insertions?\(\+\))?(?:,\s+(\d+)\s+deletions?\(-\))?/,
      );
      if (!stagedMatch) {
        return { filesChanged: 0, insertions: 0, deletions: 0 };
      }
      return {
        filesChanged: parseInt(stagedMatch[1], 10),
        insertions: parseInt(stagedMatch[2] ?? "0", 10),
        deletions: parseInt(stagedMatch[3] ?? "0", 10),
      };
    }

    return {
      filesChanged: parseInt(summaryMatch[1], 10),
      insertions: parseInt(summaryMatch[2] ?? "0", 10),
      deletions: parseInt(summaryMatch[3] ?? "0", 10),
    };
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
 * - "worktree" mode: `git diff` (unstaged changes)
 * - "branch" mode: `git diff <targetBranch>...HEAD`
 */
export function getDiff(
  worktreePath: string,
  mode: "worktree" | "branch",
  targetBranch?: string,
): string {
  const branch = targetBranch ?? "main";
  const cmd = mode === "worktree" ? "git diff" : `git diff ${branch}...HEAD`;
  try {
    return execSync(cmd, {
      cwd: worktreePath,
      stdio: "pipe",
      encoding: "utf-8",
      maxBuffer: 50 * 1024 * 1024,
    });
  } catch {
    return "";
  }
}

/**
 * Get list of changed files with per-file addition/deletion counts.
 */
export function getChangedFiles(
  worktreePath: string,
  mode: "worktree" | "branch",
  targetBranch?: string,
): ChangedFile[] {
  const branch = targetBranch ?? "main";
  const diffArg = mode === "worktree" ? "" : `${branch}...HEAD`;

  try {
    // Get name-status for file statuses
    const nameStatus = execSync(`git diff --name-status ${diffArg}`, {
      cwd: worktreePath,
      stdio: "pipe",
      encoding: "utf-8",
    }).trim();

    if (!nameStatus) return [];

    // Get numstat for line counts
    const numstat = execSync(`git diff --numstat ${diffArg}`, {
      cwd: worktreePath,
      stdio: "pipe",
      encoding: "utf-8",
    }).trim();

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
 * Open a directory in the system's default terminal.
 */
export function openInTerminal(dirPath: string): void {
  // shell.openPath opens with the default application for that type
  // For directories on macOS, this opens Finder — so we use a different approach
  if (process.platform === "darwin") {
    execSync(`open -a Terminal "${dirPath}"`, { stdio: "pipe" });
  } else if (process.platform === "win32") {
    execSync(`start cmd /K "cd /d ${dirPath}"`, { stdio: "pipe", shell: "cmd.exe" });
  } else {
    // Linux — try common terminal emulators
    try {
      execSync(`x-terminal-emulator --working-directory="${dirPath}"`, { stdio: "pipe" });
    } catch {
      // fallback to xterm
      execSync(`xterm -e "cd '${dirPath}' && $SHELL"`, { stdio: "pipe" });
    }
  }
}

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

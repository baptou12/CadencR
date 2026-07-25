import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

export function parseWorktreeList(output: string): string[] {
  const worktrees: string[] = [];
  for (const record of output.split("\0\0")) {
    const field = record.split("\0").find((value) => value.startsWith("worktree "));
    if (field) worktrees.push(field.slice("worktree ".length));
  }
  return worktrees;
}

function runGit(cwd: string, args: string[]): string {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `git ${args.join(" ")} failed`);
  }
  return result.stdout;
}

export function gitCommonDir(cwd: string): string {
  return resolve(runGit(cwd, ["rev-parse", "--path-format=absolute", "--git-common-dir"]).trim());
}

export function listGitWorktrees(cwd: string): string[] {
  return parseWorktreeList(runGit(cwd, ["worktree", "list", "--porcelain", "-z"]));
}

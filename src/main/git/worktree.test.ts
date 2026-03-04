import { describe, it, expect, vi, beforeEach } from "vitest";
import path from "node:path";
import os from "node:os";

// Mock child_process before importing worktree
const { mockExecCb } = vi.hoisted(() => ({
  mockExecCb: vi.fn((_cmd: string, _opts: unknown, cb: (err: Error | null, result: { stdout: string; stderr: string }) => void) => {
    cb(null, { stdout: "", stderr: "" });
  }),
}));
vi.mock("node:child_process", () => ({
  execSync: vi.fn(),
  exec: mockExecCb,
}));

vi.mock("node:fs", () => ({
  default: {
    existsSync: vi.fn(),
    mkdirSync: vi.fn(),
    readFileSync: vi.fn(),
  },
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  readFileSync: vi.fn(),
}));

vi.mock("../db/database", () => ({
  getDatabase: vi.fn(() => ({
    prepare: vi.fn(() => ({ run: vi.fn(), get: vi.fn() })),
  })),
}));

vi.mock("../agents/session-persistence", () => ({
  notifyDbUpdated: vi.fn(),
}));

import { execSync } from "node:child_process";
import fs from "node:fs";
import {
  createWorktree,
  listWorktrees,
  removeWorktree,
  getWorktreeInfo,
  buildBranchName,
  getGitStats,
  getDiff,
  getChangedFiles,
  getCurrentBranch,
  getOriginalBranch,
  checkMergeConflicts,
  hasUncommittedChanges,
} from "./worktree";

const mockExecSync = vi.mocked(execSync);
const mockFsExistsSync = vi.mocked(fs.existsSync);
const _mockFsMkdirSync = vi.mocked(fs.mkdirSync);
const mockFsReadFileSync = vi.mocked(fs.readFileSync);

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── listWorktrees ──────────────────────────────────────────────────────────

describe("listWorktrees", () => {
  it("parses porcelain output into WorktreeInfo objects", () => {
    const porcelain = [
      "worktree /home/user/repo",
      "HEAD abc123",
      "branch refs/heads/main",
      "",
      "worktree /home/user/.cadence/myproject/feature-foo",
      "HEAD def456",
      "branch refs/heads/feature/foo",
      "",
    ].join("\n");

    mockExecSync.mockReturnValue(porcelain as any);

    const result = listWorktrees("/home/user/repo");
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      path: "/home/user/repo",
      branch: "main",
      head: "abc123",
      isBare: false,
    });
    expect(result[1]).toEqual({
      path: "/home/user/.cadence/myproject/feature-foo",
      branch: "feature/foo",
      head: "def456",
      isBare: false,
    });
  });

  it("marks bare worktrees correctly", () => {
    const porcelain = [
      "worktree /bare/repo",
      "HEAD abc123",
      "bare",
      "",
    ].join("\n");

    mockExecSync.mockReturnValue(porcelain as any);
    const result = listWorktrees("/bare/repo");
    expect(result[0].isBare).toBe(true);
  });

  it("handles detached HEAD (no branch line)", () => {
    const porcelain = [
      "worktree /detached",
      "HEAD abc123",
      "",
    ].join("\n");

    mockExecSync.mockReturnValue(porcelain as any);
    const result = listWorktrees("/detached");
    expect(result[0].branch).toBe("(detached)");
  });

  it("handles trailing entry with no trailing newline", () => {
    // No trailing empty line — should still capture the last entry
    const porcelain = [
      "worktree /home/user/repo",
      "HEAD abc123",
      "branch refs/heads/main",
    ].join("\n");

    mockExecSync.mockReturnValue(porcelain as any);
    const result = listWorktrees("/home/user/repo");
    expect(result).toHaveLength(1);
    expect(result[0].branch).toBe("main");
  });

  it("returns empty array for empty output", () => {
    mockExecSync.mockReturnValue("" as any);
    const result = listWorktrees("/repo");
    expect(result).toHaveLength(0);
  });
});

// ─── createWorktree ─────────────────────────────────────────────────────────

describe("createWorktree", () => {
  const repoPath = "/home/user/myrepo";
  const branchName = "feature/my-feature";
  const projectName = "myproject";
  const expectedDir = path.join(os.homedir(), ".cadence", projectName, "feature-my-feature");

  beforeEach(() => {
    // First call: git rev-parse --git-dir (success)
    // Second call: git worktree add (success)
    mockExecSync.mockReturnValue("" as any);
    mockFsExistsSync.mockReturnValue(false);
  });

  it("calls git rev-parse to verify repo", () => {
    createWorktree(repoPath, branchName, projectName);
    expect(mockExecSync).toHaveBeenCalledWith(
      "git rev-parse --git-dir",
      expect.objectContaining({ cwd: repoPath }),
    );
  });

  it("calls git worktree add with correct args", () => {
    createWorktree(repoPath, branchName, projectName);
    expect(mockExecSync).toHaveBeenCalledWith(
      `git worktree add "${expectedDir}" -b "${branchName}"`,
      expect.objectContaining({ cwd: repoPath }),
    );
  });

  it("returns worktreePath and branch on success", () => {
    const result = createWorktree(repoPath, branchName, projectName);
    expect(result.worktreePath).toBe(expectedDir);
    expect(result.branch).toBe(branchName);
  });

  it("converts / to - in branch name for directory path", () => {
    const result = createWorktree(repoPath, "feature/my-thing", projectName);
    expect(result.worktreePath).toContain("feature-my-thing");
  });

  it("throws if not a git repo", () => {
    mockExecSync.mockImplementationOnce(() => {
      throw new Error("not a git repo");
    });
    expect(() => createWorktree(repoPath, branchName, projectName)).toThrow(
      /Not a git repository/,
    );
  });

  it("throws for invalid branch names with spaces", () => {
    expect(() => createWorktree(repoPath, "branch with spaces", projectName)).toThrow(
      /Invalid branch name/,
    );
  });

  it("throws for invalid branch names with special chars", () => {
    expect(() => createWorktree(repoPath, "bad~branch", projectName)).toThrow(
      /Invalid branch name/,
    );
  });

  it("throws for empty branch name", () => {
    expect(() => createWorktree(repoPath, "", projectName)).toThrow(/Invalid branch name/);
  });

  it("falls back to worktree add without -b if branch already exists", () => {
    // First call: git rev-parse (success)
    // Second call: git worktree add -b (fails with "already exists")
    // Third call: git worktree add without -b (success)
    mockExecSync
      .mockReturnValueOnce("" as any)
      .mockImplementationOnce(() => {
        const err = new Error("fatal: branch already exists");
        throw err;
      })
      .mockReturnValueOnce("" as any);

    const result = createWorktree(repoPath, branchName, projectName);
    expect(result.branch).toBe(branchName);
    expect(mockExecSync).toHaveBeenCalledWith(
      `git worktree add "${expectedDir}" "${branchName}"`,
      expect.objectContaining({ cwd: repoPath }),
    );
  });

  it("returns early if worktree directory already exists as a valid worktree", () => {
    mockFsExistsSync.mockReturnValue(true);
    // listWorktrees call returns the existing worktree
    const porcelain = [
      `worktree ${expectedDir}`,
      "HEAD abc123",
      `branch refs/heads/${branchName}`,
      "",
    ].join("\n");
    // First call: git rev-parse, second call: git worktree list
    mockExecSync
      .mockReturnValueOnce("" as any)
      .mockReturnValueOnce(porcelain as any);

    const result = createWorktree(repoPath, branchName, projectName);
    expect(result.worktreePath).toBe(expectedDir);
  });

  it("throws if directory exists but is not a worktree", () => {
    mockFsExistsSync.mockReturnValue(true);
    // listWorktrees returns empty (directory is not a worktree)
    mockExecSync
      .mockReturnValueOnce("" as any)
      .mockReturnValueOnce("" as any); // empty porcelain

    expect(() => createWorktree(repoPath, branchName, projectName)).toThrow(
      /Directory already exists but is not a worktree/,
    );
  });
});

// ─── removeWorktree ──────────────────────────────────────────────────────────

describe("removeWorktree", () => {
  it("calls git worktree remove --force asynchronously", async () => {
    mockExecCb.mockImplementationOnce((_cmd: string, _opts: unknown, cb: (err: Error | null, result: { stdout: string; stderr: string }) => void) => {
      cb(null, { stdout: "", stderr: "" });
    });
    await removeWorktree("/repo", "/worktree/path");
    expect(mockExecCb).toHaveBeenCalledWith(
      'git worktree remove "/worktree/path" --force',
      expect.objectContaining({ cwd: "/repo" }),
      expect.any(Function),
    );
  });

  it("does not block the event loop (returns a promise)", () => {
    mockExecCb.mockImplementationOnce((_cmd: string, _opts: unknown, cb: (err: Error | null, result: { stdout: string; stderr: string }) => void) => {
      cb(null, { stdout: "", stderr: "" });
    });
    const result = removeWorktree("/repo", "/worktree/path");
    expect(result).toBeInstanceOf(Promise);
  });

  it("propagates errors from git", async () => {
    mockExecCb.mockImplementationOnce((_cmd: string, _opts: unknown, cb: (err: Error | null, result: { stdout: string; stderr: string }) => void) => {
      cb(new Error("fatal: worktree not found"), { stdout: "", stderr: "" });
    });
    await expect(removeWorktree("/repo", "/bad/path")).rejects.toThrow("fatal: worktree not found");
  });
});

// ─── getWorktreeInfo ─────────────────────────────────────────────────────────

describe("getWorktreeInfo", () => {
  it("returns the matching worktree", () => {
    const porcelain = [
      "worktree /repo/main",
      "HEAD abc",
      "branch refs/heads/main",
      "",
      "worktree /repo/feature",
      "HEAD def",
      "branch refs/heads/feature",
      "",
    ].join("\n");
    mockExecSync.mockReturnValue(porcelain as any);

    const info = getWorktreeInfo("/repo", "/repo/feature");
    expect(info).not.toBeNull();
    expect(info?.branch).toBe("feature");
  });

  it("returns null if path not found", () => {
    mockExecSync.mockReturnValue("" as any);
    const info = getWorktreeInfo("/repo", "/nonexistent");
    expect(info).toBeNull();
  });
});

// ─── buildBranchName ─────────────────────────────────────────────────────────

describe("buildBranchName", () => {
  it("slugifies the feature title", () => {
    const name = buildBranchName("feature/", "My New Feature!!");
    expect(name).toMatch(/^feature\/my-new-feature-[0-9a-f]{4}$/);
  });

  it("truncates long titles to 50 chars (before suffix)", () => {
    const longTitle = "a".repeat(100);
    const name = buildBranchName("feat/", longTitle);
    // prefix + 50-char slug + dash + 4-char hex
    const slug = name.slice("feat/".length, name.length - 5); // strip suffix
    expect(slug.length).toBeLessThanOrEqual(50);
  });

  it("removes leading/trailing dashes from slug", () => {
    const name = buildBranchName("", "---hello---");
    expect(name).toMatch(/^hello-[0-9a-f]{4}$/);
  });

  it("appends a 4-char hex suffix", () => {
    const name = buildBranchName("feature/", "test");
    const suffix = name.split("-").pop();
    expect(suffix).toMatch(/^[0-9a-f]{4}$/);
  });
});

// ─── getCurrentBranch ────────────────────────────────────────────────────────

describe("getCurrentBranch", () => {
  it("returns trimmed branch name", () => {
    mockExecSync.mockReturnValue("main\n" as any);
    expect(getCurrentBranch("/repo")).toBe("main");
  });

  it("returns null on error", () => {
    mockExecSync.mockImplementation(() => {
      throw new Error("not a git repo");
    });
    expect(getCurrentBranch("/bad")).toBeNull();
  });

  it("returns null for empty output", () => {
    mockExecSync.mockReturnValue("" as any);
    expect(getCurrentBranch("/repo")).toBeNull();
  });
});

// ─── getGitStats ─────────────────────────────────────────────────────────────

describe("getGitStats", () => {
  it("parses unstaged + staged stats in worktree mode", () => {
    mockExecSync
      .mockReturnValueOnce("2 files changed, 10 insertions(+), 3 deletions(-)\n" as any) // unstaged
      .mockReturnValueOnce("1 file changed, 5 insertions(+)\n" as any) // staged
      .mockReturnValueOnce("" as any); // untracked (empty)

    const stats = getGitStats("/worktree");
    expect(stats.filesChanged).toBe(3);
    expect(stats.insertions).toBe(15);
    expect(stats.deletions).toBe(3);
  });

  it("counts untracked files as insertions", () => {
    mockExecSync
      .mockReturnValueOnce("" as any) // unstaged
      .mockReturnValueOnce("" as any) // staged
      .mockReturnValueOnce("newfile.ts\n" as any); // untracked

    mockFsReadFileSync.mockReturnValue("line1\nline2\nline3\n" as any);

    const stats = getGitStats("/worktree");
    expect(stats.filesChanged).toBe(1);
    expect(stats.insertions).toBe(3);
  });

  it("parses branch mode stats", () => {
    mockExecSync.mockReturnValueOnce("3 files changed, 20 insertions(+), 5 deletions(-)\n" as any);

    const stats = getGitStats("/worktree", "branch", "main");
    expect(stats.filesChanged).toBe(3);
    expect(stats.insertions).toBe(20);
    expect(stats.deletions).toBe(5);
  });

  it("returns zeros on git error", () => {
    mockExecSync.mockImplementation(() => {
      throw new Error("git error");
    });
    const stats = getGitStats("/worktree");
    expect(stats).toEqual({ filesChanged: 0, insertions: 0, deletions: 0 });
  });

  it("returns zeros when no output matches", () => {
    mockExecSync
      .mockReturnValueOnce("" as any) // unstaged
      .mockReturnValueOnce("" as any) // staged
      .mockReturnValueOnce("" as any); // untracked

    const stats = getGitStats("/worktree");
    expect(stats).toEqual({ filesChanged: 0, insertions: 0, deletions: 0 });
  });
});

// ─── getDiff ─────────────────────────────────────────────────────────────────

describe("getDiff", () => {
  it("returns combined diff in worktree mode", () => {
    mockExecSync
      .mockReturnValueOnce("unstaged diff\n" as any)
      .mockReturnValueOnce("staged diff\n" as any)
      .mockReturnValueOnce("" as any); // no untracked

    const diff = getDiff("/worktree", "worktree");
    expect(diff).toContain("unstaged diff");
    expect(diff).toContain("staged diff");
  });

  it("includes untracked files in worktree mode diff", () => {
    mockExecSync
      .mockReturnValueOnce("" as any) // unstaged
      .mockReturnValueOnce("" as any) // staged
      .mockReturnValueOnce("newfile.ts\n" as any); // untracked

    mockFsReadFileSync.mockReturnValue("const x = 1;\n" as any);

    const diff = getDiff("/worktree", "worktree");
    expect(diff).toContain("newfile.ts");
    expect(diff).toContain("+const x = 1;");
  });

  it("returns branch diff in branch mode", () => {
    mockExecSync.mockReturnValueOnce("branch diff output\n" as any);

    const diff = getDiff("/worktree", "branch", "main");
    expect(diff).toBe("branch diff output\n");
    expect(mockExecSync).toHaveBeenCalledWith(
      "git diff main...HEAD",
      expect.objectContaining({ cwd: "/worktree" }),
    );
  });

  it("defaults to main branch when no targetBranch given in branch mode", () => {
    mockExecSync.mockReturnValueOnce("diff output\n" as any);
    getDiff("/worktree", "branch");
    expect(mockExecSync).toHaveBeenCalledWith(
      "git diff main...HEAD",
      expect.any(Object),
    );
  });

  it("returns empty string on error", () => {
    mockExecSync.mockImplementation(() => {
      throw new Error("git error");
    });
    const diff = getDiff("/worktree", "branch");
    expect(diff).toBe("");
  });
});

// ─── getChangedFiles ─────────────────────────────────────────────────────────

describe("getChangedFiles", () => {
  it("parses modified files from name-status + numstat", () => {
    mockExecSync
      .mockReturnValueOnce("M\tsrc/foo.ts\n" as any)  // name-status
      .mockReturnValueOnce("10\t2\tsrc/foo.ts\n" as any); // numstat

    const files = getChangedFiles("/worktree", "worktree");
    expect(files).toHaveLength(1);
    expect(files[0]).toEqual({
      file: "src/foo.ts",
      status: "M",
      oldFile: undefined,
      additions: 10,
      deletions: 2,
    });
  });

  it("parses renamed files (R status)", () => {
    mockExecSync
      .mockReturnValueOnce("R100\told.ts\tnew.ts\n" as any)
      .mockReturnValueOnce("5\t0\tnew.ts\n" as any);

    const files = getChangedFiles("/worktree", "worktree");
    expect(files[0].status).toBe("R100");
    expect(files[0].oldFile).toBe("old.ts");
    expect(files[0].file).toBe("new.ts");
  });

  it("returns empty array when no changes", () => {
    mockExecSync.mockReturnValueOnce("" as any);
    const files = getChangedFiles("/worktree", "worktree");
    expect(files).toEqual([]);
  });

  it("returns empty array on git error", () => {
    mockExecSync.mockImplementation(() => {
      throw new Error("git error");
    });
    const files = getChangedFiles("/worktree", "worktree");
    expect(files).toEqual([]);
  });

  it("uses branch diff args in branch mode", () => {
    mockExecSync
      .mockReturnValueOnce("M\tsrc/bar.ts\n" as any)
      .mockReturnValueOnce("3\t1\tsrc/bar.ts\n" as any);

    getChangedFiles("/worktree", "branch", "develop");
    expect(mockExecSync).toHaveBeenCalledWith(
      "git diff --name-status develop...HEAD",
      expect.any(Object),
    );
  });
});

// ─── getOriginalBranch ────────────────────────────────────────────────────────

describe("getOriginalBranch", () => {
  it("uses git config branch merge if available", async () => {
    mockExecSync.mockReturnValueOnce("refs/heads/main\n" as any);
    const result = await getOriginalBranch("/repo", "feature/foo");
    expect(result).toBe("main");
  });

  it("falls back to remote HEAD", async () => {
    mockExecSync
      .mockImplementationOnce(() => { throw new Error("not configured"); })
      .mockReturnValueOnce("refs/remotes/origin/main\n" as any);

    const result = await getOriginalBranch("/repo", "feature/foo");
    expect(result).toBe("main");
  });

  it("falls back to common default branches", async () => {
    mockExecSync
      .mockImplementationOnce(() => { throw new Error(); }) // config
      .mockImplementationOnce(() => { throw new Error(); }) // remote HEAD
      .mockReturnValueOnce("" as any); // main exists

    const result = await getOriginalBranch("/repo", "feature/foo");
    expect(result).toBe("main");
  });

  it("throws if no default branch found", async () => {
    mockExecSync.mockImplementation(() => { throw new Error("not found"); });
    await expect(getOriginalBranch("/repo", "feature/foo")).rejects.toThrow(
      /Cannot determine original branch/,
    );
  });
});

// ─── checkMergeConflicts ──────────────────────────────────────────────────────

describe("checkMergeConflicts", () => {
  it("returns hasConflicts=false when no conflict markers", async () => {
    mockExecSync
      .mockReturnValueOnce("base123\n" as any) // merge-base
      .mockReturnValueOnce("clean output\n" as any); // merge-tree

    const result = await checkMergeConflicts("/repo", "feature", "main");
    expect(result.hasConflicts).toBe(false);
    expect(result.conflictFiles).toEqual([]);
  });

  it("returns hasConflicts=true when conflict markers found", async () => {
    mockExecSync
      .mockReturnValueOnce("base123\n" as any) // merge-base
      .mockReturnValueOnce("<<<<<<< HEAD\nconflict\n======= \n>>>>>>>\n" as any) // merge-tree
      .mockReturnValueOnce("src/conflict.ts\n" as any) // source diff
      .mockReturnValueOnce("src/conflict.ts\n" as any); // target diff

    const result = await checkMergeConflicts("/repo", "feature", "main");
    expect(result.hasConflicts).toBe(true);
    expect(result.conflictFiles).toContain("src/conflict.ts");
  });
});

// ─── hasUncommittedChanges ────────────────────────────────────────────────────

describe("hasUncommittedChanges", () => {
  it("returns true when git status --porcelain has output", async () => {
    mockExecSync.mockReturnValue(" M src/foo.ts\n" as any);
    const result = await hasUncommittedChanges("/worktree");
    expect(result).toBe(true);
  });

  it("returns false when working tree is clean", async () => {
    mockExecSync.mockReturnValue("\n" as any);
    const result = await hasUncommittedChanges("/worktree");
    expect(result).toBe(false);
  });

  it("returns false on git error", async () => {
    mockExecSync.mockImplementation(() => {
      throw new Error("not a repo");
    });
    const result = await hasUncommittedChanges("/bad");
    expect(result).toBe(false);
  });
});

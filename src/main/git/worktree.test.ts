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
  exec: mockExecCb,
}));

const { mockAccess, mockMkdir, mockReadFile } = vi.hoisted(() => ({
  mockAccess: vi.fn((): Promise<void> => Promise.reject(new Error("ENOENT"))),
  mockMkdir: vi.fn((): Promise<void> => Promise.resolve(undefined)),
  mockReadFile: vi.fn((): Promise<string> => Promise.resolve("")),
}));

vi.mock("node:fs", () => ({
  default: {
    promises: {
      access: mockAccess,
      mkdir: mockMkdir,
      readFile: mockReadFile,
    },
  },
  promises: {
    access: mockAccess,
    mkdir: mockMkdir,
    readFile: mockReadFile,
  },
}));

vi.mock("../db/database", () => ({
  getDatabase: vi.fn(() => ({
    prepare: vi.fn(() => ({ run: vi.fn(), get: vi.fn() })),
  })),
}));

vi.mock("../agents/session-persistence", () => ({
  notifyDbUpdated: vi.fn(),
}));

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
  setupWorktreeForFeature,
  getFileContent,
  getRecentCommits,
  getCommitDiff,
  getCommitLog,
} from "./worktree";
import { getDatabase } from "../db/database";

/** Helper to set up sequential exec responses */
function mockExecResponses(...responses: Array<{ stdout?: string; stderr?: string; err?: Error }>) {
  for (const resp of responses) {
    mockExecCb.mockImplementationOnce((_cmd: string, _opts: unknown, cb: (err: Error | null, result: { stdout: string; stderr: string }) => void) => {
      if (resp.err) {
        cb(resp.err, { stdout: "", stderr: "" });
      } else {
        cb(null, { stdout: resp.stdout ?? "", stderr: resp.stderr ?? "" });
      }
    });
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default: exec succeeds with empty output
  mockExecCb.mockImplementation((_cmd: string, _opts: unknown, cb: (err: Error | null, result: { stdout: string; stderr: string }) => void) => {
    cb(null, { stdout: "", stderr: "" });
  });
  // Default: access rejects (file doesn't exist)
  mockAccess.mockRejectedValue(new Error("ENOENT"));
});

// ─── listWorktrees ──────────────────────────────────────────────────────────

describe("listWorktrees", () => {
  it("parses porcelain output into WorktreeInfo objects", async () => {
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

    mockExecResponses({ stdout: porcelain });

    const result = await listWorktrees("/home/user/repo");
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

  it("marks bare worktrees correctly", async () => {
    const porcelain = [
      "worktree /bare/repo",
      "HEAD abc123",
      "bare",
      "",
    ].join("\n");

    mockExecResponses({ stdout: porcelain });
    const result = await listWorktrees("/bare/repo");
    expect(result[0].isBare).toBe(true);
  });

  it("handles detached HEAD (no branch line)", async () => {
    const porcelain = [
      "worktree /detached",
      "HEAD abc123",
      "",
    ].join("\n");

    mockExecResponses({ stdout: porcelain });
    const result = await listWorktrees("/detached");
    expect(result[0].branch).toBe("(detached)");
  });

  it("handles trailing entry with no trailing newline", async () => {
    const porcelain = [
      "worktree /home/user/repo",
      "HEAD abc123",
      "branch refs/heads/main",
    ].join("\n");

    mockExecResponses({ stdout: porcelain });
    const result = await listWorktrees("/home/user/repo");
    expect(result).toHaveLength(1);
    expect(result[0].branch).toBe("main");
  });

  it("returns empty array for empty output", async () => {
    mockExecResponses({ stdout: "" });
    const result = await listWorktrees("/repo");
    expect(result).toHaveLength(0);
  });
});

// ─── createWorktree ─────────────────────────────────────────────────────────

describe("createWorktree", () => {
  const repoPath = "/home/user/myrepo";
  const branchName = "feature/my-feature";
  const projectName = "myproject";
  const expectedDir = path.join(os.homedir(), ".cadence", projectName, "feature-my-feature");

  it("calls git rev-parse to verify repo", async () => {
    await createWorktree(repoPath, branchName, projectName);
    expect(mockExecCb).toHaveBeenCalledWith(
      "git rev-parse --git-dir",
      expect.objectContaining({ cwd: repoPath }),
      expect.any(Function),
    );
  });

  it("calls git worktree add with correct args", async () => {
    await createWorktree(repoPath, branchName, projectName);
    expect(mockExecCb).toHaveBeenCalledWith(
      `git worktree add "${expectedDir}" -b "${branchName}"`,
      expect.objectContaining({ cwd: repoPath }),
      expect.any(Function),
    );
  });

  it("returns worktreePath and branch on success", async () => {
    const result = await createWorktree(repoPath, branchName, projectName);
    expect(result.worktreePath).toBe(expectedDir);
    expect(result.branch).toBe(branchName);
  });

  it("converts / to - in branch name for directory path", async () => {
    const result = await createWorktree(repoPath, "feature/my-thing", projectName);
    expect(result.worktreePath).toContain("feature-my-thing");
  });

  it("throws if not a git repo", async () => {
    mockExecResponses({ err: new Error("not a git repo") });
    await expect(createWorktree(repoPath, branchName, projectName)).rejects.toThrow(
      /Not a git repository/,
    );
  });

  it("throws for invalid branch names with spaces", async () => {
    await expect(createWorktree(repoPath, "branch with spaces", projectName)).rejects.toThrow(
      /Invalid branch name/,
    );
  });

  it("throws for invalid branch names with special chars", async () => {
    await expect(createWorktree(repoPath, "bad~branch", projectName)).rejects.toThrow(
      /Invalid branch name/,
    );
  });

  it("throws for empty branch name", async () => {
    await expect(createWorktree(repoPath, "", projectName)).rejects.toThrow(/Invalid branch name/);
  });

  it("falls back to worktree add without -b if branch already exists", async () => {
    // First call: git rev-parse (success)
    // Second call: git worktree add -b (fails with "already exists")
    // Third call: git worktree add without -b (success)
    mockExecResponses(
      { stdout: "" }, // rev-parse
      { err: new Error("fatal: branch already exists") }, // worktree add -b
      { stdout: "" }, // worktree add without -b
    );

    const result = await createWorktree(repoPath, branchName, projectName);
    expect(result.branch).toBe(branchName);
    expect(mockExecCb).toHaveBeenCalledWith(
      `git worktree add "${expectedDir}" "${branchName}"`,
      expect.objectContaining({ cwd: repoPath }),
      expect.any(Function),
    );
  });

  it("returns early if worktree directory already exists as a valid worktree", async () => {
    mockAccess.mockResolvedValueOnce(undefined);
    const porcelain = [
      `worktree ${expectedDir}`,
      "HEAD abc123",
      `branch refs/heads/${branchName}`,
      "",
    ].join("\n");
    // First call: git rev-parse, second call: git worktree list
    mockExecResponses(
      { stdout: "" }, // rev-parse
      { stdout: porcelain }, // worktree list
    );

    const result = await createWorktree(repoPath, branchName, projectName);
    expect(result.worktreePath).toBe(expectedDir);
  });

  it("throws if directory exists but is not a worktree", async () => {
    mockAccess.mockResolvedValueOnce(undefined);
    // listWorktrees returns empty (directory is not a worktree)
    mockExecResponses(
      { stdout: "" }, // rev-parse
      { stdout: "" }, // empty porcelain
    );

    await expect(createWorktree(repoPath, branchName, projectName)).rejects.toThrow(
      /Directory already exists but is not a worktree/,
    );
  });
});

// ─── removeWorktree ──────────────────────────────────────────────────────────

describe("removeWorktree", () => {
  it("calls git worktree remove --force asynchronously", async () => {
    await removeWorktree("/repo", "/worktree/path");
    expect(mockExecCb).toHaveBeenCalledWith(
      'git worktree remove "/worktree/path" --force',
      expect.objectContaining({ cwd: "/repo" }),
      expect.any(Function),
    );
  });

  it("does not block the event loop (returns a promise)", () => {
    const result = removeWorktree("/repo", "/worktree/path");
    expect(result).toBeInstanceOf(Promise);
  });

  it("propagates errors from git", async () => {
    mockExecResponses({ err: new Error("fatal: worktree not found") });
    await expect(removeWorktree("/repo", "/bad/path")).rejects.toThrow("fatal: worktree not found");
  });
});

// ─── getWorktreeInfo ─────────────────────────────────────────────────────────

describe("getWorktreeInfo", () => {
  it("returns the matching worktree", async () => {
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
    mockExecResponses({ stdout: porcelain });

    const info = await getWorktreeInfo("/repo", "/repo/feature");
    expect(info).not.toBeNull();
    expect(info?.branch).toBe("feature");
  });

  it("returns null if path not found", async () => {
    mockExecResponses({ stdout: "" });
    const info = await getWorktreeInfo("/repo", "/nonexistent");
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
    const slug = name.slice("feat/".length, name.length - 5);
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
  it("returns trimmed branch name", async () => {
    mockExecResponses({ stdout: "main\n" });
    expect(await getCurrentBranch("/repo")).toBe("main");
  });

  it("returns null on error", async () => {
    mockExecResponses({ err: new Error("not a git repo") });
    expect(await getCurrentBranch("/bad")).toBeNull();
  });

  it("returns null for empty output", async () => {
    mockExecResponses({ stdout: "" });
    expect(await getCurrentBranch("/repo")).toBeNull();
  });
});

// ─── getGitStats ─────────────────────────────────────────────────────────────

describe("getGitStats", () => {
  it("parses unstaged + staged stats in worktree mode", async () => {
    mockExecResponses(
      { stdout: "2 files changed, 10 insertions(+), 3 deletions(-)\n" }, // unstaged
      { stdout: "1 file changed, 5 insertions(+)\n" }, // staged
      { stdout: "" }, // untracked (empty)
    );

    const stats = await getGitStats("/worktree");
    expect(stats.filesChanged).toBe(3);
    expect(stats.insertions).toBe(15);
    expect(stats.deletions).toBe(3);
  });

  it("counts untracked files as insertions", async () => {
    mockExecResponses(
      { stdout: "" }, // unstaged
      { stdout: "" }, // staged
      { stdout: "newfile.ts\n" }, // untracked
    );

    mockReadFile.mockResolvedValueOnce("line1\nline2\nline3\n");

    const stats = await getGitStats("/worktree");
    expect(stats.filesChanged).toBe(1);
    expect(stats.insertions).toBe(3);
  });

  it("parses branch mode stats", async () => {
    mockExecResponses({ stdout: "3 files changed, 20 insertions(+), 5 deletions(-)\n" });

    const stats = await getGitStats("/worktree", "branch", "main");
    expect(stats.filesChanged).toBe(3);
    expect(stats.insertions).toBe(20);
    expect(stats.deletions).toBe(5);
  });

  it("returns zeros on git error", async () => {
    mockExecCb.mockImplementation((_cmd: string, _opts: unknown, cb: (err: Error | null, result: { stdout: string; stderr: string }) => void) => {
      cb(new Error("git error"), { stdout: "", stderr: "" });
    });
    const stats = await getGitStats("/worktree");
    expect(stats).toEqual({ filesChanged: 0, insertions: 0, deletions: 0 });
  });

  it("returns zeros when no output matches", async () => {
    mockExecResponses(
      { stdout: "" }, // unstaged
      { stdout: "" }, // staged
      { stdout: "" }, // untracked
    );

    const stats = await getGitStats("/worktree");
    expect(stats).toEqual({ filesChanged: 0, insertions: 0, deletions: 0 });
  });
});

// ─── getDiff ─────────────────────────────────────────────────────────────────

describe("getDiff", () => {
  it("returns combined diff in worktree mode", async () => {
    mockExecResponses(
      { stdout: "unstaged diff\n" },
      { stdout: "staged diff\n" },
      { stdout: "" }, // no untracked
    );

    const diff = await getDiff("/worktree", "worktree");
    expect(diff).toContain("unstaged diff");
    expect(diff).toContain("staged diff");
  });

  it("includes untracked files in worktree mode diff", async () => {
    mockExecResponses(
      { stdout: "" }, // unstaged
      { stdout: "" }, // staged
      { stdout: "newfile.ts\n" }, // untracked
    );

    mockReadFile.mockResolvedValueOnce("const x = 1;\n");

    const diff = await getDiff("/worktree", "worktree");
    expect(diff).toContain("newfile.ts");
    expect(diff).toContain("+const x = 1;");
  });

  it("returns branch diff in branch mode", async () => {
    mockExecResponses({ stdout: "branch diff output\n" });

    const diff = await getDiff("/worktree", "branch", "main");
    expect(diff).toBe("branch diff output\n");
    expect(mockExecCb).toHaveBeenCalledWith(
      "git diff main...HEAD",
      expect.objectContaining({ cwd: "/worktree" }),
      expect.any(Function),
    );
  });

  it("defaults to main branch when no targetBranch given in branch mode", async () => {
    mockExecResponses({ stdout: "diff output\n" });
    await getDiff("/worktree", "branch");
    expect(mockExecCb).toHaveBeenCalledWith(
      "git diff main...HEAD",
      expect.any(Object),
      expect.any(Function),
    );
  });

  it("returns empty string on error", async () => {
    mockExecCb.mockImplementation((_cmd: string, _opts: unknown, cb: (err: Error | null, result: { stdout: string; stderr: string }) => void) => {
      cb(new Error("git error"), { stdout: "", stderr: "" });
    });
    const diff = await getDiff("/worktree", "branch");
    expect(diff).toBe("");
  });
});

// ─── getChangedFiles ─────────────────────────────────────────────────────────

describe("getChangedFiles", () => {
  it("parses modified files from name-status + numstat", async () => {
    mockExecResponses(
      { stdout: "M\tsrc/foo.ts\n" },  // name-status
      { stdout: "10\t2\tsrc/foo.ts\n" }, // numstat
    );

    const files = await getChangedFiles("/worktree", "worktree");
    expect(files).toHaveLength(1);
    expect(files[0]).toEqual({
      file: "src/foo.ts",
      status: "M",
      oldFile: undefined,
      additions: 10,
      deletions: 2,
    });
  });

  it("parses renamed files (R status)", async () => {
    mockExecResponses(
      { stdout: "R100\told.ts\tnew.ts\n" },
      { stdout: "5\t0\tnew.ts\n" },
    );

    const files = await getChangedFiles("/worktree", "worktree");
    expect(files[0].status).toBe("R100");
    expect(files[0].oldFile).toBe("old.ts");
    expect(files[0].file).toBe("new.ts");
  });

  it("returns empty array when no changes", async () => {
    mockExecResponses(
      { stdout: "" }, // name-status
      { stdout: "" }, // numstat
    );
    const files = await getChangedFiles("/worktree", "worktree");
    expect(files).toEqual([]);
  });

  it("returns empty array on git error", async () => {
    mockExecCb.mockImplementation((_cmd: string, _opts: unknown, cb: (err: Error | null, result: { stdout: string; stderr: string }) => void) => {
      cb(new Error("git error"), { stdout: "", stderr: "" });
    });
    const files = await getChangedFiles("/worktree", "worktree");
    expect(files).toEqual([]);
  });

  it("uses branch diff args in branch mode", async () => {
    mockExecResponses(
      { stdout: "M\tsrc/bar.ts\n" },
      { stdout: "3\t1\tsrc/bar.ts\n" },
    );

    await getChangedFiles("/worktree", "branch", "develop");
    expect(mockExecCb).toHaveBeenCalledWith(
      "git diff --name-status develop...HEAD",
      expect.any(Object),
      expect.any(Function),
    );
  });
});

// ─── getOriginalBranch ────────────────────────────────────────────────────────

describe("getOriginalBranch", () => {
  it("uses git config branch merge if available", async () => {
    mockExecResponses({ stdout: "refs/heads/main\n" });
    const result = await getOriginalBranch("/repo", "feature/foo");
    expect(result).toBe("main");
  });

  it("falls back to remote HEAD", async () => {
    mockExecResponses(
      { err: new Error("not configured") },
      { stdout: "refs/remotes/origin/main\n" },
    );

    const result = await getOriginalBranch("/repo", "feature/foo");
    expect(result).toBe("main");
  });

  it("falls back to common default branches", async () => {
    mockExecResponses(
      { err: new Error() }, // config
      { err: new Error() }, // remote HEAD
      { stdout: "" }, // main exists
    );

    const result = await getOriginalBranch("/repo", "feature/foo");
    expect(result).toBe("main");
  });

  it("throws if no default branch found", async () => {
    mockExecCb.mockImplementation((_cmd: string, _opts: unknown, cb: (err: Error | null, result: { stdout: string; stderr: string }) => void) => {
      cb(new Error("not found"), { stdout: "", stderr: "" });
    });
    await expect(getOriginalBranch("/repo", "feature/foo")).rejects.toThrow(
      /Cannot determine original branch/,
    );
  });
});

// ─── checkMergeConflicts ──────────────────────────────────────────────────────

describe("checkMergeConflicts", () => {
  it("returns hasConflicts=false when no conflict markers", async () => {
    mockExecResponses(
      { stdout: "base123\n" }, // merge-base
      { stdout: "clean output\n" }, // merge-tree
    );

    const result = await checkMergeConflicts("/repo", "feature", "main");
    expect(result.hasConflicts).toBe(false);
    expect(result.conflictFiles).toEqual([]);
  });

  it("returns hasConflicts=true when conflict markers found", async () => {
    mockExecResponses(
      { stdout: "base123\n" }, // merge-base
      { stdout: "<<<<<<< HEAD\nconflict\n======= \n>>>>>>>\n" }, // merge-tree
      { stdout: "src/conflict.ts\n" }, // source diff
      { stdout: "src/conflict.ts\n" }, // target diff
    );

    const result = await checkMergeConflicts("/repo", "feature", "main");
    expect(result.hasConflicts).toBe(true);
    expect(result.conflictFiles).toContain("src/conflict.ts");
  });
});

// ─── hasUncommittedChanges ────────────────────────────────────────────────────

describe("hasUncommittedChanges", () => {
  it("returns true when git status --porcelain has output", async () => {
    mockExecResponses({ stdout: " M src/foo.ts\n" });
    const result = await hasUncommittedChanges("/worktree");
    expect(result).toBe(true);
  });

  it("returns false when working tree is clean", async () => {
    mockExecResponses({ stdout: "\n" });
    const result = await hasUncommittedChanges("/worktree");
    expect(result).toBe(false);
  });

  it("returns false on git error", async () => {
    mockExecResponses({ err: new Error("not a repo") });
    const result = await hasUncommittedChanges("/bad");
    expect(result).toBe(false);
  });
});

// ─── setupWorktreeForFeature — session guard ─────────────────────────────────

describe("setupWorktreeForFeature", () => {
  function mockDb(featureRow: Record<string, unknown> | undefined, projectRow: Record<string, unknown> | undefined) {
    const mockRun = vi.fn();
    const mockPrepare = vi.fn((sql: string) => {
      if (sql.includes("FROM features")) {
        return { get: vi.fn(() => featureRow), run: mockRun };
      }
      if (sql.includes("FROM projects")) {
        return { get: vi.fn(() => projectRow), run: mockRun };
      }
      // feature_settings inserts/updates, project_settings, etc.
      return { get: vi.fn(() => undefined), run: mockRun };
    });

    vi.mocked(getDatabase).mockReturnValue({ prepare: mockPrepare } as never);
    return { mockPrepare, mockRun };
  }

  it("skips worktree creation for session-type features", async () => {
    mockDb(
      { title: "Explore Codebase", type: "session" },
      { name: "myproject", path: "/home/user/myproject" },
    );

    const result = await setupWorktreeForFeature(1, 42);
    expect(result).toBeUndefined();
    // Should NOT have called git worktree add
    expect(mockExecCb).not.toHaveBeenCalledWith(
      expect.stringContaining("git worktree add"),
      expect.any(Object),
      expect.any(Function),
    );
  });

  it("skips worktree creation for session-type features even with skipSetupCommands", async () => {
    mockDb(
      { title: "Fix Bug Session", type: "session" },
      { name: "myproject", path: "/home/user/myproject" },
    );

    const result = await setupWorktreeForFeature(1, 42, { skipSetupCommands: true });
    expect(result).toBeUndefined();
    expect(mockExecCb).not.toHaveBeenCalledWith(
      expect.stringContaining("git worktree add"),
      expect.any(Object),
      expect.any(Function),
    );
  });

  it("proceeds with worktree creation for feature-type features", async () => {
    const { mockRun } = mockDb(
      { title: "Add Dark Mode", type: "feature" },
      { name: "myproject", path: "/home/user/myproject" },
    );

    await setupWorktreeForFeature(1, 42);
    // Should have attempted git worktree add
    expect(mockExecCb).toHaveBeenCalledWith(
      expect.stringContaining("git worktree add"),
      expect.any(Object),
      expect.any(Function),
    );
    // Should have stored the worktree_path setting
    expect(mockRun).toHaveBeenCalled();
  });

  it("throws when feature not found", async () => {
    mockDb(undefined, { name: "myproject", path: "/path" });
    await expect(setupWorktreeForFeature(1, 999)).rejects.toThrow(/Feature not found/);
  });

  it("throws when project path not found", async () => {
    mockDb({ title: "Test", type: "feature" }, undefined);
    await expect(setupWorktreeForFeature(1, 42)).rejects.toThrow(/Project path not found/);
  });
});

// ─── getFileContent ──────────────────────────────────────────────────────────

describe("getFileContent", () => {
  it("reads file from disk when no ref is given", async () => {
    mockReadFile.mockResolvedValueOnce("file contents");
    const result = await getFileContent("/worktree", "src/foo.ts");
    expect(result).toBe("file contents");
    expect(mockReadFile).toHaveBeenCalledWith("/worktree/src/foo.ts", "utf-8");
  });

  it("returns empty string when disk read fails", async () => {
    mockReadFile.mockRejectedValueOnce(new Error("ENOENT"));
    const result = await getFileContent("/worktree", "missing.ts");
    expect(result).toBe("");
  });

  it("uses git show when ref is provided", async () => {
    mockExecResponses({ stdout: "old content" });
    const result = await getFileContent("/worktree", "src/foo.ts", "abc123");
    expect(result).toBe("old content");
    expect(mockExecCb).toHaveBeenCalledWith(
      'git show "abc123:src/foo.ts"',
      expect.objectContaining({ cwd: "/worktree" }),
      expect.any(Function),
    );
  });

  it("returns empty string when git show fails", async () => {
    mockExecResponses({ err: new Error("fatal: path not found") });
    const result = await getFileContent("/worktree", "missing.ts", "HEAD");
    expect(result).toBe("");
  });
});

// ─── getRecentCommits ────────────────────────────────────────────────────────

describe("getRecentCommits", () => {
  const RS = "\x1e";

  it("parses recent commits and marks pushed status", async () => {
    const logOutput = [
      `${RS}aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111`,
      "aaaa111",
      "first commit",
      "Alice",
      "2025-01-01 12:00:00 +0000",
      "",
    ].join("\n");

    mockExecResponses(
      { stdout: logOutput },       // git log
      { stdout: "" },              // git rev-list (no unpushed — means all pushed)
    );

    const commits = await getRecentCommits("/repo", "main", 5);
    expect(commits).toHaveLength(1);
    expect(commits[0].sha).toBe("aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111");
    expect(commits[0].shortSha).toBe("aaaa111");
    expect(commits[0].message).toBe("first commit");
    expect(commits[0].author).toBe("Alice");
    expect(commits[0].isPushed).toBe(true);
  });

  it("marks commits as unpushed when rev-list returns them", async () => {
    const sha = "bbbb2222bbbb2222bbbb2222bbbb2222bbbb2222";
    const logOutput = [
      `${RS}${sha}`,
      "bbbb222",
      "unpushed commit",
      "Bob",
      "2025-02-01 12:00:00 +0000",
      "",
    ].join("\n");

    mockExecResponses(
      { stdout: logOutput },       // git log
      { stdout: `${sha}\n` },     // rev-list says this sha is unpushed
    );

    const commits = await getRecentCommits("/repo", "main", 5);
    expect(commits[0].isPushed).toBe(false);
  });

  it("marks all as unpushed when rev-list fails (no remote)", async () => {
    const logOutput = [
      `${RS}cccc3333cccc3333cccc3333cccc3333cccc3333`,
      "cccc333",
      "local commit",
      "Carol",
      "2025-03-01 12:00:00 +0000",
      "",
    ].join("\n");

    mockExecResponses(
      { stdout: logOutput },
      { err: new Error("fatal: no upstream") },
    );

    const commits = await getRecentCommits("/repo", "main", 5);
    expect(commits[0].isPushed).toBe(false);
  });

  it("returns empty array on git log error", async () => {
    mockExecResponses({ err: new Error("git error") });
    const commits = await getRecentCommits("/repo", "main", 10);
    expect(commits).toEqual([]);
  });
});

// ─── getCommitDiff ───────────────────────────────────────────────────────────

describe("getCommitDiff", () => {
  it("returns diff using parent-based diff", async () => {
    mockExecResponses({ stdout: "diff --git a/foo b/foo\n+hello\n" });
    const diff = await getCommitDiff("/worktree", "abc123");
    expect(diff).toContain("+hello");
    expect(mockExecCb).toHaveBeenCalledWith(
      'git diff "abc123^..abc123"',
      expect.objectContaining({ cwd: "/worktree" }),
      expect.any(Function),
    );
  });

  it("falls back to diff-tree for root commit", async () => {
    mockExecResponses(
      { err: new Error("fatal: bad revision") },  // parent diff fails
      { stdout: "root diff output\n" },            // diff-tree succeeds
    );
    const diff = await getCommitDiff("/worktree", "first");
    expect(diff).toBe("root diff output\n");
    expect(mockExecCb).toHaveBeenCalledWith(
      'git diff-tree --root -p "first"',
      expect.objectContaining({ cwd: "/worktree" }),
      expect.any(Function),
    );
  });

  it("returns empty string when both methods fail", async () => {
    mockExecResponses(
      { err: new Error("fail1") },
      { err: new Error("fail2") },
    );
    const diff = await getCommitDiff("/worktree", "bad");
    expect(diff).toBe("");
  });
});

// ─── getCommitLog ────────────────────────────────────────────────────────────

describe("getCommitLog", () => {
  const RS = "\x1e";

  it("returns commits between base and HEAD with pushed status", async () => {
    const sha = "dddd4444dddd4444dddd4444dddd4444dddd4444";
    const logOutput = [
      `${RS}${sha}`,
      "dddd444",
      "feature commit",
      "Dan",
      "2025-04-01 12:00:00 +0000",
      "Some body text",
    ].join("\n");

    mockExecResponses(
      { stdout: logOutput },  // git log main..HEAD
      { stdout: "" },         // rev-list (all pushed)
    );

    const commits = await getCommitLog("/worktree", "main", "feature/x");
    expect(commits).toHaveLength(1);
    expect(commits[0].message).toBe("feature commit");
    expect(commits[0].body).toBe("Some body text");
    expect(commits[0].isPushed).toBe(true);
  });

  it("returns empty array on git log error", async () => {
    mockExecResponses({ err: new Error("git error") });
    const commits = await getCommitLog("/worktree", "main", "feature/x");
    expect(commits).toEqual([]);
  });

  it("uses base..HEAD range for log command", async () => {
    mockExecResponses(
      { stdout: "" },  // git log
    );

    await getCommitLog("/worktree", "develop", "feature/y");
    expect(mockExecCb).toHaveBeenCalledWith(
      expect.stringContaining('"develop..HEAD"'),
      expect.objectContaining({ cwd: "/worktree" }),
      expect.any(Function),
    );
  });
});

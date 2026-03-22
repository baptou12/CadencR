import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockDb } from "../test-utils";

const mockDb = createMockDb();

vi.mock("../db/database", () => ({
  getDatabase: vi.fn(() => mockDb),
}));

vi.mock("electron", () => ({
  dialog: { showOpenDialog: vi.fn(), showSaveDialog: vi.fn() },
  app: { getPath: vi.fn().mockReturnValue("/tmp") },
}));

vi.mock("../agents/subprocess-manager", () => ({
  startSubprocess: vi.fn().mockReturnValue({ id: "sp-1", agentType: "plan", status: "running" }),
  stopSubprocess: vi.fn().mockResolvedValue(true),
  interruptSubprocess: vi.fn().mockResolvedValue(true),
  listSubprocesses: vi.fn().mockReturnValue([]),
  submitUserAnswers: vi.fn(),
  submitPlanApproval: vi.fn().mockReturnValue({ success: true }),
  submitToolPermission: vi.fn(),
  sendMessageToSubprocess: vi.fn().mockResolvedValue(undefined),
  setSubprocessPermissionMode: vi.fn().mockResolvedValue(undefined),
  getSupportedCommands: vi.fn().mockReturnValue([]),
}));

vi.mock("../agents/effect-helpers", () => ({
  getSubprocessIdForSession: vi.fn().mockReturnValue(null),
  getSubprocessIdsForSessionDbIds: vi.fn().mockReturnValue([]),
  notifyDbUpdated: vi.fn(),
}));

vi.mock("../agents/available-models", () => ({
  fetchAvailableModels: vi.fn().mockResolvedValue(["claude-opus-4-5", "claude-sonnet-4-5"]),
}));

vi.mock("../agents/agent-starters", () => ({
  startPlanAgent: vi.fn().mockResolvedValue({ subprocessId: "sp-1", agentType: "plan", sessionDbId: 1 }),
  startRiskAgent: vi.fn().mockResolvedValue({ subprocessId: "sp-1", agentType: "risk", sessionDbId: 3 }),
  startReviewAgent: vi.fn().mockResolvedValue({ subprocessId: "sp-1", agentType: "review", sessionDbId: 4 }),
  startSessionAgent: vi.fn().mockResolvedValue({ subprocessId: "sp-1", agentType: "session", sessionDbId: 5 }),
  startQaAgent: vi.fn().mockResolvedValue({ subprocessId: "sp-1", agentType: "qa", sessionDbId: 6 }),
  startRetroAgent: vi.fn().mockResolvedValue({ subprocessId: "sp-1", agentType: "retro", sessionDbId: 8 }),
}));

vi.mock("../agents/execute-agent", () => ({
  processNextPhase: vi.fn(),
  buildPhaseCompletionAction: vi.fn().mockReturnValue({ type: "complete_phase", phaseId: 1, featureId: 1 }),
}));

vi.mock("../agents/auto-name", () => ({
  autoNameFeature: vi.fn(),
  runAutoNameBlocking: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../agents/state-transitions", () => ({
  transitionAgentSession: vi.fn(),
}));

vi.mock("../agents/mcp-factory", () => ({
  buildMcpServerFactoryForResume: vi.fn().mockReturnValue(undefined),
}));

vi.mock("../git/worktree", () => ({
  execAsync: vi.fn().mockResolvedValue({ stdout: "", stderr: "" }),
  createWorktree: vi.fn().mockResolvedValue("/worktree/path"),
  removeWorktree: vi.fn().mockResolvedValue(undefined),
  getWorktreeInfo: vi.fn().mockResolvedValue(null),
  listWorktrees: vi.fn().mockResolvedValue([]),
  openInTerminal: vi.fn().mockResolvedValue(undefined),
  openInZed: vi.fn().mockResolvedValue(undefined),
  buildBranchName: vi.fn().mockReturnValue("feat/branch"),
  getGitStats: vi.fn().mockResolvedValue({ branch: "main", uncommittedChanges: 0, untrackedFiles: 0 }),
  getDiff: vi.fn().mockResolvedValue(""),
  getChangedFiles: vi.fn().mockResolvedValue([]),
  getCurrentBranch: vi.fn().mockResolvedValue("main"),
  setupWorktreeForFeature: vi.fn().mockResolvedValue("/worktree/path"),
  getOriginalBranch: vi.fn().mockResolvedValue("main"),
  checkMergeConflicts: vi.fn().mockResolvedValue(false),
  mergeBranch: vi.fn().mockResolvedValue(undefined),
  deleteLocalBranch: vi.fn().mockResolvedValue(undefined),
  hasUncommittedChanges: vi.fn().mockResolvedValue(false),
}));

vi.mock("../effect/services/GitWorktree", () => {
  const { Effect } = require("effect");
  return {
    // Lifecycle
    createWorktreeEffect: vi.fn().mockReturnValue(
      Effect.succeed({ worktreePath: "/worktrees/my-feature", branch: "feature/my-feature" }),
    ),
    removeWorktreeEffect: vi.fn().mockReturnValue(Effect.succeed(undefined)),
    listWorktreesEffect: vi.fn().mockReturnValue(Effect.succeed([])),
    getWorktreeInfoEffect: vi.fn().mockReturnValue(Effect.succeed(null)),
    buildBranchName: vi.fn().mockReturnValue("feat/branch"),
    setupWorktreeForFeatureEffect: vi.fn().mockReturnValue(Effect.succeed("/worktree/path")),
    // Query functions
    getCurrentBranchEffect: vi.fn().mockReturnValue(Effect.succeed("main")),
    getGitStatsEffect: vi.fn().mockReturnValue(
      Effect.succeed({ filesChanged: 0, insertions: 0, deletions: 0 }),
    ),
    getDiffEffect: vi.fn().mockReturnValue(Effect.succeed("")),
    getChangedFilesEffect: vi.fn().mockReturnValue(Effect.succeed([])),
    getOriginalBranchEffect: vi.fn().mockReturnValue(Effect.succeed("main")),
    checkMergeConflictsEffect: vi.fn().mockReturnValue(
      Effect.succeed({ hasConflicts: false, conflictFiles: [] }),
    ),
    mergeBranchEffect: vi.fn().mockReturnValue(Effect.succeed({ success: true })),
    deleteLocalBranchEffect: vi.fn().mockReturnValue(Effect.succeed({ success: true })),
    hasUncommittedChangesEffect: vi.fn().mockReturnValue(Effect.succeed(false)),
    getFileContentEffect: vi.fn().mockReturnValue(Effect.succeed("")),
    getCommitLogEffect: vi.fn().mockReturnValue(Effect.succeed([])),
    getRecentCommitsEffect: vi.fn().mockReturnValue(Effect.succeed([])),
    getCommitDiffEffect: vi.fn().mockReturnValue(Effect.succeed("")),
    execGit: vi.fn().mockReturnValue(Effect.succeed({ stdout: "", stderr: "" })),
  };
});

vi.mock("../effect/runtime", () => ({
  AppRuntime: {
    runPromise: vi.fn().mockImplementation((effect: unknown) => {
      const { Effect } = require("effect");
      return Effect.runPromise(effect as Parameters<typeof Effect.runPromise>[0]);
    }),
  },
}));

vi.mock("node:child_process", () => ({
  execSync: vi.fn().mockReturnValue(""),
  exec: vi.fn((_cmd: string, _opts: unknown, cb: (err: Error | null, result: { stdout: string; stderr: string }) => void) => {
    cb(null, { stdout: "", stderr: "" });
  }),
}));

let mockExistsSync = vi.fn().mockReturnValue(true);
let mockAccess = vi.fn().mockResolvedValue(undefined);

vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  const mockPromises = {
    ...actual.promises,
    access: (...args: any[]) => mockAccess(...args),
    mkdir: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn().mockResolvedValue(""),
  };
  return {
    ...actual,
    existsSync: (...args: Parameters<typeof import("node:fs").existsSync>) => mockExistsSync(...args),
    promises: mockPromises,
    default: {
      ...(actual as any).default,
      existsSync: (...args: Parameters<typeof import("node:fs").existsSync>) => mockExistsSync(...args),
      promises: mockPromises,
    },
  };
});

// Import the appRouter after mocks are set up
const { appRouter } = await import("./router");

describe("appRouter - workspaceRouter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.prepare.mockImplementation(() => ({
      get: vi.fn().mockReturnValue(undefined),
      all: vi.fn().mockReturnValue([]),
      run: vi.fn().mockReturnValue({ changes: 1, lastInsertRowid: 1 }),
    }));
  });

  const caller = appRouter.createCaller({});

  it("settings.getAvailableModels returns model list", async () => {
    const result = await caller.workspace.getAvailableModels();
    expect(result).toContain("claude-opus-4-5");
  });
});

// agents and sessions routers have been removed — all agent management
// is now handled by the Rust WebSocket backend.

// git procedures (getStats, getDiff, etc.) have been migrated to the Rust backend.

// git procedures (getStats, getDiff, etc.) have been migrated to the Rust backend.
// The tRPC git router now only contains openInTerminal and openInZed.
// diffComments and diffViewed have been migrated to the Rust backend.

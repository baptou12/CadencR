import { describe, it, expect, vi, beforeEach } from "vitest";
import { Effect } from "effect";
import { CliNotFoundError } from "../effect/errors";
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

vi.mock("../agents/cli-discovery", () => {
  const { Effect } = require("effect");
  return {
    discoverClaudeCli: vi.fn().mockReturnValue(Effect.succeed({ path: "/usr/bin/claude", source: "path" })),
  };
});

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

  it("settings.getClaudeCliPath returns path from discovery", async () => {
    const { discoverClaudeCli } = await import("../agents/cli-discovery");
    vi.mocked(discoverClaudeCli).mockReturnValue(Effect.succeed({ path: "/usr/bin/claude", source: "settings" }));
    const result = await caller.workspace.getClaudeCliPath();
    expect(result).toEqual({ path: "/usr/bin/claude", source: "settings" });
  });

  it("settings.getClaudeCliPath returns null when not found", async () => {
    const { discoverClaudeCli } = await import("../agents/cli-discovery");
    vi.mocked(discoverClaudeCli).mockReturnValue(Effect.fail(new CliNotFoundError({ searchedPaths: [] })));
    const result = await caller.workspace.getClaudeCliPath();
    expect(result).toBeNull();
  });

  it("settings.getAvailableModels returns model list", async () => {
    const result = await caller.workspace.getAvailableModels();
    expect(result).toContain("claude-opus-4-5");
  });

  it("settings.setClaudeCliPath stores path when file exists", async () => {
    mockExistsSync.mockReturnValue(true);
    const result = await caller.workspace.setClaudeCliPath({ path: "/usr/bin/claude" });
    expect(result).toMatchObject({ success: true, path: "/usr/bin/claude" });
  });

  it("settings.setClaudeCliPath throws when file not found", async () => {
    mockAccess.mockRejectedValueOnce(new Error("ENOENT"));
    await expect(caller.workspace.setClaudeCliPath({ path: "/nope" })).rejects.toThrow("File not found");
  });
});

describe("appRouter - agentsRouter & sessionsRouter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.prepare.mockImplementation(() => ({
      get: vi.fn().mockReturnValue(undefined),
      all: vi.fn().mockReturnValue([]),
      run: vi.fn().mockReturnValue({ changes: 1, lastInsertRowid: 1 }),
    }));
  });

  const caller = appRouter.createCaller({});

  it("agents.list returns active subprocesses", async () => {
    const { listSubprocesses } = await import("../agents/subprocess-manager");
    vi.mocked(listSubprocesses).mockReturnValue([
      { id: "sp-1", agentType: "plan", status: "running", startedAt: new Date("2024-01-01T00:00:00Z") } as any,
    ]);
    const result = await caller.agents.list();
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: "sp-1", agentType: "plan", status: "running" });
  });

  it("agents.stop calls stopSubprocess", async () => {
    const { stopSubprocess } = await import("../agents/subprocess-manager");
    vi.mocked(stopSubprocess).mockResolvedValue(true);
    const result = await caller.agents.stop({ id: "sp-1" });
    expect(stopSubprocess).toHaveBeenCalledWith("sp-1");
    expect(result).toEqual({ success: true });
  });

  it("agents.interrupt calls interruptSubprocess", async () => {
    const { interruptSubprocess } = await import("../agents/subprocess-manager");
    vi.mocked(interruptSubprocess).mockResolvedValue(true);
    const result = await caller.agents.interrupt({ id: "sp-1" });
    expect(result).toEqual({ success: true });
  });

  it("agents.submitAnswers calls submitUserAnswers", async () => {
    const { submitUserAnswers } = await import("../agents/subprocess-manager");
    const result = await caller.agents.submitAnswers({ subprocessId: "sp-1", answers: { q1: "yes" } });
    expect(submitUserAnswers).toHaveBeenCalledWith("sp-1", { q1: "yes" });
    expect(result).toEqual({ success: true });
  });

  it("agents.submitPlanApproval calls submitPlanApproval", async () => {
    const { submitPlanApproval } = await import("../agents/subprocess-manager");
    const result = await caller.agents.submitPlanApproval({ subprocessId: "sp-1", approved: true });
    expect(submitPlanApproval).toHaveBeenCalledWith("sp-1", true, undefined);
    expect(result).toEqual({ success: true });
  });

  it("agents.submitToolPermission calls submitToolPermission", async () => {
    const { submitToolPermission } = await import("../agents/subprocess-manager");
    const result = await caller.agents.submitToolPermission({ subprocessId: "sp-1", decision: "allow_once" });
    expect(submitToolPermission).toHaveBeenCalled();
    expect(result).toEqual({ success: true });
  });

  // Note: getSessions migrated to Rust backend (GET /api/features/:id/sessions)

  it("agents.deleteSession throws when session not found", async () => {
    mockDb.prepare.mockReturnValue({ get: vi.fn().mockReturnValue(undefined), run: vi.fn(), all: vi.fn().mockReturnValue([]) });
    await expect(caller.sessions.deleteSession({ sessionId: 999 })).rejects.toThrow("Session 999 not found");
  });

  it("agents.deleteSession throws for completed session", async () => {
    mockDb.prepare.mockReturnValue({
      get: vi.fn().mockReturnValue({ id: 1, status: "completed" }),
      run: vi.fn(),
      all: vi.fn().mockReturnValue([]),
    });
    await expect(caller.sessions.deleteSession({ sessionId: 1 })).rejects.toThrow("Cannot delete");
  });

  it("agents.deleteSession deletes non-completed session", async () => {
    mockDb.prepare.mockReturnValue({
      get: vi.fn().mockReturnValue({ id: 1, status: "error" }),
      run: vi.fn().mockReturnValue({ changes: 1 }),
      all: vi.fn().mockReturnValue([]),
    });
    const result = await caller.sessions.deleteSession({ sessionId: 1 });
    expect(result).toEqual({ success: true });
  });

  it("agents.stopBySessionId returns false when session not found", async () => {
    mockDb.prepare.mockReturnValue({ get: vi.fn().mockReturnValue(undefined), run: vi.fn(), all: vi.fn().mockReturnValue([]) });
    const result = await caller.sessions.stopBySessionId({ sessionId: 999 });
    expect(result).toEqual({ success: false });
  });

  it("agents.stopBySessionId stops subprocess when subprocess_id present", async () => {
    const { stopSubprocess } = await import("../agents/subprocess-manager");
    vi.mocked(stopSubprocess).mockResolvedValue(true);
    mockDb.prepare.mockReturnValue({
      get: vi.fn().mockReturnValue({ subprocess_id: "sp-1", status: "running" }),
      run: vi.fn().mockReturnValue({ changes: 1, lastInsertRowid: 0 }),
      all: vi.fn().mockReturnValue([]),
    });
    const result = await caller.sessions.stopBySessionId({ sessionId: 1 });
    expect(stopSubprocess).toHaveBeenCalledWith("sp-1");
    expect(result).toEqual({ success: true });
  });

  it("agents.interruptBySessionId returns false when no subprocess", async () => {
    mockDb.prepare.mockReturnValue({ get: vi.fn().mockReturnValue(undefined), run: vi.fn(), all: vi.fn().mockReturnValue([]) });
    const result = await caller.sessions.interruptBySessionId({ sessionId: 1 });
    expect(result).toEqual({ success: false });
  });

  it("agents.clearPlanApproval clears pending_plan_approval and notifies", async () => {
    const { notifyDbUpdated } = await import("../agents/effect-helpers");
    mockDb.prepare.mockImplementation((sql: string) => ({
      run: vi.fn().mockReturnValue({ changes: 1, lastInsertRowid: 0 }),
      get: vi.fn().mockReturnValue(sql.includes("SELECT feature_id") ? { feature_id: 42 } : undefined),
      all: vi.fn().mockReturnValue([]),
    }));

    const result = await caller.agents.clearPlanApproval({ sessionDbId: 10 });

    expect(result).toEqual({ success: true });
    expect(mockDb.prepare).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE agent_sessions SET pending_plan_approval = NULL"),
    );
    expect(notifyDbUpdated).toHaveBeenCalledWith("agent_session", 42);
  });

  it("agents.clearPlanApproval returns success:false when DB throws", async () => {
    mockDb.prepare.mockImplementation(() => {
      throw new Error("DB error");
    });

    const result = await caller.agents.clearPlanApproval({ sessionDbId: 999 });

    expect(result).toEqual({ success: false });
  });
});

// Note: there is no standalone getMessages procedure - messages are retrieved via getFeatureAgentState
// We test the buildBlocks logic indirectly through getFeatureAgentState

describe("appRouter - workflowRouter - agent starters", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    // fs.existsSync must return true for resolveAgentCwd to pass the directory check
    mockExistsSync.mockReturnValue(true);
    // Setup DB to return valid CWD paths for resolveAgentCwd
    mockDb.prepare.mockImplementation((sql: string) => ({
      get: vi.fn().mockImplementation(() => {
        if (sql.includes("feature_settings") && sql.includes("worktree_path")) {
          return { value: "/worktree/path" };
        }
        if (sql.includes("FROM projects")) {
          return { path: "/project/path" };
        }
        if (sql.includes("FROM features")) {
          return { title: "Feature A", type: "ws-feature", project_id: 1 };
        }
        return undefined;
      }),
      all: vi.fn().mockReturnValue([]),
      run: vi.fn().mockReturnValue({ changes: 1, lastInsertRowid: 1 }),
    }));
  });

  const caller = appRouter.createCaller({});

  it("agents.startPlan calls startPlanAgent with cwd", async () => {
    const { startPlanAgent } = await import("../agents/agent-starters");
    await caller.workflow.startPlan({ featureId: 1, projectId: 1, description: "Build feature" });
    expect(startPlanAgent).toHaveBeenCalledWith(expect.objectContaining({ featureId: 1, projectId: 1 }));
  });

  it("agents.startExecute calls processNextPhase", async () => {
    const { processNextPhase } = await import("../agents/execute-agent");
    await caller.workflow.startExecute({ featureId: 1, projectId: 1 });
    expect(processNextPhase).toHaveBeenCalled();
  });

  it("agents.startRisk calls startRiskAgent", async () => {
    const { startRiskAgent } = await import("../agents/agent-starters");
    await caller.workflow.startRisk({ featureId: 1, projectId: 1 });
    expect(startRiskAgent).toHaveBeenCalled();
  });

  it("agents.startRetro calls startRetroAgent", async () => {
    const { startRetroAgent } = await import("../agents/agent-starters");
    await caller.workflow.startRetro({ featureId: 1, projectId: 1 });
    expect(startRetroAgent).toHaveBeenCalled();
  });

  it("agents.startReview calls startReviewAgent", async () => {
    const { startReviewAgent } = await import("../agents/agent-starters");
    await caller.workflow.startReview({ featureId: 1, projectId: 1 });
    expect(startReviewAgent).toHaveBeenCalled();
  });

  it("agents.startQa calls startQaAgent", async () => {
    const { startQaAgent } = await import("../agents/agent-starters");
    await caller.workflow.startQa({ featureId: 1, projectId: 1 });
    expect(startQaAgent).toHaveBeenCalled();
  });

  it("agents.continueExecute calls processNextPhase", async () => {
    const { processNextPhase } = await import("../agents/execute-agent");
    await caller.workflow.continueExecute({ featureId: 1, projectId: 1 });
    expect(processNextPhase).toHaveBeenCalled();
  });
});

// git procedures (getStats, getDiff, etc.) have been migrated to the Rust backend.
// The tRPC git router now only contains openInTerminal and openInZed.
// diffComments and diffViewed have been migrated to the Rust backend.

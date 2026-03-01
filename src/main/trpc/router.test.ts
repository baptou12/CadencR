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

vi.mock("../agents/session-persistence", () => ({
  getSubprocessIdForSession: vi.fn().mockReturnValue(null),
  getSubprocessIdsForSessionDbIds: vi.fn().mockReturnValue([]),
  notifyDbUpdated: vi.fn(),
}));

vi.mock("../agents/cli-discovery", () => ({
  discoverClaudeCli: vi.fn().mockReturnValue({ path: "/usr/bin/claude", source: "path" }),
}));

vi.mock("../agents/available-models", () => ({
  fetchAvailableModels: vi.fn().mockResolvedValue(["claude-opus-4-5", "claude-sonnet-4-5"]),
}));

vi.mock("../agents/agent-starters", () => ({
  startPlanAgent: vi.fn().mockReturnValue({ subprocessId: "sp-1", agentType: "plan", sessionDbId: 1 }),
startRiskAgent: vi.fn().mockReturnValue({ subprocessId: "sp-1", agentType: "risk", sessionDbId: 3 }),
  startReviewAgent: vi.fn().mockReturnValue({ subprocessId: "sp-1", agentType: "review", sessionDbId: 4 }),
  startSessionAgent: vi.fn().mockReturnValue({ subprocessId: "sp-1", agentType: "session", sessionDbId: 5 }),
  startQaAgent: vi.fn().mockReturnValue({ subprocessId: "sp-1", agentType: "qa", sessionDbId: 6 }),
  startRetroAgent: vi.fn().mockReturnValue({ subprocessId: "sp-1", agentType: "retro", sessionDbId: 8 }),
  addFixPhase: vi.fn().mockReturnValue({ phaseId: 99 }),
}));

vi.mock("../agents/execute-agent", () => ({
  startExecuteAgent: vi.fn().mockReturnValue({ subprocessId: "sp-1", agentType: "execute", sessionDbId: 7 }),
  continueExecuteAgent: vi.fn().mockReturnValue(undefined),
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
  createWorktree: vi.fn().mockResolvedValue("/worktree/path"),
  removeWorktree: vi.fn().mockResolvedValue(undefined),
  getWorktreeInfo: vi.fn().mockReturnValue(null),
  openInTerminal: vi.fn(),
  openInZed: vi.fn(),
  buildBranchName: vi.fn().mockReturnValue("feat/branch"),
  getGitStats: vi.fn().mockReturnValue({ branch: "main", uncommittedChanges: 0, untrackedFiles: 0 }),
  getDiff: vi.fn().mockReturnValue(""),
  getChangedFiles: vi.fn().mockReturnValue([]),
  getCurrentBranch: vi.fn().mockReturnValue("main"),
  setupWorktreeForFeature: vi.fn().mockResolvedValue("/worktree/path"),
  getOriginalBranch: vi.fn().mockReturnValue("main"),
  checkMergeConflicts: vi.fn().mockReturnValue(false),
  mergeBranch: vi.fn().mockResolvedValue(undefined),
  deleteLocalBranch: vi.fn().mockResolvedValue(undefined),
  hasUncommittedChanges: vi.fn().mockReturnValue(false),
}));

vi.mock("node:child_process", () => ({
  execSync: vi.fn().mockReturnValue(""),
}));

let mockExistsSync = vi.fn().mockReturnValue(true);

vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return {
    ...actual,
    existsSync: (...args: Parameters<typeof import("node:fs").existsSync>) => mockExistsSync(...args),
    default: {
      ...(actual as any).default,
      existsSync: (...args: Parameters<typeof import("node:fs").existsSync>) => mockExistsSync(...args),
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

  it("settings.get returns null when key not found", async () => {
    mockDb.prepare.mockReturnValue({ get: vi.fn().mockReturnValue(undefined) });
    const result = await caller.workspace.get({ key: "model_plan" });
    expect(result).toBeNull();
  });

  it("settings.get returns value when key found", async () => {
    mockDb.prepare.mockReturnValue({ get: vi.fn().mockReturnValue({ value: "claude-opus" }) });
    const result = await caller.workspace.get({ key: "model_plan" });
    expect(result).toBe("claude-opus");
  });

  it("settings.set stores a value", async () => {
    const result = await caller.workspace.set({ key: "model_plan", value: "claude-sonnet" });
    expect(mockDb.prepare).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO settings"));
    expect(result).toEqual({ success: true });
  });

  it("settings.list returns all settings", async () => {
    const rows = [{ key: "model_plan", value: "claude-opus" }];
    mockDb.prepare.mockReturnValue({ all: vi.fn().mockReturnValue(rows) });
    const result = await caller.workspace.list();
    expect(result).toEqual(rows);
  });

  it("settings.getClaudeCliPath returns path from discovery", async () => {
    const { discoverClaudeCli } = await import("../agents/cli-discovery");
    vi.mocked(discoverClaudeCli).mockReturnValue({ path: "/usr/bin/claude", source: "settings" });
    const result = await caller.workspace.getClaudeCliPath();
    expect(result).toEqual({ path: "/usr/bin/claude", source: "settings" });
  });

  it("settings.getClaudeCliPath returns null when not found", async () => {
    const { discoverClaudeCli } = await import("../agents/cli-discovery");
    vi.mocked(discoverClaudeCli).mockReturnValue(null);
    const result = await caller.workspace.getClaudeCliPath();
    expect(result).toBeNull();
  });

  it("settings.getModelSettings returns models for all agent types", async () => {
    mockDb.prepare.mockReturnValue({ get: vi.fn().mockReturnValue({ value: "claude-opus" }) });
    const result = await caller.workspace.getModelSettings();
    expect(result).toHaveProperty("plan");
    expect(result).toHaveProperty("execute");
    expect(result["plan"]).toBe("claude-opus");
  });

  it("settings.setModelSetting stores model for agent type", async () => {
    const result = await caller.workspace.setModelSetting({ agentType: "plan", modelId: "claude-3" });
    expect(mockDb.prepare).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO settings"));
    expect(result).toEqual({ success: true });
  });

  it("settings.setModelSetting rejects invalid agent type", async () => {
    await expect(
      caller.workspace.setModelSetting({ agentType: "invalid" as any, modelId: "x" }),
    ).rejects.toThrow();
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
    mockExistsSync.mockReturnValue(false);
    await expect(caller.workspace.setClaudeCliPath({ path: "/nope" })).rejects.toThrow("File not found");
    mockExistsSync.mockReturnValue(true); // restore
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

  it("agents.getSessions returns sessions for feature", async () => {
    const sessions = [{ id: 1, feature_id: 1, agent_type: "plan", status: "completed" }];
    mockDb.prepare.mockReturnValue({ all: vi.fn().mockReturnValue(sessions) });
    const result = await caller.sessions.getSessions({ featureId: 1 });
    expect(result).toEqual(sessions);
  });

  it("agents.getSessions filters by status when provided", async () => {
    mockDb.prepare.mockReturnValue({ all: vi.fn().mockReturnValue([]) });
    await caller.sessions.getSessions({ featureId: 1, status: "running" });
    const sql = mockDb.prepare.mock.calls[0][0] as string;
    expect(sql).toContain("AND status = ?");
  });

  it("agents.deleteSession throws when session not found", async () => {
    mockDb.prepare.mockReturnValue({ get: vi.fn().mockReturnValue(undefined), run: vi.fn(), all: vi.fn().mockReturnValue([]) });
    await expect(caller.sessions.deleteSession({ sessionId: 999 })).rejects.toThrow("Session not found");
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
      run: vi.fn(),
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
    const { notifyDbUpdated } = await import("../agents/session-persistence");
    mockDb.prepare.mockImplementation((sql: string) => ({
      run: vi.fn(),
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
          return { title: "Feature A", type: "feature", project_id: 1 };
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

  it("agents.startExecute calls startExecuteAgent", async () => {
    const { startExecuteAgent } = await import("../agents/execute-agent");
    await caller.workflow.startExecute({ featureId: 1, projectId: 1 });
    expect(startExecuteAgent).toHaveBeenCalled();
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

  it("agents.addFixPhase calls addFixPhase", async () => {
    const { addFixPhase } = await import("../agents/agent-starters");
    await caller.workflow.addFixPhase({ featureId: 1, fixDescription: "Fix the bug" });
    expect(addFixPhase).toHaveBeenCalledWith(1, "Fix the bug");
  });

  it("agents.continueExecute calls continueExecuteAgent", async () => {
    const { continueExecuteAgent } = await import("../agents/execute-agent");
    await caller.workflow.continueExecute({ sessionDbId: 1 });
    expect(continueExecuteAgent).toHaveBeenCalledWith(1);
  });
});

describe("appRouter - git procedures", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.prepare.mockImplementation((sql: string) => ({
      get: vi.fn().mockImplementation(() => {
        if (sql.includes("worktree_path")) return { value: "/worktree/path" };
        if (sql.includes("FROM projects")) return { id: 1, name: "MyProject", path: "/project/path", branch_prefix: null };
        if (sql.includes("FROM features")) return { project_id: 1, type: "feature" };
        return undefined;
      }),
      all: vi.fn().mockReturnValue([]),
      run: vi.fn().mockReturnValue({ changes: 1, lastInsertRowid: 1 }),
    }));
  });

  const caller = appRouter.createCaller({});

  it("git.getStats returns stats for feature", async () => {
    const { getGitStats } = await import("../git/worktree");
    vi.mocked(getGitStats).mockReturnValue({ filesChanged: 2, insertions: 10, deletions: 3 } as any);
    const result = await caller.git.getStats({ featureId: 1 });
    expect(result).toMatchObject({ filesChanged: 2 });
  });

  it("git.getStats returns zeros when no git path", async () => {
    // Return nothing from features (no feature found)
    mockDb.prepare.mockReturnValue({ get: vi.fn().mockReturnValue(undefined), all: vi.fn().mockReturnValue([]), run: vi.fn() });
    const result = await caller.git.getStats({ featureId: 999 });
    expect(result).toEqual({ filesChanged: 0, insertions: 0, deletions: 0 });
  });

  it("git.getDiff returns diff string", async () => {
    const { getDiff } = await import("../git/worktree");
    vi.mocked(getDiff).mockReturnValue("diff --git a/foo.ts...");
    const result = await caller.git.getDiff({ featureId: 1, mode: "worktree" });
    expect(result).toBe("diff --git a/foo.ts...");
  });

  it("git.getChangedFiles returns changed file list", async () => {
    const { getChangedFiles } = await import("../git/worktree");
    vi.mocked(getChangedFiles).mockReturnValue([{ status: "M", path: "src/foo.ts" }] as any);
    const result = await caller.git.getChangedFiles({ featureId: 1, mode: "worktree" });
    expect(result).toHaveLength(1);
  });

  it("git.createWorktree calls createWorktree and saves path to DB", async () => {
    const { createWorktree, buildBranchName } = await import("../git/worktree");
    vi.mocked(buildBranchName).mockReturnValue("feature/my-feature");
    vi.mocked(createWorktree).mockReturnValue({ worktreePath: "/worktrees/my-feature", branch: "feature/my-feature" } as any);
    const result = await caller.git.createWorktree({ featureId: 1, projectId: 1, featureTitle: "My Feature" });
    expect(createWorktree).toHaveBeenCalled();
    expect(result).toMatchObject({ worktreePath: "/worktrees/my-feature" });
  });

  it("git.removeWorktree calls removeWorktree", async () => {
    const { removeWorktree } = await import("../git/worktree");
    vi.mocked(removeWorktree).mockReturnValue(undefined as any);
    const result = await caller.git.removeWorktree({ featureId: 1, projectId: 1 });
    expect(removeWorktree).toHaveBeenCalled();
    expect(result).toMatchObject({ success: true });
  });

  it("git.getBranch returns current branch for project", async () => {
    const { getCurrentBranch } = await import("../git/worktree");
    vi.mocked(getCurrentBranch).mockReturnValue("main");
    const result = await caller.git.getBranch({ projectId: 1 });
    expect(result).toBe("main");
  });
});

describe("appRouter - diffComments sub-router", () => {
  const caller = appRouter.createCaller({});

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.prepare.mockImplementation(() => ({
      get: vi.fn().mockReturnValue(undefined),
      all: vi.fn().mockReturnValue([]),
      run: vi.fn().mockReturnValue({ changes: 1, lastInsertRowid: 42 }),
    }));
  });

  it("diffComments.create creates a comment", async () => {
    const result = await caller.diffComments.create({
      featureId: 1, filePath: "src/a.ts", lineNumber: 5, side: "new", content: "comment",
    });
    expect(result).toMatchObject({ featureId: 1, status: "pending" });
  });

  it("diffComments.list returns empty when no comments", async () => {
    mockDb.prepare.mockReturnValue({ all: vi.fn().mockReturnValue([]) });
    const result = await caller.diffComments.list({ featureId: 1 });
    expect(result).toEqual([]);
  });
});

/**
 * Tests for hydrateFromSnapshotPatch.
 */

import { describe, it, expect, vi } from "vitest";
import { hydrateFromSnapshotPatch } from "./workflow-store-helpers";
import type { WorkflowState, FeatureSnapshot } from "@/types/workflow";

vi.mock("@/stores/ws-session-store", () => ({
  createStreamingState: () => ({ activeTextIndex: null, activeThinkingIndex: null, toolCalls: new Map() }),
  processSdkMessage: () => [],
  applyMutations: () => [],
}));

vi.mock("@/hooks/useFeatureAgentState", () => ({
  serverBlocksToAgentBlocks: () => [],
}));

function makeState(overrides: Partial<WorkflowState> = {}): WorkflowState {
  return {
    ws: null,
    featureId: 1,
    projectId: 1,
    queue: [],
    agents: new Map(),
    workflowStatus: "idle",
    pauseReason: null,
    autonomyLevel: 1,
    selectedItemId: null,
    error: null,
    hydrated: false,
    startingBuild: false,
    continuingBuild: false,
    startingSession: false,
    featureTitle: null,
    isAutoNaming: false,
    slashCommands: [],
    slashCommandsLoading: false,
    slashCommandsKey: null,
    slashCommandsRequestRef: null,
    worktreeStatus: "idle",
    worktreePath: null,
    worktreeBranch: null,
    worktreeSetupOutput: [],
    worktreeError: null,
    // action stubs
    connect: vi.fn(),
    disconnect: vi.fn(),
    hydrateFromSnapshot: vi.fn(),
    selectItem: vi.fn(),
    clearError: vi.fn(),
    setAutonomyLevel: vi.fn(),
    setParallelExecution: vi.fn(),
    startPlan: vi.fn(),
    startPrd: vi.fn(),
    approvePlan: vi.fn(),
    rejectPlan: vi.fn(),
    startBuild: vi.fn(),
    continueWorkflow: vi.fn(),
    skipItem: vi.fn(),
    retryItem: vi.fn(),
    retryWorktreeSetup: vi.fn(),
    respondToPermission: vi.fn(),
    respondToQuestion: vi.fn(),
    sendPromptToAgent: vi.fn(),
    interruptItem: vi.fn(),
    resumeItem: vi.fn(),
    startSession: vi.fn(),
    startRefine: vi.fn(),
    startReviewFixer: vi.fn(),
    startRisk: vi.fn(),
    startRetro: vi.fn(),
    markDone: vi.fn(),
    removeAgent: vi.fn(),
    deleteSession: vi.fn(),
    populateAgentBlocks: vi.fn(),
    populateOlderBlocks: vi.fn(),
    requestSlashCommands: vi.fn(),
    ...overrides,
  } as unknown as WorkflowState;
}

function makeSnapshot(overrides: Partial<FeatureSnapshot> = {}): FeatureSnapshot {
  return {
    workflow_status: "idle",
    queue: [],
    agent_sessions: [],
    plan: null,
    worktree: null,
    autonomy_level: 1,
    ...overrides,
  };
}

describe("hydrateFromSnapshotPatch", () => {
  it("sets hydrated to true", () => {
    const state = makeState();
    const snapshot = makeSnapshot();
    const patch = hydrateFromSnapshotPatch(state, snapshot);
    expect(patch.hydrated).toBe(true);
  });

  it("uses snapshot workflow_status when no WS queue", () => {
    const state = makeState();
    const snapshot = makeSnapshot({ workflow_status: "building" });
    const patch = hydrateFromSnapshotPatch(state, snapshot);
    expect(patch.workflowStatus).toBe("building");
  });

  it("uses snapshot queue unconditionally (no hasWsQueue guard; buffer-then-drain guarantees no WS queue exists at hydrate time)", () => {
    const preExistingQueue = [{ id: 1, item_type: "execute", phase_id: null, phase_title: null, status: "running" as const, order_index: 0, group_index: null, agent_session_id: null, result: null }];
    const state = makeState({ queue: preExistingQueue, workflowStatus: "building" });
    const snapshotQueue = [{ id: 42, item_type: "execute", phase_id: null, phase_title: null, status: "ready" as const, order_index: 0, group_index: null, agent_session_id: null, result: null }];
    const snapshot = makeSnapshot({ queue: snapshotQueue, workflow_status: "idle" });
    const patch = hydrateFromSnapshotPatch(state, snapshot);
    expect(patch.queue).toBe(snapshotQueue);
    expect(patch.workflowStatus).toBe("idle");
  });

  it("warns and skips instead of merging when an agent already exists for a snapshot session", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const existingAgent = {
      sessionId: 99,
      agentType: "plan",
      blocks: [{ id: "live", type: "user_message", content: "from ws", isError: false, createdAt: "t" }],
      streamingState: { activeTextIndex: null, activeThinkingIndex: null, toolCalls: new Map() },
      status: "running" as const,
      pendingPermission: null,
      pendingQuestions: [],
      pendingQuestionToolInput: {},
      pendingQuestionRequestId: "",
      historyLoaded: false,
      hasMore: false,
      oldestMessageId: null,
      runtimeSessionId: null,
      inputTokens: 0,
      outputTokens: 0,
      contextWindow: null,
      hasFileChanges: false,
      pendingPlanApproval: null,
    };
    const agents = new Map([["plan", existingAgent as unknown as import("@/types/workflow").AgentSessionState]]);
    const state = makeState({ agents });
    const snapshot = makeSnapshot({
      agent_sessions: [{
        id: 99,
        agent_type: "plan",
        queue_item_id: null,
        status: "running",
        runtime_session_id: null,
        input_tokens: null,
        output_tokens: null,
        context_window: null,
      } as unknown as FeatureSnapshot["agent_sessions"][number]],
    });
    const patch = hydrateFromSnapshotPatch(state, snapshot);
    expect(warnSpy).toHaveBeenCalled();
    // Existing agent preserved; snapshot did not overwrite blocks.
    expect((patch.agents as Map<string, unknown>).get("plan")).toBe(existingAgent);
    warnSpy.mockRestore();
  });
});

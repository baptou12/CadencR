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

  it("preserves WS queue when present", () => {
    const queue = [{ id: 1, item_type: "execute", phase_id: null, phase_title: null, status: "running" as const, order_index: 0, group_index: null, agent_session_id: null, result: null }];
    const state = makeState({ queue, workflowStatus: "building" });
    const snapshot = makeSnapshot({ queue: [], workflow_status: "idle" });
    const patch = hydrateFromSnapshotPatch(state, snapshot);
    expect(patch.queue).toBe(queue);
    expect(patch.workflowStatus).toBe("building");
  });
});

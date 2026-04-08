/**
 * Tests for hydrateFromSnapshotPatch — specifically the phase_states
 * hydration added to restore completed phase status on page load.
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
    workflowDefinitionId: null,
    phaseStates: new Map(),
    pendingApproval: null,
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
    approvePhase: vi.fn(),
    triggerPhase: vi.fn(),
    startCustomWorkflow: vi.fn(),
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

describe("hydrateFromSnapshotPatch — phase_states", () => {
  it("populates phaseStates from snapshot when map is empty", () => {
    const state = makeState();
    const snapshot = makeSnapshot({
      phase_states: [
        { slug: "specify", status: "completed", artifact_preview: "# My Spec\nSome content" },
        { slug: "plan", status: "completed", artifact_preview: null },
      ],
    });

    const patch = hydrateFromSnapshotPatch(state, snapshot);

    expect(patch.phaseStates?.size).toBe(2);
    expect(patch.phaseStates?.get("specify")).toMatchObject({
      slug: "specify",
      status: "completed",
      artifactPreview: "# My Spec\nSome content",
      agentSessionId: null,
    });
    expect(patch.phaseStates?.get("plan")).toMatchObject({
      slug: "plan",
      status: "completed",
      artifactPreview: null,
    });
  });

  it("does not overwrite phaseStates already populated by WS events", () => {
    const existing = new Map([
      ["specify", { slug: "specify", status: "running" as const, agentSessionId: 42, artifactPreview: null }],
    ]);
    const state = makeState({ phaseStates: existing });
    const snapshot = makeSnapshot({
      phase_states: [
        { slug: "specify", status: "completed", artifact_preview: "stale" },
      ],
    });

    const patch = hydrateFromSnapshotPatch(state, snapshot);

    // phaseStates from WS should be preserved unchanged
    expect(patch.phaseStates).toBe(existing);
  });

  it("leaves phaseStates empty when snapshot has no phase_states", () => {
    const state = makeState();
    const snapshot = makeSnapshot(); // no phase_states field

    const patch = hydrateFromSnapshotPatch(state, snapshot);

    // Should still be the original empty map (not crash)
    expect(patch.phaseStates?.size ?? 0).toBe(0);
  });
});

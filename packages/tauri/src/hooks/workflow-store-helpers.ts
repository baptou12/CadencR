/**
 * Pure state-computation helpers for the workflow Zustand store.
 *
 * Each function takes the current state (and optional snapshot/args) and returns
 * a partial state patch — no side effects.
 */

import { buildUserMessageContent } from "@/types/agent-types";
import { createStreamingState } from "@/stores/ws-session-store";
import type { AgentQuestion } from "@/components/AgentQuestionDrawer";
import {
  type WorkflowState,
  type AgentSessionState,
  type AutonomyLevel,
  type WorktreeStatus,
  type FeatureSnapshot,
  PLAN_KEY,
  PRD_KEY,
} from "@/types/workflow";
import {
  MULTI_INSTANCE_TYPES,
  patchAgent,
} from "@/hooks/agent-event-handlers";

// ---------------------------------------------------------------------------
// hydrateFromSnapshot
// ---------------------------------------------------------------------------

export function hydrateFromSnapshotPatch(
  state: WorkflowState,
  snapshot: FeatureSnapshot,
): Partial<WorkflowState> {
  const hasWsQueue = state.queue.length > 0;

  const agents = new Map(state.agents);

  for (const session of snapshot.agent_sessions) {
    const agentType = session.agent_type ?? "execute";

    const agentState: AgentSessionState = {
      sessionId: session.id,
      agentType,
      blocks: [],
      streamingState: createStreamingState(),
      status: (session.status as AgentSessionState["status"]) ?? "idle",
      pendingPermission: null,
      pendingQuestions: [],
      pendingQuestionToolInput: {},
      pendingQuestionRequestId: "",
      historyLoaded: false,
      claudeSessionId: session.claude_session_id ?? null,
      inputTokens: session.input_tokens ?? 0,
      outputTokens: session.output_tokens ?? 0,
      contextWindow: session.context_window || 200_000,
      hasFileChanges: false,
    };

    let key: string;
    if (agentType === "plan" || agentType === "refine") {
      key = PLAN_KEY;
    } else if (agentType === "prd") {
      key = PRD_KEY;
    } else if (session.queue_item_id != null) {
      key = `qi:${session.queue_item_id}`;
    } else if (MULTI_INSTANCE_TYPES.has(agentType)) {
      key = `${agentType}:${session.id}`;
    } else {
      key = `${agentType}:${session.id}`;
    }

    if (!agents.has(key)) agents.set(key, agentState);
  }

  const patch: Partial<WorkflowState> = {
    queue: hasWsQueue ? state.queue : snapshot.queue,
    workflowStatus: hasWsQueue && state.workflowStatus !== "idle"
      ? state.workflowStatus : snapshot.workflow_status,
    autonomyLevel: (snapshot.autonomy_level as AutonomyLevel) ?? 1,
    agents,
    hydrated: true,
  };

  if (snapshot.worktree) {
    patch.worktreePath = snapshot.worktree.path;
    patch.worktreeBranch = snapshot.worktree.branch;
    patch.worktreeStatus = snapshot.worktree.status as WorktreeStatus;
    if (snapshot.worktree.setup_log) {
      patch.worktreeSetupOutput = snapshot.worktree.setup_log.split("\n");
    }
  }

  return patch;
}

// ---------------------------------------------------------------------------
// sendPromptToAgent state patch
// ---------------------------------------------------------------------------

export function computeSendPromptPatch(
  state: WorkflowState,
  slotKey: string,
  text: string,
  images: unknown,
): Partial<WorkflowState> {
  const content = buildUserMessageContent(text, images as Parameters<typeof buildUserMessageContent>[1]);
  const userBlock = {
    id: `ws-user-${Date.now()}`,
    type: "user_message" as const,
    content,
    isError: false,
    createdAt: new Date().toISOString(),
  };

  const currentAgent = state.agents.get(slotKey);
  if (!currentAgent) return {};

  const agentPatch = patchAgent(state, slotKey, {
    status: "running",
    blocks: [...currentAgent.blocks, userBlock],
  });

  // If this is a queue item, also update the queue status
  if (slotKey.startsWith("qi:")) {
    const queueItemId = parseInt(slotKey.slice(3), 10);
    const queue = state.queue.map(q =>
      q.id === queueItemId && q.status === "paused" ? { ...q, status: "running" as const } : q,
    );
    return { ...agentPatch, queue };
  }
  return agentPatch;
}

// ---------------------------------------------------------------------------
// respondToQuestion helpers
// ---------------------------------------------------------------------------

export function computeRespondToQuestionClearPatch(): Partial<AgentSessionState> {
  return {
    pendingQuestions: [] as AgentQuestion[],
    pendingQuestionToolInput: {},
    pendingQuestionRequestId: "",
  };
}

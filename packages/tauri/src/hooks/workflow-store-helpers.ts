/**
 * Pure state-computation helpers for the workflow Zustand store.
 *
 * Extracted from useWorkflowWebSocket.ts to keep the store file under 400 lines.
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
  AGENT_TYPE_SYNTHETIC_KEYS,
} from "@/types/workflow";
import {
  MULTI_INSTANCE_TYPES,
  sessionDbKey,
  patchAgentByItemId,
} from "@/hooks/agent-event-handlers";

// ---------------------------------------------------------------------------
// hydrateFromSnapshot
// ---------------------------------------------------------------------------

/**
 * Compute the state patch from a feature snapshot during initial hydration.
 * Returns a partial WorkflowState — call `set(hydrateFromSnapshotPatch(get(), snapshot))`.
 */
export function hydrateFromSnapshotPatch(
  state: WorkflowState,
  snapshot: FeatureSnapshot,
): Partial<WorkflowState> {
  const hasWsQueue = state.queue.length > 0;

  const activeAgents = new Map(state.activeAgents);
  let planAgent: AgentSessionState | null = state.planAgent;
  let prdAgent: AgentSessionState | null = state.prdAgent;

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

    if (agentType === "plan" || agentType === "refine") {
      if (!planAgent) planAgent = agentState;
    } else if (agentType === "prd") {
      if (!prdAgent) prdAgent = agentState;
    } else {
      const key = session.queue_item_id
        ?? (MULTI_INSTANCE_TYPES.has(agentType) ? sessionDbKey(session.id) : (AGENT_TYPE_SYNTHETIC_KEYS[agentType] ?? sessionDbKey(session.id)));
      if (!activeAgents.has(key)) activeAgents.set(key, agentState);
    }
  }

  const patch: Partial<WorkflowState> = {
    queue: hasWsQueue ? state.queue : snapshot.queue,
    workflowStatus: hasWsQueue && state.workflowStatus !== "idle"
      ? state.workflowStatus : snapshot.workflow_status,
    autonomyLevel: (snapshot.autonomy_level as AutonomyLevel) ?? 1,
    activeAgents,
    planAgent,
    prdAgent,
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

/**
 * Compute the optimistic state patch when sending a prompt to an agent.
 * Adds a user message block and sets agent status to running.
 */
export function computeSendPromptPatch(
  state: WorkflowState,
  itemId: number,
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

  const currentAgent = itemId === -1 ? state.planAgent
    : itemId === -2 ? state.prdAgent
    : state.activeAgents.get(itemId);
  if (!currentAgent) return {};

  const agentPatch = patchAgentByItemId(state, itemId, {
    status: "running",
    blocks: [...currentAgent.blocks, userBlock],
  });

  if (itemId > 0) {
    const queue = state.queue.map(q =>
      q.id === itemId && q.status === "paused" ? { ...q, status: "running" as const } : q,
    );
    return { ...agentPatch, queue };
  }
  return agentPatch;
}

// ---------------------------------------------------------------------------
// respondToQuestion helpers
// ---------------------------------------------------------------------------

/** Build the WS payload and compute the clear-questions state patch for respondToQuestion. */
export function computeRespondToQuestionClearPatch(): Partial<AgentSessionState> {
  return {
    pendingQuestions: [] as AgentQuestion[],
    pendingQuestionToolInput: {},
    pendingQuestionRequestId: "",
  };
}

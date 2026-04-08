/**
 * Pure state-computation helpers for the workflow Zustand store.
 *
 * Each function takes the current state (and optional snapshot/args) and returns
 * a partial state patch — no side effects.
 */

import { buildUserMessageContent } from "@/types/agent-types";
import { createStreamingState } from "@/stores/ws-session-store";
import type { AgentQuestion } from "@/components/AgentQuestionDrawer";
import type { AgentBlockData } from "@/components/AgentBlock";
import type { FeatureAgentStateResponse } from "@/api/generated";
import { serverBlocksToAgentBlocks } from "@/hooks/useFeatureAgentState";
import {
  type WorkflowState,
  type AgentSessionState,
  type AutonomyLevel,
  type WorktreeStatus,
  type PhaseState,
  type FeatureSnapshot,
  PLAN_KEY,
  PRD_KEY,
} from "@/types/workflow";
import {
  patchAgent,
} from "@/hooks/agent-event-handlers";

// ---------------------------------------------------------------------------
// hydrateFromSnapshot
// ---------------------------------------------------------------------------

export function hydrateFromSnapshotPatch(
  state: WorkflowState,
  snapshot: FeatureSnapshot,
  agentStateResp?: FeatureAgentStateResponse,
): Partial<WorkflowState> {
  const hasWsQueue = state.queue.length > 0;

  // Build a lookup of REST-loaded blocks keyed by session DB id
  const restBlocks = new Map<number, { blocks: AgentBlockData[]; hasMore: boolean; oldestMessageId: number | null }>();
  if (agentStateResp) {
    for (const s of agentStateResp.sessions) {
      if (s.blocks.length === 0) continue;
      restBlocks.set(s.sessionDbId, {
        blocks: serverBlocksToAgentBlocks(s.blocks),
        hasMore: s.hasMore,
        oldestMessageId: s.oldestMessageId,
      });
    }
  }

  const agents = new Map(state.agents);

  for (const session of snapshot.agent_sessions) {
    const agentType = session.agent_type ?? "execute";

    let key: string;
    if (agentType === "plan" || agentType === "refine") {
      key = PLAN_KEY;
    } else if (agentType === "prd") {
      key = PRD_KEY;
    } else if (session.queue_item_id != null) {
      key = `qi:${session.queue_item_id}`;
    } else {
      key = `${agentType}:${session.id}`;
    }

    const rest = restBlocks.get(session.id);
    const existing = agents.get(key);

    if (existing) {
      // WS events already created this agent — merge REST blocks if available,
      // otherwise preserve existing agent as-is (it may have live streaming data)
      if (rest) {
        agents.set(key, {
          ...existing,
          blocks: rest.blocks,
          historyLoaded: true,
          hasMore: rest.hasMore,
          oldestMessageId: rest.oldestMessageId,
          claudeSessionId: existing.claudeSessionId ?? session.claude_session_id ?? null,
          inputTokens: session.input_tokens ?? existing.inputTokens,
          outputTokens: session.output_tokens ?? existing.outputTokens,
          contextWindow: session.context_window || existing.contextWindow,
        });
      }
    } else {
      agents.set(key, {
        sessionId: session.id,
        agentType,
        blocks: rest?.blocks ?? [],
        streamingState: createStreamingState(),
        status: (session.status as AgentSessionState["status"]) ?? "idle",
        pendingPermission: null,
        pendingQuestions: [],
        pendingQuestionToolInput: {},
        pendingQuestionRequestId: "",
        historyLoaded: rest != null,
        hasMore: rest?.hasMore ?? false,
        oldestMessageId: rest?.oldestMessageId ?? null,
        claudeSessionId: session.claude_session_id ?? null,
        inputTokens: session.input_tokens ?? 0,
        outputTokens: session.output_tokens ?? 0,
        contextWindow: session.context_window || 200_000,
        hasFileChanges: false,
      });
    }
  }

  // Hydrate phase states from snapshot (only if not already populated by WS events)
  let phaseStates = state.phaseStates;
  if (phaseStates.size === 0 && snapshot.phase_states?.length) {
    phaseStates = new Map<string, PhaseState>();
    for (const ps of snapshot.phase_states) {
      phaseStates.set(ps.slug, {
        slug: ps.slug,
        status: ps.status,
        agentSessionId: null,
        artifactPreview: ps.artifact_preview ?? null,
      });
    }
  }

  const patch: Partial<WorkflowState> = {
    queue: hasWsQueue ? state.queue : snapshot.queue,
    workflowStatus: hasWsQueue && state.workflowStatus !== "idle"
      ? state.workflowStatus : snapshot.workflow_status,
    autonomyLevel: (snapshot.autonomy_level as AutonomyLevel) ?? 1,
    agents,
    phaseStates,
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

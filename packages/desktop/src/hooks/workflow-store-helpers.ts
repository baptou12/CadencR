/**
 * Pure state-computation helpers for the workflow Zustand store.
 *
 * Each function takes the current state (and optional snapshot/args) and returns
 * a partial state patch — no side effects.
 */

import { createStreamingState } from "@/stores/ws-session-store";
import type { AgentBlockData } from "@/components/AgentBlock";
import type { FeatureAgentStateResponse } from "@/api/generated";
import { serverBlocksToAgentBlocks } from "@/hooks/useFeatureAgentState";
import {
  injectPlanIntoBlocks,
  rebuildDerivedAgentStreamState,
} from "@/stores/ws-message-processing";
import {
  type WorkflowState,
  type AgentSessionState,
  type AutonomyLevel,
  type WorktreeStatus,
  type FeatureSnapshot,
  PLAN_KEY,
  PRD_KEY,
} from "@/types/workflow";
import { parsePermissionMode } from "@/types/permission-mode";

// ---------------------------------------------------------------------------
// hydrateFromSnapshot
// ---------------------------------------------------------------------------

export function hydrateFromSnapshotPatch(
  state: WorkflowState,
  snapshot: FeatureSnapshot,
  agentStateResp?: FeatureAgentStateResponse,
): Partial<WorkflowState> {
  // Build a lookup of REST-loaded blocks keyed by session DB id
  const restBlocks = new Map<
    number,
    {
      blocks: AgentBlockData[];
      hasMore: boolean;
      oldestMessageId: number | null;
      pendingPlanApproval: { plan?: string } | null;
    }
  >();
  if (agentStateResp) {
    for (const s of agentStateResp.sessions) {
      if (s.blocks.length === 0 && !s.pendingPlanApproval) continue;
      const ppa = (s.pendingPlanApproval ?? null) as { plan?: string } | null;
      restBlocks.set(s.sessionDbId, {
        blocks: injectPlanIntoBlocks(serverBlocksToAgentBlocks(s.blocks), ppa),
        hasMore: s.hasMore ?? false,
        oldestMessageId: s.oldestMessageId ?? null,
        pendingPlanApproval: ppa,
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
    const blocks = rest?.blocks ?? [];
    const streamingState = createStreamingState();
    rebuildDerivedAgentStreamState(streamingState, blocks);

    // With WS event buffering during `hydrated === false`, no events can have
    // been applied yet — `existing` should always be undefined here. Keep a
    // defensive warn in case a regression reintroduces the race.
    if (existing) {
      if (typeof console !== "undefined") {
        // eslint-disable-next-line no-console
        console.warn("hydrateFromSnapshotPatch: unexpected existing agent at", key);
      }
      continue;
    }

    agents.set(key, {
      sessionId: session.id,
      agentType,
      blocks,
      streamingState,
      status: (session.status as AgentSessionState["status"]) ?? "idle",
      pendingPermission: null,
      pendingQuestions: [],
      pendingQuestionToolInput: {},
      pendingQuestionRequestId: "",
      historyLoaded: rest != null,
      hasMore: rest?.hasMore ?? false,
      oldestMessageId: rest?.oldestMessageId ?? null,
      runtimeSessionId: session.runtime_session_id ?? null,
      runtimeProvider: session.runtime_provider ?? null,
      model: session.model ?? null,
      permissionMode: parsePermissionMode(session.permission_mode) ?? "acceptEdits",
      inputTokens: session.input_tokens ?? 0,
      outputTokens: session.output_tokens ?? 0,
      contextWindow:
        session.context_window != null && session.context_window > 0
          ? session.context_window
          : null,
      hasFileChanges: false,
      pendingPlanApproval: rest?.pendingPlanApproval ?? null,
    });
  }

  const patch: Partial<WorkflowState> = {
    queue: snapshot.queue,
    workflowStatus: snapshot.workflow_status,
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

/**
 * WS event handler for workflow-domain messages.
 *
 * All handleMessage logic extracted from useWorkflowWebSocket so the store
 * file can focus on state shape and actions.
 *
 * Agent-specific helpers and handlers live in agent-event-handlers.ts.
 */

import { invalidateFeatureQueries } from "@/lib/featureUpdated";
import { type CommandsListPayload } from "@/lib/ws-envelope";
import type { SlashCommand } from "@/hooks/useSlashCommand";
import {
  type WorkflowState,
  type WorkflowStatus,
  type QueueItemStatus,
  parseAgentSlot,
  agentSlotToLegacyId,
  SESSION_KEY,
} from "@/types/workflow";
import {
  type SetFn,
  createAgentSession,
  sessionDbKey,
  resolveItemId,
  patchAgentByItemId,
  processAgentStream,
  insertAgentSession,
  handleAgentStream,
  handleAgentPaused,
  handleAgentRunning,
  handleAgentSessionId,
  handleAgentUserMessage,
  handleUsageUpdate,
  handlePermissionRequest,
} from "@/hooks/agent-event-handlers";

// Re-export helpers for backward compatibility (useWorkflowWebSocket.ts imports these)
export {
  createAgentSession,
  sessionDbKey,
  resolveItemId,
  patchAgentByItemId,
  processAgentStream,
} from "@/hooks/agent-event-handlers";
export {
  itemIdToSlot,
  MULTI_INSTANCE_TYPES,
  resolveAgentByItemId,
  blocksContainFileChange,
  resolveActiveKey,
  upsertAgentByItemId,
  resolveMultiInstanceKey,
  FILE_CHANGE_TOOLS,
} from "@/hooks/agent-event-handlers";

// ---------------------------------------------------------------------------
// Message handler factory
// ---------------------------------------------------------------------------

export function createWorkflowMessageHandler(
  set: SetFn,
  get: () => WorkflowState,
): (event: MessageEvent) => void {
  return function handleMessage(event: MessageEvent) {
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(event.data as string);
    } catch {
      return;
    }

    const domain = data.domain as string;
    const action = data.action as string;
    const payload = (data.payload ?? {}) as Record<string, unknown>;

    // Handle cross-domain events before the workflow-only guard
    if (domain === "session" && action === "feature.renamed") {
      const title = payload.title as string | undefined;
      if (title) set({ featureTitle: title });
      return;
    }

    if (domain === "feature" && action === "updated") {
      const changed = (payload.changed ?? []) as string[];
      const featureId = get().featureId;
      if (featureId) invalidateFeatureQueries(featureId, changed);
      return;
    }

    if (domain === "commands" && action === "list") {
      const p = payload as unknown as CommandsListPayload;
      const cmds: SlashCommand[] = (p.commands ?? []).map((c) => ({
        name: c.name,
        description: c.description ?? "",
      }));
      set({ slashCommands: cmds, slashCommandsLoading: false });
      return;
    }

    if (domain !== "workflow") return;

    switch (action) {
      case "queue_update": {
        const items = payload.items as QueueItemStatus[];
        const updates: Record<string, unknown> = { queue: items ?? [] };
        if (payload.workflow_status) {
          updates.workflowStatus = payload.workflow_status as string;
        }
        set(updates);
        break;
      }
      case "item_update": {
        const id = payload.id as number;
        set(state => ({
          queue: state.queue.map(q =>
            q.id === id
              ? {
                  ...q,
                  status: (payload.status as QueueItemStatus) ?? q.status,
                  result: (payload.result as string | null) ?? q.result,
                  agent_session_id: (payload.agent_session_id as number | null) ?? q.agent_session_id,
                }
              : q,
          ),
        }));
        break;
      }
      case "item_started": {
        const slot = parseAgentSlot(payload);
        const itemId = agentSlotToLegacyId(slot);
        const sessionId = payload.session_id as number;
        set(state => {
          const queue = state.queue.map(q =>
            q.id === itemId ? { ...q, status: "running" as const, agent_session_id: sessionId } : q,
          );
          const activeAgents = new Map(state.activeAgents);
          const existing = activeAgents.get(itemId);
          const session = { ...createAgentSession(sessionId), blocks: existing?.blocks ?? [] };
          activeAgents.set(itemId, session);
          return { queue, activeAgents, selectedItemId: state.selectedItemId ?? itemId, startingSession: false };
        });
        break;
      }
      case "item_completed": {
        const slot = parseAgentSlot(payload);
        const itemId = resolveItemId(get(), slot);
        set(state => {
          const queue = state.queue.map(q =>
            q.id === itemId ? { ...q, status: "completed" as const } : q,
          );
          return { queue, ...patchAgentByItemId(state, itemId, { status: "completed" }) };
        });
        break;
      }
      case "item_error": {
        const slot = parseAgentSlot(payload);
        const error = payload.error as string;
        const errItemId = resolveItemId(get(), slot);
        set(state => {
          const queue = state.queue.map(q =>
            q.id === errItemId ? { ...q, status: "error" as const, result: error } : q,
          );
          return { queue, error, ...patchAgentByItemId(state, errItemId, { status: "error" }) };
        });
        break;
      }
      case "item_retrying": {
        const itemId = payload.queue_item_id as number;
        const retryCount = payload.retry_count as number;
        const maxRetries = payload.max_retries as number;
        set(state => {
          const queue = state.queue.map(q =>
            q.id === itemId ? { ...q, status: "ready" as const, retry_count: retryCount, max_retries: maxRetries } : q,
          );
          return { queue };
        });
        break;
      }
      case "interrupted": {
        const slot = parseAgentSlot(payload);
        set(state => {
          const itemId = resolveItemId(state, slot);
          const agentPatch = patchAgentByItemId(state, itemId, { status: "paused" });
          if (itemId > 0) {
            const queue = state.queue.map(q =>
              q.id === itemId ? { ...q, status: "paused" as const } : q,
            );
            return { ...agentPatch, queue };
          }
          return agentPatch;
        });
        break;
      }
      case "paused": {
        const reason = payload.reason as string;
        set({ workflowStatus: "paused", pauseReason: reason });
        break;
      }
      case "status_update":
      case "status_changed": {
        const status = (payload.status as WorkflowStatus) ?? (payload.workflow_status as WorkflowStatus);
        if (status) {
          const previousStatus = (payload.previous_status as WorkflowStatus) ?? get().workflowStatus;
          const updates: Partial<WorkflowState> = { workflowStatus: status };

          if (previousStatus === "plan_approval" && status !== "plan_approval") {
            const planAgent = get().planAgent;
            if (planAgent) {
              updates.planAgent = { ...planAgent, status: "running" as const };
            }
          }

          if (previousStatus === "prd" && status === "planning") {
            const prdAgent = get().prdAgent;
            if (prdAgent && prdAgent.status === "paused") {
              updates.prdAgent = { ...prdAgent, status: "running" as const };
            }
          }

          if (status === "building" || status === "paused" || status === "error" || status === "completed") {
            updates.startingBuild = false;
            updates.continuingBuild = false;
            updates.startingSession = false;
          }

          set(updates);
        }
        break;
      }
      case "plan_agent_stream":
      case "prd_agent_stream": {
        const key = action === "plan_agent_stream" ? "planAgent" : "prdAgent";
        const msg = payload.message as Record<string, unknown>;
        if (!msg) break;
        set(state => {
          const agent = state[key as "planAgent" | "prdAgent"] ?? createAgentSession(0);
          return { [key]: processAgentStream(agent, msg) };
        });
        break;
      }
      case "plan_ready": {
        set(state => ({
          workflowStatus: "plan_approval",
          planAgent: state.planAgent ? { ...state.planAgent, status: "paused" as const } : state.planAgent,
        }));
        break;
      }
      case "plan_content":
      case "prd_content": {
        const content = payload.content as string;
        if (!content) break;
        const isPlan = action === "plan_content";
        const agentKey = isPlan ? "planAgent" : "prdAgent";
        const toolName = isPlan ? "__show_plan" : "__show_prd";
        const prefix = isPlan ? "plan" : "prd";
        set(state => {
          const agent = state[agentKey as "planAgent" | "prdAgent"] ?? createAgentSession(0);
          const block = {
            id: `ws-${prefix}-${Date.now()}`,
            type: "tool_call" as const,
            content: "",
            toolName,
            toolArgs: JSON.stringify({ plan: content }),
            createdAt: new Date().toISOString(),
          };
          return { [agentKey]: { ...agent, blocks: [...agent.blocks, block] } };
        });
        break;
      }
      case "prd_ready": {
        set(state => ({
          prdAgent: state.prdAgent ? { ...state.prdAgent, status: "paused" as const } : state.prdAgent,
        }));
        break;
      }
      case "session.started": {
        const startedSessionId = payload.session_id as number;
        set(state => {
          const activeAgents = new Map(state.activeAgents);
          const placeholder = activeAgents.get(SESSION_KEY);
          if (placeholder) activeAgents.delete(SESSION_KEY);
          const existing = activeAgents.get(sessionDbKey(startedSessionId));
          const session = {
            ...(existing ?? createAgentSession(startedSessionId, "session")),
            sessionId: startedSessionId,
            blocks: [...(placeholder?.blocks ?? []), ...(existing?.blocks ?? [])],
          };
          activeAgents.set(sessionDbKey(startedSessionId), session);
          return { activeAgents, startingSession: false };
        });
        break;
      }
      case "refine.started": {
        // Refine streams via planAgent state; no activeAgents entry needed
        break;
      }
      case "risk.started":
      case "retro.started": {
        const agentType = action === "risk.started" ? "risk" : "retro";
        set(state => insertAgentSession(state, payload.session_id as number, agentType));
        break;
      }
      case "agent_paused": {
        handleAgentPaused(payload, set);
        break;
      }
      case "agent_running": {
        handleAgentRunning(payload, set);
        break;
      }
      case "agent_session_id": {
        handleAgentSessionId(payload, set);
        break;
      }
      case "agent_user_message": {
        handleAgentUserMessage(payload, set);
        break;
      }
      case "agent_stream": {
        handleAgentStream(payload, set);
        break;
      }
      case "usage_update": {
        handleUsageUpdate(payload, set);
        break;
      }
      case "permission.request": {
        handlePermissionRequest(payload, set);
        break;
      }
      case "review_verdict": {
        // Informational — queue_update will follow with new items
        break;
      }
      case "review_fixer.started": {
        set(state => insertAgentSession(state, payload.session_id as number, "review-fixer"));
        break;
      }
      case "worktree.creating": {
        set({
          worktreeStatus: "creating",
          worktreeBranch: (payload.branch as string) ?? null,
          worktreePath: (payload.path as string) ?? null,
          worktreeError: null,
        });
        break;
      }
      case "worktree.created": {
        set({
          worktreeStatus: "created",
          worktreePath: (payload.path as string) ?? null,
          worktreeBranch: (payload.branch as string) ?? null,
        });
        break;
      }
      case "worktree.setup_running": {
        set({ worktreeStatus: "setup_running" });
        break;
      }
      case "worktree.setup_output": {
        const line = payload.line as string;
        if (line != null) {
          set(state => ({ worktreeSetupOutput: [...state.worktreeSetupOutput, line] }));
        }
        break;
      }
      case "worktree.ready": {
        set({ worktreeStatus: "ready" });
        break;
      }
      case "worktree.setup_error": {
        set({
          worktreeStatus: "setup_error",
          worktreeError: (payload.error ?? payload.message ?? "") as string,
        });
        break;
      }
      case "completed": {
        set({ workflowStatus: "completed" });
        break;
      }
      case "error": {
        set({
          workflowStatus: "error",
          error: payload.message as string,
          startingBuild: false,
          continuingBuild: false,
          startingSession: false,
        });
        break;
      }
    }
  };
}

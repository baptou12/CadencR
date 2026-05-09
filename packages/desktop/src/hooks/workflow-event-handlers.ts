/** WS event handler for workflow-domain messages. Agent helpers live in agent-event-handlers.ts. */

import { handleWorkflowCrossDomainEvent } from "@/hooks/workflow-cross-domain-events";
import { handleWorkflowWorktreeEvent } from "@/hooks/workflow-worktree-events";
import {
  type WorkflowState,
  type WorkflowStatus,
  type QueueItemStatus,
  parseAgentSlot,
  agentSlotKey,
  PLAN_KEY,
  PRD_KEY,
  SESSION_PLACEHOLDER_KEY,
} from "@/types/workflow";
import {
  type SetFn,
  createAgentSession,
  resolveSlotKey,
  patchAgent,
  processAgentStream,
  insertAgentSession,
  handleAgentStream,
  handleAgentPaused,
  handleAgentRunning,
  handleAgentSessionId,
  handleAgentUserMessage,
  handleUsageUpdate,
  handlePermissionRequest,
  handlePendingCleared,
} from "@/hooks/agent-event-handlers";
import { parsePermissionMode } from "@/types/permission-mode";

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
    const ref = typeof data.ref === "string" ? data.ref : undefined;
    const payload = (data.payload ?? {}) as Record<string, unknown>;

    if (handleWorkflowCrossDomainEvent(domain, action, ref, payload, set, get)) return;

    if (domain !== "workflow") return;

    switch (action) {
      case "queue_update": {
        const items = payload.items as QueueItemStatus[];
        const updates: Record<string, unknown> = { queue: items ?? [] };
        if (payload.workflow_status) {
          updates.workflowStatus = payload.workflow_status as string;
        }
        // First post-reconnect queue_update clears the refresh indicator.
        if (get().isReconnecting) updates.isReconnecting = false;
        set(updates);
        break;
      }
      case "item_update": {
        const id = payload.id as number;
        set((state) => ({
          queue: state.queue.map((q) =>
            q.id === id
              ? {
                  ...q,
                  status: (payload.status as QueueItemStatus) ?? q.status,
                  result: (payload.result as string | null) ?? q.result,
                  agent_session_id:
                    (payload.agent_session_id as number | null) ?? q.agent_session_id,
                }
              : q,
          ),
        }));
        break;
      }
      case "item_iterating": {
        const itemId = payload.queue_item_id as number;
        const iterCount = payload.iteration_count as number;
        set((state) => ({
          queue: state.queue.map((q) =>
            q.id === itemId ? { ...q, iteration_count: iterCount } : q,
          ),
        }));
        break;
      }
      case "item_started": {
        const slot = parseAgentSlot(payload);
        const key = agentSlotKey(slot);
        const sessionId = payload.session_id as number;
        set((state) => {
          const itemId = slot.type === "queue_item" ? slot.id : null;
          const queue =
            itemId != null
              ? state.queue.map((q) =>
                  q.id === itemId
                    ? { ...q, status: "running" as const, agent_session_id: sessionId }
                    : q,
                )
              : state.queue;
          const agents = new Map(state.agents);
          const existing = agents.get(key);
          const itemType = (payload.item_type as string) ?? "execute";
          const session = {
            ...createAgentSession(sessionId, itemType),
            blocks: existing?.blocks ?? [],
          };
          agents.set(key, session);
          return {
            queue,
            agents,
            selectedItemId: state.selectedItemId ?? itemId,
            startingSession: false,
          };
        });
        break;
      }
      case "item_completed": {
        const slot = parseAgentSlot(payload);
        set((state) => {
          const key = resolveSlotKey(state.agents, slot);
          const itemId = slot.type === "queue_item" ? slot.id : null;
          const queue =
            itemId != null
              ? state.queue.map((q) =>
                  q.id === itemId ? { ...q, status: "completed" as const } : q,
                )
              : state.queue;
          return { queue, ...patchAgent(state, key, { status: "completed" }) };
        });
        break;
      }
      case "item_error": {
        const slot = parseAgentSlot(payload);
        const error = payload.error as string;
        set((state) => {
          const key = resolveSlotKey(state.agents, slot);
          const itemId = slot.type === "queue_item" ? slot.id : null;
          const queue =
            itemId != null
              ? state.queue.map((q) =>
                  q.id === itemId ? { ...q, status: "error" as const, result: error } : q,
                )
              : state.queue;
          return { queue, error, ...patchAgent(state, key, { status: "error" }) };
        });
        break;
      }
      case "item_retrying": {
        const itemId = payload.queue_item_id as number;
        const retryCount = payload.retry_count as number;
        const maxRetries = payload.max_retries as number;
        set((state) => ({
          queue: state.queue.map((q) =>
            q.id === itemId
              ? { ...q, status: "ready" as const, retry_count: retryCount, max_retries: maxRetries }
              : q,
          ),
        }));
        break;
      }
      case "interrupted": {
        const slot = parseAgentSlot(payload);
        set((state) => {
          const key = resolveSlotKey(state.agents, slot);
          const agentPatch = patchAgent(state, key, { status: "paused" });
          if (slot.type === "queue_item") {
            const queue = state.queue.map((q) =>
              q.id === slot.id ? { ...q, status: "paused" as const } : q,
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
        const status =
          (payload.status as WorkflowStatus) ?? (payload.workflow_status as WorkflowStatus);
        if (status) {
          const previousStatus =
            (payload.previous_status as WorkflowStatus) ?? get().workflowStatus;
          const updates: Partial<WorkflowState> = { workflowStatus: status };

          if (previousStatus === "plan_approval" && status !== "plan_approval") {
            const planAgent = get().agents.get(PLAN_KEY);
            if (planAgent) {
              const agents = new Map(get().agents);
              agents.set(PLAN_KEY, {
                ...planAgent,
                status: "running" as const,
                pendingPlanApproval: null,
              });
              updates.agents = agents;
            }
          }

          if (previousStatus === "prd" && status === "planning") {
            const prdAgent = get().agents.get(PRD_KEY);
            if (prdAgent && prdAgent.status === "paused") {
              const agents = updates.agents ? updates.agents : new Map(get().agents);
              agents.set(PRD_KEY, {
                ...prdAgent,
                status: "running" as const,
                pendingPlanApproval: null,
              });
              updates.agents = agents;
            }
          }

          if (
            status === "building" ||
            status === "paused" ||
            status === "error" ||
            status === "completed"
          ) {
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
        const key = action === "plan_agent_stream" ? PLAN_KEY : PRD_KEY;
        const msg = payload.message as Record<string, unknown>;
        if (!msg) break;
        set((state) => {
          const agent = state.agents.get(key) ?? createAgentSession(0);
          const agents = new Map(state.agents);
          agents.set(key, processAgentStream(agent, msg));
          return { agents };
        });
        break;
      }
      case "plan_ready": {
        set((state) => {
          const planAgent = state.agents.get(PLAN_KEY);
          if (!planAgent) return { workflowStatus: "plan_approval" as const };
          const agents = new Map(state.agents);
          agents.set(PLAN_KEY, { ...planAgent, status: "paused" as const });
          return { workflowStatus: "plan_approval" as const, agents };
        });
        break;
      }
      case "plan_content":
      case "prd_content": {
        const content = payload.content as string;
        if (!content) break;
        const isPlan = action === "plan_content";
        const key = isPlan ? PLAN_KEY : PRD_KEY;
        const toolName = isPlan ? "__show_plan" : "__show_prd";
        const prefix = isPlan ? "plan" : "prd";
        set((state) => {
          const agent = state.agents.get(key) ?? createAgentSession(0);
          const block = {
            id: `ws-${prefix}-${Date.now()}`,
            type: "tool_call" as const,
            content: "",
            toolName,
            toolArgs: JSON.stringify({ plan: content }),
            createdAt: new Date().toISOString(),
          };
          const agents = new Map(state.agents);
          agents.set(key, { ...agent, blocks: [...agent.blocks, block] });
          return { agents };
        });
        break;
      }
      case "prd_ready": {
        set((state) => {
          const prdAgent = state.agents.get(PRD_KEY);
          if (!prdAgent) return {};
          const agents = new Map(state.agents);
          agents.set(PRD_KEY, { ...prdAgent, status: "paused" as const });
          return { agents };
        });
        break;
      }
      case "session.started": {
        const startedSessionId = payload.session_id as number;
        const targetKey = `session:${startedSessionId}`;
        const permissionMode = parsePermissionMode(payload.permission_mode);
        const runtimeProvider =
          typeof payload.runtime_provider === "string" ? payload.runtime_provider : null;
        const model = typeof payload.model === "string" ? payload.model : null;
        set((state) => {
          const agents = new Map(state.agents);
          const placeholder = agents.get(SESSION_PLACEHOLDER_KEY);
          if (placeholder) agents.delete(SESSION_PLACEHOLDER_KEY);
          const existing = agents.get(targetKey);
          const session = {
            ...(existing ?? createAgentSession(startedSessionId, "session")),
            sessionId: startedSessionId,
            blocks: [...(placeholder?.blocks ?? []), ...(existing?.blocks ?? [])],
            ...(permissionMode ? { permissionMode } : {}),
            ...(runtimeProvider ? { runtimeProvider } : {}),
            ...(model ? { model } : {}),
          };
          agents.set(targetKey, session);
          return { agents, startingSession: false };
        });
        break;
      }
      case "mode.changed": {
        const slot = parseAgentSlot(payload);
        const mode = parsePermissionMode(payload.mode);
        if (!mode) break;
        set((state) => {
          const key = resolveSlotKey(state.agents, slot);
          return patchAgent(state, key, { permissionMode: mode });
        });
        break;
      }
      case "refine.started": {
        // Refine streams via plan agent state; no separate entry needed
        break;
      }
      case "risk.started":
      case "retro.started": {
        const agentType = action === "risk.started" ? "risk" : "retro";
        const sessionId = payload.session_id as number;
        const key = `${agentType}:${sessionId}`;
        set((state) => insertAgentSession(state, key, sessionId, agentType));
        break;
      }
      case "agent_paused":
        handleAgentPaused(payload, set);
        break;
      case "agent_running":
        handleAgentRunning(payload, set);
        break;
      case "agent_session_id":
        handleAgentSessionId(payload, set);
        break;
      case "agent_user_message":
        handleAgentUserMessage(payload, set);
        break;
      case "agent_stream":
        handleAgentStream(payload, set);
        break;
      case "usage_update":
        handleUsageUpdate(payload, set);
        break;
      case "permission.request":
        handlePermissionRequest(payload, set);
        break;
      case "pending_cleared":
        handlePendingCleared(payload, set);
        break;
      case "review_verdict":
        break;
      case "review_fixer.started": {
        const sessionId = payload.session_id as number;
        const key = `review-fixer:${sessionId}`;
        set((state) => insertAgentSession(state, key, sessionId, "review-fixer"));
        break;
      }
      case "worktree.creating":
      case "worktree.created":
      case "worktree.setup_running":
      case "worktree.setup_output":
      case "worktree.ready":
      case "worktree.setup_error":
        handleWorkflowWorktreeEvent(action, payload, set, get);
        break;
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

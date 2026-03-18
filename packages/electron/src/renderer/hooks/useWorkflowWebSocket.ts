/**
 * Zustand store for workflow-specific WebSocket state.
 *
 * Manages the queue, active agent sessions, and workflow lifecycle.
 * Reuses processSdkMessage / applyMutations from ws-session-store for
 * all SDK message parsing — no duplication.
 */

import { create } from "zustand";
import type { AgentBlockData } from "@/components/AgentBlock";
import type { AgentStatus } from "@/types/agent";
import type { PendingPermission } from "@/components/ToolPermissionPrompt";
import {
  type StreamingState,
  createStreamingState,
  processSdkMessage,
  applyMutations,
} from "@/stores/ws-session-store";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type WorkflowStatus =
  | "idle"
  | "planning"
  | "prd"
  | "plan_approval"
  | "building"
  | "paused"
  | "completed"
  | "error";

export type QueueItemStatus =
  | "pending"
  | "blocked"
  | "ready"
  | "running"
  | "paused"
  | "completed"
  | "error"
  | "skipped";

export interface QueueItem {
  id: number;
  item_type: string;
  phase_id: number | null;
  phase_title: string | null;
  status: QueueItemStatus;
  order_index: number;
  group_index: number | null;
  agent_session_id: number | null;
  result: string | null;
}

export interface AgentSessionState {
  sessionId: number;
  blocks: AgentBlockData[];
  streamingState: StreamingState;
  status: AgentStatus;
  pendingPermission: PendingPermission | null;
}

export type AutonomyLevel = 1 | 2 | 3;

interface WorkflowState {
  // Connection
  ws: WebSocket | null;
  featureId: number | null;
  projectId: number | null;

  // Workflow state
  queue: QueueItem[];
  activeAgents: Map<number, AgentSessionState>; // queue_item_id → session state
  planAgent: AgentSessionState | null;
  prdAgent: AgentSessionState | null;
  workflowStatus: WorkflowStatus;
  pauseReason: string | null;
  autonomyLevel: AutonomyLevel;
  selectedItemId: number | null;
  error: string | null;

  // Actions
  connect: (featureId: number, projectId: number) => void;
  disconnect: () => void;
  selectItem: (itemId: number | null) => void;
  setAutonomyLevel: (level: AutonomyLevel) => void;

  // Outgoing messages
  startPlan: (description: string, images?: Array<{ base64: string; mimeType: string }>) => void;
  startPrd: (description: string, images?: Array<{ base64: string; mimeType: string }>) => void;
  approvePlan: (requestId?: string) => void;
  rejectPlan: (feedback: string, requestId?: string) => void;
  startBuild: () => void;
  continueWorkflow: () => void;
  skipItem: (itemId: number) => void;
  retryItem: (itemId: number) => void;
  respondToPermission: (itemId: number, requestId: string, decision: "allow_once" | "allow_future" | "deny") => void;
  sendPromptToAgent: (itemId: number, text: string, images?: Array<{ base64: string; mimeType: string }>) => void;
  interruptItem: (itemId: number) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getWsUrl(): string {
  const httpUrl = window.api?.rustBackendUrl;
  if (httpUrl) {
    return httpUrl.replace(/^http/, "ws") + "/ws";
  }
  return "ws://localhost:5005/ws";
}

function createAgentSession(sessionId: number): AgentSessionState {
  return {
    sessionId,
    blocks: [],
    streamingState: createStreamingState(),
    status: "running",
    pendingPermission: null,
  };
}

function processAgentStream(
  agent: AgentSessionState,
  msg: Record<string, unknown>,
): AgentSessionState {
  const mutations = processSdkMessage(msg, agent.streamingState);
  if (mutations.length === 0) return agent;
  const blocks = applyMutations(agent.blocks, mutations, agent.streamingState);
  return { ...agent, blocks };
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useWorkflowStore = create<WorkflowState>((set, get) => {
  function send(action: string, payload: Record<string, unknown> = {}) {
    const { ws, featureId } = get();
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        domain: "workflow",
        action,
        payload: { feature_id: featureId, ...payload },
      }));
    }
  }

  function handleMessage(event: MessageEvent) {
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(event.data as string);
    } catch {
      return;
    }

    const domain = data.domain as string;
    const action = data.action as string;
    const payload = (data.payload ?? {}) as Record<string, unknown>;

    if (domain !== "workflow") return;

    switch (action) {
      case "queue_update": {
        const items = payload.items as QueueItem[];
        set({ queue: items ?? [] });
        break;
      }
      case "item_update": {
        // Differential update: patch a single item in the queue by id
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
        const itemId = payload.queue_item_id as number;
        const sessionId = payload.session_id as number;
        set(state => {
          const queue = state.queue.map(q =>
            q.id === itemId ? { ...q, status: "running" as const, agent_session_id: sessionId } : q,
          );
          const activeAgents = new Map(state.activeAgents);
          activeAgents.set(itemId, createAgentSession(sessionId));
          return { queue, activeAgents, selectedItemId: state.selectedItemId ?? itemId };
        });
        break;
      }
      case "item_completed": {
        const itemId = payload.queue_item_id as number;
        set(state => {
          const queue = state.queue.map(q =>
            q.id === itemId ? { ...q, status: "completed" as const } : q,
          );
          const agent = state.activeAgents.get(itemId);
          if (!agent) return { queue };
          const activeAgents = new Map(state.activeAgents);
          activeAgents.set(itemId, { ...agent, status: "completed" });
          return { queue, activeAgents };
        });
        break;
      }
      case "item_error": {
        const itemId = payload.queue_item_id as number;
        const error = payload.error as string;
        set(state => {
          const queue = state.queue.map(q =>
            q.id === itemId ? { ...q, status: "error" as const, result: error } : q,
          );
          const agent = state.activeAgents.get(itemId);
          if (!agent) return { queue, error };
          const activeAgents = new Map(state.activeAgents);
          activeAgents.set(itemId, { ...agent, status: "error" });
          return { queue, activeAgents, error };
        });
        break;
      }
      case "paused": {
        const reason = payload.reason as string;
        set({ workflowStatus: "paused", pauseReason: reason });
        break;
      }
      case "status_update": {
        const status = payload.status as WorkflowStatus;
        set({ workflowStatus: status });
        break;
      }
      case "plan_agent_stream":
      case "prd_agent_stream": {
        const key = action === "plan_agent_stream" ? "planAgent" : "prdAgent";
        const msg = payload.message as Record<string, unknown>;
        if (!msg) break;
        set(state => {
          const agent = state[key] ?? createAgentSession(0);
          return { [key]: processAgentStream(agent, msg) };
        });
        break;
      }
      case "plan_ready": {
        set(state => ({
          workflowStatus: "plan_approval",
          planAgent: state.planAgent ? { ...state.planAgent, status: "completed" as const } : state.planAgent,
        }));
        break;
      }
      case "prd_ready": {
        set(state => ({
          prdAgent: state.prdAgent ? { ...state.prdAgent, status: "completed" as const } : state.prdAgent,
        }));
        break;
      }
      case "agent_stream": {
        const itemId = payload.queue_item_id as number;
        const msg = payload.message as Record<string, unknown>;
        if (!msg) break;
        set(state => {
          const agent = state.activeAgents.get(itemId);
          if (!agent) return state;
          const updated = processAgentStream(agent, msg);
          if (updated === agent) return state;
          const activeAgents = new Map(state.activeAgents);
          activeAgents.set(itemId, updated);
          return { activeAgents };
        });
        break;
      }
      case "permission.request": {
        const itemId = payload.queue_item_id as number;
        const permission: PendingPermission = {
          toolName: payload.tool_name as string,
          input: (payload.tool_input ?? payload.input ?? {}) as Record<string, unknown>,
          description: (payload.description ?? "") as string,
          pattern: (payload.pattern ?? "") as string,
          requestId: (payload.request_id ?? "") as string,
        };
        set(state => {
          // Handle plan/PRD agent permissions (synthetic IDs)
          if (itemId === -1 && state.planAgent) {
            return { planAgent: { ...state.planAgent, pendingPermission: permission } };
          }
          if (itemId === -2 && state.prdAgent) {
            return { prdAgent: { ...state.prdAgent, pendingPermission: permission } };
          }
          // Queue agent permissions
          const activeAgents = new Map(state.activeAgents);
          const agent = activeAgents.get(itemId);
          if (!agent) return {};
          activeAgents.set(itemId, { ...agent, pendingPermission: permission });
          return { activeAgents };
        });
        break;
      }
      case "completed": {
        set({ workflowStatus: "completed" });
        break;
      }
      case "error": {
        set({ workflowStatus: "error", error: payload.message as string });
        break;
      }
    }
  }

  return {
    // Initial state
    ws: null,
    featureId: null,
    projectId: null,
    queue: [],
    activeAgents: new Map(),
    planAgent: null,
    prdAgent: null,
    workflowStatus: "idle",
    pauseReason: null,
    autonomyLevel: 3,
    selectedItemId: null,
    error: null,

    connect(featureId, projectId) {
      const prev = get().ws;
      if (prev) prev.close();

      const ws = new WebSocket(getWsUrl());
      set({
        ws, featureId, projectId,
        queue: [], activeAgents: new Map(), planAgent: null, prdAgent: null,
        workflowStatus: "idle", pauseReason: null, selectedItemId: null, error: null,
      });

      ws.addEventListener("open", () => {
        ws.send(JSON.stringify({
          domain: "workflow",
          action: "feature.start",
          payload: { feature_id: featureId, project_id: projectId },
        }));
      });
      ws.addEventListener("message", handleMessage);
      ws.addEventListener("close", () => {
        if (get().ws === ws) set({ ws: null });
      });
    },

    disconnect() {
      const { ws } = get();
      if (ws) ws.close();
      set({ ws: null });
    },

    selectItem(itemId) {
      set({ selectedItemId: itemId });
    },

    setAutonomyLevel(level) {
      set({ autonomyLevel: level });
      send("set_autonomy", { level });
    },

    startPlan(description, images) {
      set({ workflowStatus: "planning", planAgent: createAgentSession(0) });
      send("start_plan", { description, images });
    },

    startPrd(description, images) {
      set({ workflowStatus: "prd", prdAgent: createAgentSession(0) });
      send("start_prd", { description, images });
    },

    approvePlan(requestId) {
      send("plan.approved", { request_id: requestId });
      set({ workflowStatus: "building" });
    },

    rejectPlan(feedback, requestId) {
      send("plan.rejected", { feedback, request_id: requestId });
      set({ workflowStatus: "planning" });
    },

    startBuild() {
      send("start_build", {});
      set({ workflowStatus: "building" });
    },

    continueWorkflow() {
      send("continue", {});
      set({ workflowStatus: "building", pauseReason: null });
    },

    skipItem(itemId) {
      send("skip_item", { item_id: itemId });
      set(state => ({
        queue: state.queue.map(q => q.id === itemId ? { ...q, status: "skipped" as const } : q),
      }));
    },

    retryItem(itemId) {
      send("retry_item", { item_id: itemId });
    },

    respondToPermission(itemId, requestId, decision) {
      send("permission.respond", { queue_item_id: itemId, request_id: requestId, decision });
      set(state => {
        const activeAgents = new Map(state.activeAgents);
        const agent = activeAgents.get(itemId);
        if (agent) activeAgents.set(itemId, { ...agent, pendingPermission: null });
        return { activeAgents };
      });
    },

    sendPromptToAgent(itemId, text, images) {
      send("prompt.send", { queue_item_id: itemId, text, images });
    },

    interruptItem(itemId) {
      send("interrupt", { queue_item_id: itemId });
    },
  };
});

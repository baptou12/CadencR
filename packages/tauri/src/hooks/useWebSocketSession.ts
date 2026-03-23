/**
 * WebSocket session hook — thin wrapper over the Zustand ws-session-store.
 *
 * The store owns WebSocket connections and all per-session state so that
 * navigating away and back does NOT create a new connection.
 */

import { useEffect } from "react";
import { DEFAULT_MODEL } from "../shared/models";
import type { AgentBlockData } from "@/components/AgentBlock";
import type { AgentBlock } from "@/api/generated";
import { useGetFeatureAgentState } from "@/api/generated";
import {
  useWsSessionStore,
  type PermissionMode,
  type PendingPlanApproval,
} from "@/stores/ws-session-store";
import type { AgentStatus } from "@/types/agent";
import type { PendingPermission } from "@/components/ToolPermissionPrompt";
import type { AgentQuestion } from "@/components/AgentQuestionDrawer";
import type { SessionConfig } from "@/lib/ws-envelope";
import type { ContextUsageState } from "@/types/agent";

export type { PermissionMode, PendingPlanApproval };

export interface UseWebSocketSessionReturn {
  blocks: AgentBlockData[];
  status: AgentStatus;
  isConnected: boolean;
  sessionId: string;
  pendingPermission: PendingPermission | null;
  pendingRequestId: string;
  pendingQuestions: AgentQuestion[];
  respondToQuestion: (response: string) => void;

  permissionMode: PermissionMode;
  setPermissionMode: (mode: PermissionMode) => void;
  pendingPlanApproval: PendingPlanApproval | null;
  approvePlan: () => void;
  requestPlanChanges: (feedback: string) => void;

  contextUsage: ContextUsageState | null;
  currentModelId: string;
  claudeSessionId: string;
  hasFileChanges: boolean;
  setModel: (modelId: string) => void;
  sendPrompt: (text: string, images?: Array<{ base64: string; mimeType: string }>) => void;
  respondToPermission: (requestId: string, granted: boolean) => void;
  interrupt: () => void;
  destroy: () => void;
  initSession: (config: SessionConfig) => void;
}

// ---------------------------------------------------------------------------
// Convert server AgentBlock[] to AgentBlockData[]
// ---------------------------------------------------------------------------

function serverBlocksToAgentBlocks(blocks: AgentBlock[]): AgentBlockData[] {
  return blocks.map((b) => ({
    id: b.id,
    type: b.type as AgentBlockData["type"],
    content: b.content,
    toolName: b.toolName,
    toolArgs: b.toolArgs,
    isError: b.isError,
    toolUseId: b.toolUseId,
    parentToolUseId: b.parentToolUseId,
    childBlocks: b.childBlocks ? serverBlocksToAgentBlocks(b.childBlocks) : undefined,
    sourceToolName: b.sourceToolName,
    createdAt: b.createdAt,
    model: b.model,
  }));
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useWebSocketSession(sessionId: string, featureId?: number): UseWebSocketSessionReturn {
  const store = useWsSessionStore();
  const session = store.sessions[sessionId];

  // Connect on mount — no-op if already connected
  useEffect(() => {
    store.connect(sessionId);
    // Intentionally NOT disconnecting on unmount — connections are cached.
  }, [sessionId, store]);

  // Load persisted state from DB when featureId is provided.
  const persistedLoaded = session?.persistedLoaded ?? false;
  const agentStateQuery = useGetFeatureAgentState(featureId ?? 0, undefined, {
    enabled: !!featureId && !persistedLoaded,
    cacheTime: 0,
  });

  useEffect(() => {
    if (persistedLoaded || !featureId || !agentStateQuery.data) return;
    const sessions = agentStateQuery.data.sessions;
    if (sessions.length === 0) {
      store.markPersistedLoaded(sessionId);
      return;
    }

    const lastSession = sessions[sessions.length - 1];
    const restoredBlocks = serverBlocksToAgentBlocks(lastSession.blocks);

    const s = lastSession.status;
    const restoredStatus: AgentStatus =
      s === "paused" || s === "completed" || s === "error" ? s : "idle";

    store.setPersistedState(sessionId, restoredBlocks, restoredStatus);
  }, [featureId, agentStateQuery.data, persistedLoaded, sessionId, store]);

  return {
    blocks: session?.blocks ?? [],
    status: session?.status ?? "idle",
    isConnected: session?.isConnected ?? false,
    sessionId,
    pendingPermission: session?.pendingPermission ?? null,
    pendingRequestId: session?.pendingRequestId ?? "",
    pendingQuestions: session?.pendingQuestions ?? [],
    permissionMode: session?.permissionMode ?? "acceptEdits",
    pendingPlanApproval: session?.pendingPlanApproval ?? null,
    contextUsage: session?.contextUsage ?? null,
    currentModelId: session?.currentModelId ?? DEFAULT_MODEL,
    claudeSessionId: session?.claudeSessionId ?? "",
    hasFileChanges: session?.hasFileChanges ?? false,

    sendPrompt: (text: string, images?: Array<{ base64: string; mimeType: string }>) => store.sendPrompt(sessionId, text, images),
    respondToPermission: (requestId: string, granted: boolean) => store.respondToPermission(sessionId, requestId, granted),
    respondToQuestion: (response: string) => store.respondToQuestion(sessionId, response),
    interrupt: () => store.interrupt(sessionId),
    destroy: () => store.destroy(sessionId),
    initSession: (config: SessionConfig) => store.initSession(sessionId, config),
    setModel: (modelId: string) => store.setModel(sessionId, modelId),
    setPermissionMode: (mode: PermissionMode) => store.setPermissionMode(sessionId, mode),
    approvePlan: () => store.approvePlan(sessionId),
    requestPlanChanges: (feedback: string) => store.requestPlanChanges(sessionId, feedback),
  };
}

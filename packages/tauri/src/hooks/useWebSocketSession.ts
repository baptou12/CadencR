/**
 * WebSocket session hook — thin wrapper over the Zustand ws-session-store.
 *
 * The store owns WebSocket connections and all per-session state so that
 * navigating away and back does NOT create a new connection.
 */

import { useEffect } from "react";
import { DEFAULT_PROVIDER, FALLBACK_MODEL_ID } from "../shared/models";
import type { AgentBlockData } from "@/components/AgentBlock";
import { useGetFeatureAgentState } from "@/api/generated";
import { serverBlocksToAgentBlocks } from "@/hooks/useFeatureAgentState";
import {
  useWsSessionStore,
  type PermissionMode,
  type PendingPlanApproval,
} from "@/stores/ws-session-store";
import type { PendingPermission } from "@/components/ToolPermissionPrompt";
import type { PermissionDecisionValue } from "@/components/ToolPermissionPrompt";
import type { AgentQuestion, AgentQuestionAnswers } from "@/components/AgentQuestionDrawer";
import type { SessionConfig } from "@/lib/ws-envelope";
import { normalizeContextWindow, type ContextUsageState } from "@/types/agent";
import type { AgentStatus } from "@/types/agent";
import {
  type TurnLifecycle,
  createIdleTurnLifecycle,
  lifecycleToStatus,
  persistedStatusToLifecycle,
} from "@/stores/ws-turn-lifecycle";

interface UseWebSocketSessionReturn {
  blocks: AgentBlockData[];
  lifecycle: TurnLifecycle;
  status: AgentStatus;
  isConnected: boolean;
  sessionId: string;
  pendingPermission: PendingPermission | null;
  pendingRequestId: string;
  pendingQuestions: AgentQuestion[];
  respondToQuestion: (response: AgentQuestionAnswers) => void;
  hasMore: boolean;
  loadOlderMessages: () => Promise<void>;

  permissionMode: PermissionMode;
  setPermissionMode: (mode: PermissionMode) => void;
  pendingPlanApproval: PendingPlanApproval | null;
  approvePlan: () => void;
  requestPlanChanges: (feedback: string) => void;

  contextUsage: ContextUsageState | null;
  currentProviderId: string;
  currentModelId: string;
  currentThinkingEffort?: string;
  runtimeProvider: string;
  runtimeSessionId: string;
  hasFileChanges: boolean;
  setModel: (modelId: string) => void;
  setThinkingEffort: (thinkingEffort?: string) => void;
  setProvider: (providerId: string) => void;
  sendPrompt: (
    text: string,
    images?: Array<{ base64: string; mimeType: string }>,
    useWorktree?: boolean,
  ) => void;
  respondToPermission: (
    requestId: string,
    decision: PermissionDecisionValue,
    feedback?: string,
  ) => void;
  interrupt: () => void;
  destroy: () => void;
  clearSession: () => void;
  compactSession: () => void;
  initSession: (config: SessionConfig) => void;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useWebSocketSession(
  sessionId: string,
  featureId?: number,
): UseWebSocketSessionReturn {
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
    query: {
      enabled: !!featureId && !persistedLoaded,
      cacheTime: 0,
    },
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

    const restoredLifecycle = persistedStatusToLifecycle(
      lastSession.status as AgentStatus,
      lastSession.pendingPlanApproval,
    );

    const persistedContextUsage: ContextUsageState | null =
      lastSession.inputTokens > 0 ||
      lastSession.outputTokens > 0 ||
      normalizeContextWindow(lastSession.contextWindow) != null
        ? {
            inputTokens: lastSession.inputTokens ?? 0,
            outputTokens: lastSession.outputTokens ?? 0,
            contextWindow: normalizeContextWindow(lastSession.contextWindow),
            wasCompacted: lastSession.wasCompacted ?? false,
          }
        : null;
    store.setPersistedState(sessionId, {
      blocks: restoredBlocks,
      lifecycle: restoredLifecycle,
      hasMore: lastSession.hasMore,
      oldestMessageId: lastSession.oldestMessageId,
      featureId,
      sessionDbId: lastSession.sessionDbId,
      currentProviderId: lastSession.runtimeProvider ?? undefined,
      currentModelId: lastSession.model ?? undefined,
      runtimeProvider: lastSession.runtimeProvider ?? undefined,
      runtimeSessionId: lastSession.runtimeSessionId ?? undefined,
      pendingPlanApproval: lastSession.pendingPlanApproval as PendingPlanApproval | null,
      contextUsage: persistedContextUsage,
      hasFileChanges: lastSession.hasFileChanges,
    });
  }, [featureId, agentStateQuery.data, persistedLoaded, sessionId, store]);

  return {
    blocks: session?.blocks ?? [],
    lifecycle: session?.lifecycle ?? createIdleTurnLifecycle(),
    status: lifecycleToStatus(session?.lifecycle ?? createIdleTurnLifecycle()),
    isConnected: session?.isConnected ?? false,
    sessionId,
    hasMore: session?.hasMore ?? false,
    loadOlderMessages: () => store.loadOlderMessages(sessionId),
    pendingPermission: session?.pendingPermission ?? null,
    pendingRequestId: session?.pendingRequestId ?? "",
    pendingQuestions: session?.pendingQuestions ?? [],
    permissionMode: session?.permissionMode ?? "acceptEdits",
    pendingPlanApproval: session?.pendingPlanApproval ?? null,
    contextUsage: session?.contextUsage ?? null,
    currentProviderId: session?.currentProviderId ?? DEFAULT_PROVIDER,
    currentModelId: session?.currentModelId ?? FALLBACK_MODEL_ID,
    currentThinkingEffort: session?.currentThinkingEffort,
    runtimeProvider: session?.runtimeProvider ?? DEFAULT_PROVIDER,
    runtimeSessionId: session?.runtimeSessionId ?? "",
    hasFileChanges: session?.hasFileChanges ?? false,

    sendPrompt: (
      text: string,
      images?: Array<{ base64: string; mimeType: string }>,
      useWorktree?: boolean,
    ) => store.sendPrompt(sessionId, text, images, useWorktree),
    respondToPermission: (
      requestId: string,
      decision: PermissionDecisionValue,
      feedback?: string,
    ) => {
      store.respondToPermission(sessionId, requestId, decision, feedback);
    },
    respondToQuestion: (response: AgentQuestionAnswers) =>
      store.respondToQuestion(sessionId, response),
    interrupt: () => store.interrupt(sessionId),
    destroy: () => store.destroy(sessionId),
    clearSession: () => store.clearSession(sessionId),
    compactSession: () => store.compactSession(sessionId),
    initSession: (config: SessionConfig) => store.initSession(sessionId, config),
    setProvider: (providerId: string) => store.setProvider(sessionId, providerId),
    setModel: (modelId: string) => store.setModel(sessionId, modelId),
    setThinkingEffort: (thinkingEffort?: string) =>
      store.setThinkingEffort(sessionId, thinkingEffort),
    setPermissionMode: (mode: PermissionMode) => store.setPermissionMode(sessionId, mode),
    approvePlan: () => store.approvePlan(sessionId),
    requestPlanChanges: (feedback: string) => store.requestPlanChanges(sessionId, feedback),
  };
}

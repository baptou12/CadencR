/**
 * WebSocket session hook — thin wrapper over the Zustand ws-session-store.
 *
 * The store owns WebSocket connections and all per-session state so that
 * navigating away and back does NOT create a new connection.
 */

import { useEffect, useMemo } from "react";
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
import type { LiveAgentStatus } from "@/types/agent";
import {
  type TurnLifecycle,
  createIdleTurnLifecycle,
  persistedStatusToLifecycle,
} from "@/stores/ws-turn-lifecycle";
import { useSessionStatusStore } from "@/stores/session-status-store";
import { liveStatusFromLifecycle } from "@/lib/agent-status";

export interface UseWebSocketSessionReturn {
  blocks: AgentBlockData[];
  /** Pre-filtered subset of `blocks` excluding subagent children, maintained
   *  incrementally by the store so AgentStream avoids re-deriving it on
   *  every chunk. */
  rootBlocks: AgentBlockData[];
  /** Map from a tool_call's `toolUseId` to its `tool_result` block, also
   *  maintained incrementally by the store. */
  toolResultMap: Map<string, AgentBlockData>;
  /** Rendered Virtuoso row count prepended by older-history pagination. */
  historyPrependDisplayOffset: number;
  lifecycle: TurnLifecycle;
  status: LiveAgentStatus;
  isConnected: boolean;
  sessionId: string;
  pendingPermission: PendingPermission | null;
  pendingRequestId: string;
  /**
   * True while a decision for the currently visible permission request is in
   * flight to the backend (between click and ack). Used to show a loader and
   * disable buttons in `ToolPermissionPrompt`.
   */
  isSubmittingPermission: boolean;
  pendingQuestions: AgentQuestion[];
  respondToQuestion: (response: AgentQuestionAnswers) => void;
  hasMore: boolean;
  /** Resolves with the number of older blocks that were prepended. */
  loadOlderMessages: () => Promise<number>;

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
    optionId?: string,
  ) => void;
  interrupt: () => void;
  destroy: () => void;
  clearSession: () => void;
  compactSession: () => void;
  initSession: (config: SessionConfig) => void;
}

interface UseWebSocketSessionOptions {
  loadPersisted?: boolean;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useWebSocketSession(
  sessionId: string,
  featureId?: number,
  options?: UseWebSocketSessionOptions,
): UseWebSocketSessionReturn {
  // Subscribe to this session's slice only — chunks on other sessions don't
  // re-render the hook.
  const session = useWsSessionStore((s) => s.sessions[sessionId]);

  // Backend-driven status (the single source of truth — see
  // `domain::session_status` on the Rust side and `session-status-store`
  // on the frontend). Keyed by the DB session id, which the WS handler
  // populates on `session.connected` / persistedLoaded.
  const sessionDbId = session?.sessionDbId ?? null;
  const liveStatus = useSessionStatusStore((s) =>
    sessionDbId == null ? null : (s.bySession[sessionDbId]?.status ?? null),
  );

  useEffect(() => {
    useWsSessionStore.getState().connect(sessionId);
    // Connections are cached; no disconnect on unmount.
  }, [sessionId]);

  // Load persisted state from DB when featureId is provided.
  const loadPersisted = options?.loadPersisted ?? true;
  const persistedLoaded = session?.persistedLoaded ?? false;
  const agentStateQuery = useGetFeatureAgentState(featureId ?? 0, undefined, {
    query: {
      enabled: loadPersisted && !!featureId && !persistedLoaded,
      cacheTime: 0,
    },
  });

  useEffect(() => {
    if (persistedLoaded || !featureId || !agentStateQuery.data) return;
    const store = useWsSessionStore.getState();
    const sessions = agentStateQuery.data.sessions;
    if (sessions.length === 0) {
      store.markPersistedLoaded(sessionId);
      return;
    }

    const lastSession = sessions[sessions.length - 1];
    const restoredBlocks = serverBlocksToAgentBlocks(lastSession.blocks);

    const restoredLifecycle = persistedStatusToLifecycle(lastSession.status);

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
      pendingPermission: lastSession.pendingPermission,
      pendingQuestions: lastSession.pendingQuestions,
      contextUsage: persistedContextUsage,
      hasFileChanges: lastSession.hasFileChanges,
    });
  }, [featureId, agentStateQuery.data, persistedLoaded, sessionId]);

  // Action wrappers depend only on sessionId — stable across same-session
  // chunks so consumers can list `ws.sendPrompt` etc. in deps without churn.
  const actions = useMemo(() => {
    const s = useWsSessionStore.getState();
    return {
      loadOlderMessages: (): Promise<number> => s.loadOlderMessages(sessionId),
      sendPrompt: (
        text: string,
        images?: Array<{ base64: string; mimeType: string }>,
        useWorktree?: boolean,
      ): void => s.sendPrompt(sessionId, text, images, useWorktree),
      respondToPermission: (
        requestId: string,
        decision: PermissionDecisionValue,
        feedback?: string,
        optionId?: string,
      ): void => s.respondToPermission(sessionId, requestId, decision, feedback, optionId),
      respondToQuestion: (response: AgentQuestionAnswers): void =>
        s.respondToQuestion(sessionId, response),
      interrupt: (): void => s.interrupt(sessionId),
      destroy: (): void => s.destroy(sessionId),
      clearSession: (): void => s.clearSession(sessionId),
      compactSession: (): void => s.compactSession(sessionId),
      initSession: (config: SessionConfig): void => s.initSession(sessionId, config),
      setProvider: (providerId: string): void => s.setProvider(sessionId, providerId),
      setModel: (modelId: string): void => s.setModel(sessionId, modelId),
      setThinkingEffort: (thinkingEffort?: string): void =>
        s.setThinkingEffort(sessionId, thinkingEffort),
      setPermissionMode: (mode: PermissionMode): void => s.setPermissionMode(sessionId, mode),
      approvePlan: (): void => s.approvePlan(sessionId),
      requestPlanChanges: (feedback: string): void => s.requestPlanChanges(sessionId, feedback),
    };
  }, [sessionId]);

  // Snapshot fields refresh per session change (incl. token chunks).
  return useMemo<UseWebSocketSessionReturn>(() => {
    const lifecycle = session?.lifecycle ?? createIdleTurnLifecycle();
    // Status is the backend-pushed value when available. Until the
    // first `session_status.update` arrives (race during initial WS
    // connect, or before `sessionDbId` is known), fall back to deriving
    // from the local lifecycle so the UI doesn't blink to Idle on
    // mount. Once the WS snapshot arrives, `liveStatus` wins forever —
    // see `lib/agent-status.ts` for the canonical mapping.
    const status: LiveAgentStatus = liveStatus ?? liveStatusFromLifecycle(lifecycle);
    return {
      blocks: session?.blocks ?? [],
      rootBlocks: session?.rootBlocks ?? [],
      toolResultMap: session?.toolResultMap ?? new Map(),
      historyPrependDisplayOffset: session?.historyPrependDisplayOffset ?? 0,
      lifecycle,
      status,
      isConnected: session?.isConnected ?? false,
      sessionId,
      hasMore: session?.hasMore ?? false,
      pendingPermission: session?.pendingPermission ?? null,
      pendingRequestId: session?.pendingRequestId ?? "",
      // Scope the boolean to the currently visible request so a stale clear
      // never lights up the spinner on the next queued permission.
      isSubmittingPermission:
        session?.submittingPermissionRequestId != null &&
        session.submittingPermissionRequestId ===
          (session.pendingPermission?.requestId ?? session.pendingRequestId),
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
      ...actions,
    };
  }, [session, sessionId, actions, liveStatus]);
}

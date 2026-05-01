import { create } from "zustand";
import { buildUserMessageContent } from "@/types/agent-types";
import { getWsProtocols, getWsUrl } from "@/lib/ws-url";
import { createWsConnection } from "@/lib/ws-connection";
import { scheduleReconnect, resetReconnectDelay, clearReconnect } from "@/lib/ws-reconnect";
import {
  type SessionConfig,
  type WsEnvelope,
  parseEnvelope,
  createEnvelope,
  createSessionInit,
  createPromptSend,
  createPermissionRespond,
  createInterrupt,
  createDestroy,
  createProviderSet,
  createModelSet,
  createEffortSet,
  createModeSet,
  createSessionClear,
  createSessionCompact,
  createSessionDelete,
  createCommandsGet,
} from "@/lib/ws-envelope";
import { handleEnvelope } from "./ws-envelope-handler";
import type { StoreAccessors } from "./ws-envelope-handler";
import { parseErrorPayload } from "./ws-envelope-payload";
import {
  applyApprovePlan,
  applyPersistedState,
  applyPlanChangesRequest,
  formatQuestionResponse,
  loadOlderSessionMessages,
  type PersistedStatePayload,
} from "./ws-session-actions";
import {
  appendLocalUserMessage,
  buildQueuedInitEnvelopes,
  buildQueuedPromptPatch,
  buildSlashCommandsKey,
} from "./ws-session-store-helpers";
import {
  type SessionEntry,
  type WsSessionStore,
  createSessionEntry,
  type PermissionMode,
  updateSession,
} from "./ws-session-types";
import type { AgentQuestionAnswers } from "@/components/AgentQuestionDrawer";
import { buildAskUserQuestionUpdatedInput } from "@/lib/build-ask-user-question-payload";
import type { PermissionDecisionValue } from "@/components/ToolPermissionPrompt";
import { isTurnActive, transitionTurn } from "./ws-turn-lifecycle";

import { blocksPatchWithDerived, createStreamingState } from "./ws-message-processing";
export type { PermissionMode, PendingPlanApproval } from "./ws-session-types";
export {
  type StreamingState,
  type BlockMutation,
  blocksPatchWithDerived,
  createStreamingState,
  processSdkMessage,
  applyMutations,
} from "./ws-message-processing";

/** Prefix for synthetic request IDs created during plan-restore flows. */
const PLAN_RESTORE_PREFIX = "plan_restore_";

export const useWsSessionStore = create<WsSessionStore>((set, get) => {
  function getSession(sessionId: string): SessionEntry {
    return get().sessions[sessionId] ?? createSessionEntry();
  }

  function sendRaw(sessionId: string, data: unknown): void {
    getSession(sessionId).conn?.sendJson(data);
  }

  function queuePrompt(
    sessionId: string,
    text: string,
    images?: Array<{ base64: string; mimeType: string }>,
    useWorktree?: boolean,
  ): void {
    const session = getSession(sessionId);
    set(
      updateSession(get(), sessionId, buildQueuedPromptPatch(session, text, images, useWorktree)),
    );
  }

  function flushQueuedInitActions(sessionId: string): void {
    const session = get().sessions[sessionId];
    if (!session || !session.serverSessionId) return;
    for (const envelope of buildQueuedInitEnvelopes(session)) {
      sendRaw(sessionId, envelope);
    }
    if (session.queuedPrompts.length === 0) return;
    set(updateSession(get(), sessionId, { queuedPrompts: [] }));
  }
  const ctx: StoreAccessors = { get, set, getSession };

  return {
    sessions: {},

    connect(sessionId: string) {
      const existing = get().sessions[sessionId];
      if (existing?.conn && (existing.conn.isOpen() || existing.conn.isConnecting())) {
        return;
      }

      const entry = existing ?? createSessionEntry();
      const conn = createWsConnection({
        url: getWsUrl(),
        protocols: getWsProtocols(),
        onOpen: () => {
          resetReconnectDelay(sessionId);
          set(updateSession(get(), sessionId, { isConnected: true }));
        },
        onClose: () => {
          const session = get().sessions[sessionId];
          if (session?.pendingWsRequests.size) {
            for (const cb of session.pendingWsRequests.values()) cb(null);
            session.pendingWsRequests.clear();
          }
          const wasRunning = session != null && isTurnActive(session.lifecycle);
          const errorBlock = wasRunning
            ? {
                id: `ws-err-close-${Date.now()}`,
                type: "text" as const,
                content: "Connection lost while streaming. Reconnecting…",
                isError: true,
              }
            : undefined;
          const closedBlocks = errorBlock
            ? [...(session?.blocks ?? []), errorBlock]
            : (session?.blocks ?? []);
          const closedDerived = errorBlock
            ? blocksPatchWithDerived(
                session?.streamingState ?? createStreamingState(),
                closedBlocks,
              )
            : { blocks: closedBlocks };
          set(
            updateSession(get(), sessionId, {
              conn: null,
              isConnected: false,
              serverSessionId: "",
              runtimeSessionId: "",
              lifecycle: transitionTurn(session?.lifecycle ?? createSessionEntry().lifecycle, {
                type: "connection_lost",
              }),
              ...closedDerived,
            }),
          );
          scheduleReconnect(sessionId, () => get().connect(sessionId));
        },
        onError: () => {
          const session = get().sessions[sessionId];
          if (session?.pendingWsRequests.size) {
            for (const cb of session.pendingWsRequests.values()) cb(null);
            session.pendingWsRequests.clear();
          }
          set(
            updateSession(get(), sessionId, {
              conn: null,
              isConnected: false,
              serverSessionId: "",
              runtimeSessionId: "",
              lifecycle: transitionTurn(session?.lifecycle ?? createSessionEntry().lifecycle, {
                type: "turn_errored",
              }),
            }),
          );
          scheduleReconnect(sessionId, () => get().connect(sessionId));
        },
        onMessage: (data) => {
          let envelope: WsEnvelope;
          try {
            envelope = parseEnvelope(data);
          } catch {
            return; // genuinely unparseable — skip
          }
          try {
            handleEnvelope(ctx, sessionId, envelope);
            if (envelope.domain === "session" && envelope.action === "initialized") {
              flushQueuedInitActions(sessionId);
            }
          } catch (err) {
            console.error("[ws-session] handleEnvelope error:", err);
            const session = getSession(sessionId);
            session.streamingState.counter += 1;
            const blocks = [
              ...session.blocks,
              {
                id: `ws-err-${session.streamingState.counter}`,
                type: "text" as const,
                content: `Internal error: ${err instanceof Error ? err.message : "unknown"}`,
                isError: true,
              },
            ];
            set(
              updateSession(
                get(),
                sessionId,
                blocksPatchWithDerived(session.streamingState, blocks),
              ),
            );
          }
        },
      });

      set({
        sessions: {
          ...get().sessions,
          [sessionId]: {
            ...entry,
            conn,
            streamingState: existing?.streamingState ?? entry.streamingState,
          },
        },
      });
    },

    disconnect(sessionId: string) {
      clearReconnect(sessionId);
      const session = get().sessions[sessionId];
      if (!session?.conn) return;

      if (session.serverSessionId) {
        session.conn.sendJson(createDestroy(session.serverSessionId));
      }
      session.conn.close();

      const { [sessionId]: _, ...rest } = get().sessions;
      set({ sessions: rest });
    },

    send: sendRaw,

    sendRequest(sessionId: string, envelope: WsEnvelope): Promise<unknown> {
      return new Promise((resolve) => {
        const session = get().sessions[sessionId];
        if (session) {
          const timer = setTimeout(() => {
            session.pendingWsRequests.delete(envelope.id);
            resolve(null);
          }, 10_000);
          session.pendingWsRequests.set(envelope.id, (payload) => {
            clearTimeout(timer);
            resolve(payload);
          });
        }
        sendRaw(sessionId, envelope);
      });
    },

    initSession(sessionId: string, config: SessionConfig) {
      const sessionPatch: Partial<SessionEntry> = {};
      if (config.featureId) {
        sessionPatch.featureId = config.featureId;
      }
      if (config.provider) {
        sessionPatch.currentProviderId = config.provider;
      }
      if (config.model) {
        sessionPatch.currentModelId = config.model;
      }
      if (config.thinkingEffort) {
        sessionPatch.currentThinkingEffort = config.thinkingEffort;
      }
      if (Object.keys(sessionPatch).length > 0) {
        set(updateSession(get(), sessionId, sessionPatch));
      }
      sendRaw(sessionId, createSessionInit(config));
    },

    sendPrompt(
      sessionId: string,
      text: string,
      images?: Array<{ base64: string; mimeType: string }>,
      useWorktree?: boolean,
    ) {
      const session = getSession(sessionId);
      if (session.serverSessionId) {
        sendRaw(sessionId, createPromptSend(session.serverSessionId, text, images, useWorktree));
      } else {
        queuePrompt(sessionId, text, images, useWorktree);
      }

      const content = buildUserMessageContent(text, images);
      set(updateSession(get(), sessionId, appendLocalUserMessage(session, content)));
    },

    respondToPermission(
      sessionId: string,
      requestId: string,
      decision: PermissionDecisionValue,
      feedback?: string,
    ) {
      const session = getSession(sessionId);
      sendRaw(
        sessionId,
        createPermissionRespond(session.serverSessionId, requestId, decision, undefined, feedback),
      );
      set(
        updateSession(get(), sessionId, {
          pendingPermission: null,
          pendingRequestId: "",
        }),
      );
    },

    respondToQuestion(sessionId: string, response: AgentQuestionAnswers) {
      const session = getSession(sessionId);
      sendRaw(
        sessionId,
        createPermissionRespond(
          session.serverSessionId,
          session.pendingRequestId,
          "allow_once",
          buildAskUserQuestionUpdatedInput(session.pendingQuestionToolInput, response),
        ),
      );

      const formatted = formatQuestionResponse(session.pendingQuestionToolInput, response);
      session.streamingState.counter += 1;
      const nextBlocks = [
        ...session.blocks,
        {
          id: `ws-user-${session.streamingState.counter}`,
          type: "user_message" as const,
          content: formatted,
          isError: false,
          createdAt: new Date().toISOString(),
        },
      ];
      set(
        updateSession(get(), sessionId, {
          ...blocksPatchWithDerived(session.streamingState, nextBlocks),
          pendingQuestions: [],
          pendingQuestionToolInput: {},
          pendingRequestId: "",
          lifecycle: transitionTurn(session.lifecycle, { type: "question_answered" }),
        }),
      );
    },

    interrupt(sessionId: string) {
      const session = getSession(sessionId);
      sendRaw(sessionId, createInterrupt(session.serverSessionId));
    },

    destroy(sessionId: string) {
      clearReconnect(sessionId);
      const session = get().sessions[sessionId];
      if (!session?.conn) return;

      if (session.serverSessionId) {
        session.conn.sendJson(createDestroy(session.serverSessionId));
      }
      session.conn.close();

      set(
        updateSession(get(), sessionId, {
          conn: null,
          isConnected: false,
          lifecycle: transitionTurn(session.lifecycle, {
            type: "turn_ended",
            reason: "completed",
          }),
        }),
      );
    },

    clearSession(sessionId: string) {
      const session = getSession(sessionId);
      sendRaw(sessionId, createSessionClear(session.serverSessionId));
    },

    compactSession(sessionId: string) {
      const session = getSession(sessionId);
      if (session.pendingManualCompact) return;
      sendRaw(sessionId, createSessionCompact(session.serverSessionId));
      set(
        updateSession(get(), sessionId, {
          ...appendLocalUserMessage(session, "/compact"),
          pendingManualCompact: true,
        }),
      );
    },

    deleteSession(sessionId: string) {
      const session = getSession(sessionId);
      sendRaw(sessionId, createSessionDelete(session.serverSessionId));
    },

    setProvider(sessionId: string, providerId: string) {
      const session = getSession(sessionId);
      sendRaw(sessionId, createProviderSet(session.serverSessionId, providerId));
    },

    setModel(sessionId: string, modelId: string) {
      const session = getSession(sessionId);
      sendRaw(sessionId, createModelSet(session.serverSessionId, modelId));
    },

    setThinkingEffort(sessionId: string, thinkingEffort?: string) {
      const session = getSession(sessionId);
      sendRaw(sessionId, createEffortSet(session.serverSessionId, thinkingEffort));
      set(updateSession(get(), sessionId, { currentThinkingEffort: thinkingEffort }));
    },

    setPermissionMode(sessionId: string, mode: PermissionMode) {
      const session = getSession(sessionId);
      if (session.serverSessionId) {
        sendRaw(sessionId, createModeSet(session.serverSessionId, mode));
      }
      set(updateSession(get(), sessionId, { permissionMode: mode }));
    },

    approvePlan(sessionId: string) {
      applyApprovePlan(ctx, sessionId, sendRaw, PLAN_RESTORE_PREFIX);
    },

    requestPlanChanges(sessionId: string, feedback: string) {
      applyPlanChangesRequest(ctx, sessionId, feedback, sendRaw, PLAN_RESTORE_PREFIX);
    },

    retryWorktreeSetup(sessionId: string) {
      const session = getSession(sessionId);
      const featureId = session.featureId;
      if (!featureId) {
        set(
          updateSession(get(), sessionId, {
            worktreeStatus: "setup_error",
            worktreeError: "feature_id is required",
          }),
        );
        return;
      }
      const envelope = createEnvelope("session", "retry_worktree_setup", {
        session_id: session.serverSessionId,
        feature_id: featureId,
      });
      void get()
        .sendRequest(sessionId, envelope)
        .then((payload) => {
          const errorMessage = parseErrorPayload(payload)?.message;
          if (!errorMessage) return;
          set(
            updateSession(get(), sessionId, {
              worktreeStatus: "setup_error",
              worktreeError: errorMessage,
            }),
          );
        });
    },

    requestSlashCommands(sessionId: string, cwd: string, provider?: string) {
      const session = getSession(sessionId);
      const resolvedProvider = provider ?? session.runtimeProvider ?? session.currentProviderId;
      const nextKey = buildSlashCommandsKey(cwd, resolvedProvider);
      const sameTarget = session.slashCommandsKey === nextKey;
      if (
        (sameTarget && session.slashCommands.length > 0) ||
        (sameTarget && session.slashCommandsLoading)
      ) {
        return;
      }
      const envelope = createCommandsGet(cwd, resolvedProvider);
      set(
        updateSession(get(), sessionId, {
          slashCommands: sameTarget ? session.slashCommands : [],
          slashCommandsLoading: true,
          slashCommandsKey: nextKey,
          slashCommandsRequestRef: envelope.id,
        }),
      );
      sendRaw(sessionId, envelope);
    },

    markPersistedLoaded(sessionId: string) {
      set(updateSession(get(), sessionId, { persistedLoaded: true }));
    },

    setPersistedState(sessionId: string, payload: PersistedStatePayload) {
      applyPersistedState(ctx, sessionId, payload, PLAN_RESTORE_PREFIX);
    },

    async loadOlderMessages(sessionId: string) {
      await loadOlderSessionMessages(ctx, sessionId);
    },
  };
});

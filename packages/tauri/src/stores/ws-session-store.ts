import { create } from "zustand";
import { buildUserMessageContent } from "@/types/agent-types";
import { getWsUrl } from "@/lib/ws-url";
import { createWsConnection } from "@/lib/ws-connection";
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
  createModeSet,
  createSessionClear,
  createSessionDelete,
  createCommandsGet,
} from "@/lib/ws-envelope";
import { fetchFeatureAgentState } from "@/api/generated";
import { serverBlocksToAgentBlocks } from "@/hooks/useFeatureAgentState";
import { handleEnvelope } from "./ws-envelope-handler";
import type { StoreAccessors } from "./ws-envelope-handler";
import {
  applyApprovePlan,
  applyPersistedState,
  applyPlanChangesRequest,
  type PersistedStatePayload,
} from "./ws-session-actions";
import {
  type QueuedPrompt,
  type SessionEntry,
  type WsSessionStore,
  createSessionEntry,
  type PermissionMode,
  updateSession
} from "./ws-session-types";
import type { AgentQuestionAnswers } from "@/components/AgentQuestionDrawer";

export type { PermissionMode, PendingPlanApproval } from "./ws-session-types";
export {
  type StreamingState,
  type BlockMutation,
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
    const queuedPrompt: QueuedPrompt = { text };
    if (images && images.length > 0) queuedPrompt.images = images;
    if (useWorktree) queuedPrompt.useWorktree = true;
    set(updateSession(get(), sessionId, {
      queuedPrompts: [...session.queuedPrompts, queuedPrompt],
    }));
  }
  function flushQueuedInitActions(sessionId: string): void {
    const session = get().sessions[sessionId];
    if (!session || !session.serverSessionId) return;
    if (session.permissionMode === "plan") {
      sendRaw(sessionId, createModeSet(session.serverSessionId, "plan"));
    }
    if (session.queuedPrompts.length === 0) return;
    for (const prompt of session.queuedPrompts) {
      sendRaw(sessionId, createPromptSend(
        session.serverSessionId,
        prompt.text,
        prompt.images,
        prompt.useWorktree,
      ));
    }
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
        onOpen: () => {
          set(updateSession(get(), sessionId, { isConnected: true }));
        },
        onClose: () => {
          const session = get().sessions[sessionId];
          if (session?.pendingWsRequests.size) {
            for (const cb of session.pendingWsRequests.values()) cb(null);
            session.pendingWsRequests.clear();
          }
          set(updateSession(get(), sessionId, {
            conn: null,
            isConnected: false,
            serverSessionId: "",
            runtimeSessionId: "",
            claudeSessionId: "",
            status: getSession(sessionId).status === "running" ? "error" : getSession(sessionId).status,
          }));
        },
        onError: () => {
          set(updateSession(get(), sessionId, {
            conn: null,
            isConnected: false,
            serverSessionId: "",
            runtimeSessionId: "",
            claudeSessionId: "",
            status: "error",
          }));
        },
        onMessage: (data) => {
          try {
            const envelope = parseEnvelope(data);
            handleEnvelope(ctx, sessionId, envelope);
            if (envelope.domain === "session" && envelope.action === "initialized") {
              flushQueuedInitActions(sessionId);
            }
          } catch {
            // Ignore unparseable messages
          }
        },
      });

      set({
        sessions: {
          ...get().sessions,
          [sessionId]: { ...entry, conn, streamingState: existing?.streamingState ?? entry.streamingState },
        },
      });
    },

    disconnect(sessionId: string) {
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
      if (config.provider) {
        set(updateSession(get(), sessionId, { currentProviderId: config.provider }));
      }
      if (config.model) {
        set(updateSession(get(), sessionId, { currentModelId: config.model }));
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
      session.streamingState.counter += 1;
      set(updateSession(get(), sessionId, {
        blocks: [
          ...session.blocks,
          {
            id: `ws-user-${session.streamingState.counter}`,
            type: "user_message" as const,
            content,
            isError: false,
            createdAt: new Date().toISOString(),
          },
        ],
        status: "running",
      }));
    },

    respondToPermission(sessionId: string, requestId: string, granted: boolean) {
      const session = getSession(sessionId);
      const decision = granted ? "allow_once" : "deny";
      sendRaw(sessionId, createPermissionRespond(session.serverSessionId, requestId, decision));
      set(updateSession(get(), sessionId, {
        pendingPermission: null,
        pendingRequestId: "",
        status: "running",
      }));
    },

    respondToQuestion(sessionId: string, response: AgentQuestionAnswers) {
      const session = getSession(sessionId);
      const updatedInput = {
        ...session.pendingQuestionToolInput,
        answers: response,
      };
      sendRaw(sessionId, createPermissionRespond(
        session.serverSessionId,
        session.pendingRequestId,
        "allow_once",
        updatedInput,
      ));

      const questions = Array.isArray(session.pendingQuestionToolInput.questions)
        ? session.pendingQuestionToolInput.questions
        : session.pendingQuestionToolInput.question != null
          ? [session.pendingQuestionToolInput]
          : [];
      const formatted = response
        .map((answerGroup, index) => {
          const rawQuestion = questions[index];
          const question = typeof rawQuestion === "object" && rawQuestion != null && typeof (rawQuestion as { question?: unknown }).question === "string"
            ? (rawQuestion as { question: string }).question
            : `Question ${index + 1}`;
          return `*${question}*\n\n**${answerGroup.join("\n")}**`;
        })
        .join("\n\n\n\n");

      session.streamingState.counter += 1;
      set(updateSession(get(), sessionId, {
        blocks: [
          ...session.blocks,
          {
            id: `ws-user-${session.streamingState.counter}`,
            type: "user_message" as const,
            content: formatted,
            isError: false,
            createdAt: new Date().toISOString(),
          },
        ],
        pendingQuestions: [],
        pendingQuestionToolInput: {},
        pendingRequestId: "",
        status: "running",
      }));
    },

    interrupt(sessionId: string) {
      const session = getSession(sessionId);
      sendRaw(sessionId, createInterrupt(session.serverSessionId));
    },

    destroy(sessionId: string) {
      const session = get().sessions[sessionId];
      if (!session?.conn) return;

      if (session.serverSessionId) {
        session.conn.sendJson(createDestroy(session.serverSessionId));
      }
      session.conn.close();

      set(updateSession(get(), sessionId, {
        conn: null,
        isConnected: false,
        status: "completed",
      }));
    },

    clearSession(sessionId: string) {
      const session = getSession(sessionId);
      sendRaw(sessionId, createSessionClear(session.serverSessionId));
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
      sendRaw(sessionId, createEnvelope("session", "retry_worktree_setup", {
        session_id: session.serverSessionId,
        feature_id: session.featureId,
      }));
    },

    requestSlashCommands(sessionId: string, cwd: string) {
      const session = getSession(sessionId);
      if (session.slashCommands.length > 0 || session.slashCommandsLoading) return;
      set(updateSession(get(), sessionId, { slashCommandsLoading: true }));
      sendRaw(sessionId, createCommandsGet(cwd));
    },

    markPersistedLoaded(sessionId: string) {
      set(updateSession(get(), sessionId, { persistedLoaded: true }));
    },

    setPersistedState(sessionId: string, payload: PersistedStatePayload) {
      applyPersistedState(ctx, sessionId, payload, PLAN_RESTORE_PREFIX);
    },

    async loadOlderMessages(sessionId: string) {
      const session = get().sessions[sessionId];
      if (!session || !session.hasMore || session.oldestMessageId == null || !session.featureId || !session.sessionDbId) return;

      const beforeParam = JSON.stringify({ [session.sessionDbId]: session.oldestMessageId });
      const data = await fetchFeatureAgentState(session.featureId, {
        before: beforeParam,
        limit: 100,
      });

      const serverSession = data.sessions.find((s) => s.sessionDbId === session.sessionDbId);
      if (!serverSession) {
        set(updateSession(get(), sessionId, { hasMore: false }));
        return;
      }

      const olderBlocks = serverBlocksToAgentBlocks(serverSession.blocks as never[]);

      const currentSession = get().sessions[sessionId];
      if (!currentSession) return;
      set(updateSession(get(), sessionId, {
        blocks: [...olderBlocks, ...currentSession.blocks],
        hasMore: serverSession.hasMore ?? false,
        oldestMessageId: serverSession.oldestMessageId ?? null,
      }));
    },
  };
});

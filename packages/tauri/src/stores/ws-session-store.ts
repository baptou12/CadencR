import { create } from "zustand";
import { buildUserMessageContent } from "@/types/agent-types";
import { getWsUrl } from "@/lib/ws-url";
import { createWsConnection } from "@/lib/ws-connection";
import {
  parseEnvelope,
  createEnvelope,
  createSessionInit,
  createPromptSend,
  createPermissionRespond,
  createInterrupt,
  createDestroy,
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
  type WsSessionStore,
  type SessionEntry,
  createSessionEntry,
  updateSession,
  markLastPlanBlock,
} from "./ws-session-types";

export type { PermissionMode, PendingPlanApproval } from "./ws-session-types";
export {
  type StreamingState,
  type BlockMutation,
  createStreamingState,
  processSdkMessage,
  applyMutations,
} from "./ws-message-processing";
import { parseTodosFromBlocks } from "./ws-message-processing";
import { injectPlanIntoBlocks } from "./ws-message-processing";

/** Prefix for synthetic request IDs created during plan-restore flows. */
const PLAN_RESTORE_PREFIX = "plan_restore_";

export const useWsSessionStore = create<WsSessionStore>((set, get) => {
  function getSession(sessionId: string): SessionEntry {
    return get().sessions[sessionId] ?? createSessionEntry();
  }
  function sendRaw(sessionId: string, data: unknown): void {
    getSession(sessionId).conn?.sendJson(data);
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
            isConnected: false,
            status: getSession(sessionId).status === "running" ? "error" : getSession(sessionId).status,
          }));
        },
        onError: () => {
          set(updateSession(get(), sessionId, { isConnected: false, status: "error" }));
        },
        onMessage: (data) => {
          try {
            const envelope = parseEnvelope(data);
            handleEnvelope(ctx, sessionId, envelope);
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

    sendRequest(sessionId: string, envelope): Promise<unknown> {
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

    initSession(sessionId: string, config) {
      if (config.model) {
        set(updateSession(get(), sessionId, { currentModelId: config.model }));
      }
      sendRaw(sessionId, createSessionInit(config));
    },

    sendPrompt(sessionId: string, text, images, useWorktree) {
      const session = getSession(sessionId);
      sendRaw(sessionId, createPromptSend(session.serverSessionId, text, images, useWorktree));

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

    respondToPermission(sessionId: string, requestId, granted) {
      const session = getSession(sessionId);
      const decision = granted ? "allow_once" : "deny";
      sendRaw(sessionId, createPermissionRespond(session.serverSessionId, requestId, decision));
      set(updateSession(get(), sessionId, {
        pendingPermission: null,
        pendingRequestId: "",
        status: "running",
      }));
    },

    respondToQuestion(sessionId: string, response) {
      const session = getSession(sessionId);
      const updatedInput = {
        ...session.pendingQuestionToolInput,
        answers: { "0": response },
      };
      sendRaw(sessionId, createPermissionRespond(
        session.serverSessionId,
        session.pendingRequestId,
        "allow_once",
        updatedInput,
      ));

      const formatted = response
        .split("\n\n")
        .map((qa) => {
          const lines = qa.split("\n");
          const question = lines[0] ?? "";
          const answer = lines
            .slice(1)
            .map((l) => l.replace(/^Answer:\s*/, ""))
            .join("\n");
          return `*${question}*\n\n**${answer}**`;
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

    setModel(sessionId: string, modelId) {
      const session = getSession(sessionId);
      sendRaw(sessionId, createModelSet(session.serverSessionId, modelId));
      set(updateSession(get(), sessionId, { currentModelId: modelId }));
    },

    setPermissionMode(sessionId: string, mode) {
      const session = getSession(sessionId);
      sendRaw(sessionId, createModeSet(session.serverSessionId, mode));
      set(updateSession(get(), sessionId, { permissionMode: mode }));
    },

    approvePlan(sessionId: string) {
      const session = getSession(sessionId);
      const markedBlocks = markLastPlanBlock(session.blocks, "approved");
      session.streamingState.counter += 1;
      const updatedBlocks = [
        ...markedBlocks,
        {
          id: `ws-user-${session.streamingState.counter}`,
          type: "user_message" as const,
          content: "Plan approved.",
          isError: false,
          createdAt: new Date().toISOString(),
        },
      ];
      if (session.pendingRequestId) {
        const isRestored = session.pendingRequestId.startsWith(PLAN_RESTORE_PREFIX);
        sendRaw(sessionId, createModeSet(session.serverSessionId, "acceptEdits"));
        sendRaw(sessionId, createPermissionRespond(session.serverSessionId, session.pendingRequestId, "allow_once"));
        // For restored plans (CLI not running), also send a prompt to trigger
        // CLI respawn with --resume. The stored plan_approval_result will be
        // picked up by check_stored_approval on the next ExitPlanMode call.
        if (isRestored) {
          sendRaw(sessionId, createPromptSend(session.serverSessionId, "Plan approved. Proceed with execution."));
        }
        set(updateSession(get(), sessionId, {
          pendingRequestId: "",
          pendingPlanApproval: null,
          permissionMode: "acceptEdits",
          blocks: updatedBlocks,
          status: "running",
        }));
      } else {
        sendRaw(sessionId, createModeSet(session.serverSessionId, "acceptEdits"));
        sendRaw(sessionId, createPromptSend(session.serverSessionId, "Plan approved. Exit plan mode and proceed with execution."));
        set(updateSession(get(), sessionId, {
          permissionMode: "acceptEdits",
          pendingPlanApproval: null,
          blocks: updatedBlocks,
          status: "running",
        }));
      }
    },

    requestPlanChanges(sessionId: string, feedback) {
      const session = getSession(sessionId);
      const blocksWithStatus = markLastPlanBlock(session.blocks, "rejected");
      session.streamingState.counter += 1;
      const blocksWithFeedback = feedback
        ? [
            ...blocksWithStatus,
            {
              id: `ws-user-${session.streamingState.counter}`,
              type: "user_message" as const,
              content: feedback,
              isError: false,
              createdAt: new Date().toISOString(),
            },
          ]
        : blocksWithStatus;
      if (session.pendingRequestId) {
        const isRestored = session.pendingRequestId.startsWith(PLAN_RESTORE_PREFIX);
        sendRaw(sessionId, createPermissionRespond(session.serverSessionId, session.pendingRequestId, "deny", undefined, feedback));
        if (isRestored) {
          sendRaw(sessionId, createPromptSend(session.serverSessionId, feedback || "Plan rejected. Revise the plan."));
        }
        set(updateSession(get(), sessionId, {
          pendingRequestId: "",
          pendingPlanApproval: null,
          blocks: blocksWithFeedback,
          status: "running",
        }));
      } else {
        sendRaw(sessionId, createPromptSend(session.serverSessionId, feedback));
        set(updateSession(get(), sessionId, {
          pendingPlanApproval: null,
          blocks: blocksWithFeedback,
          status: "running",
        }));
      }
    },

    retryWorktreeSetup(sessionId: string) {
      const session = getSession(sessionId);
      sendRaw(sessionId, createEnvelope("session", "retry_worktree_setup", {
        session_id: session.serverSessionId,
        feature_id: session.featureId,
      }));
    },

    requestSlashCommands(sessionId: string, cwd) {
      const session = getSession(sessionId);
      if (session.slashCommands.length > 0 || session.slashCommandsLoading) return;
      set(updateSession(get(), sessionId, { slashCommandsLoading: true }));
      sendRaw(sessionId, createCommandsGet(cwd));
    },

    markPersistedLoaded(sessionId: string) {
      set(updateSession(get(), sessionId, { persistedLoaded: true }));
    },

    setPersistedState(sessionId: string, { blocks, status, hasMore, oldestMessageId, featureId, sessionDbId, pendingPlanApproval }) {
      const existing = get().sessions[sessionId];
      if (existing && existing.blocks.length > 0) {
        set(updateSession(get(), sessionId, {
          persistedLoaded: true,
          hasMore: hasMore ?? false,
          oldestMessageId: oldestMessageId ?? null,
          featureId: featureId ?? null,
          sessionDbId: sessionDbId ?? null,
          ...(pendingPlanApproval != null ? { pendingPlanApproval, status: "paused" as const } : {}),
        }));
        return;
      }
      // If pendingPlanApproval has plan content, inject it into the last
      // ExitPlanMode block's toolArgs so PlanBlock renders on restore.
      const enrichedBlocks = injectPlanIntoBlocks(blocks, pendingPlanApproval);
      const todos = parseTodosFromBlocks(enrichedBlocks);
      // Generate a synthetic request ID so approvePlan sends permission.respond
      // instead of a text prompt. The "plan_restore_" prefix tells the backend
      // to store the result in DB for the CLI to pick up on next spawn.
      const restoredRequestId = pendingPlanApproval != null ? `${PLAN_RESTORE_PREFIX}${Date.now()}` : "";
      set(updateSession(get(), sessionId, {
        blocks: enrichedBlocks, status: pendingPlanApproval != null ? "paused" as const : status,
        persistedLoaded: true,
        ...(todos ? { todos } : {}),
        hasMore: hasMore ?? false,
        oldestMessageId: oldestMessageId ?? null,
        featureId: featureId ?? null,
        sessionDbId: sessionDbId ?? null,
        ...(pendingPlanApproval != null ? { pendingPlanApproval, pendingRequestId: restoredRequestId } : {}),
      }));
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

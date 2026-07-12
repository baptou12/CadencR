import { create } from "zustand";
import {
  type PromptDispatchOptions,
  type WsEnvelope,
  createSessionInit,
  createPromptSend,
  createPermissionRespond,
} from "@/lib/ws-envelope";
import * as branch from "./ws-session-branch";
import type { BranchDeps } from "./ws-session-branch";
import type { StoreAccessors } from "./ws-envelope-handler";
import { parseErrorPayload } from "./ws-envelope-payload";
import { buildClearedGatePatch, isGateClosingErrorCode } from "./ws-gate-state";
import {
  makeErrorBlock,
  buildQueuedInitEnvelopes,
  buildQueuedPromptPatch,
} from "./ws-session-store-helpers";
import {
  type SessionEntry,
  type WsSessionStore,
  createSessionEntry,
  updateSession,
} from "./ws-session-types";
import type { AgentQuestionAnswers } from "@/components/AgentQuestionDrawer";
import { buildAskUserQuestionUpdatedInput } from "@/lib/build-ask-user-question-payload";
import type { PermissionDecisionValue } from "@/components/ToolPermissionPrompt";
import { isTurnActive, transitionTurn } from "./ws-turn-lifecycle";
import { advancePendingPermissionQueue } from "@/lib/pending-permission-queue";
import type { SocketHandlerDeps } from "./ws-session-socket-handler";
import { connectSession } from "./ws-session-connect";
import { createWsSessionSimpleActions } from "./ws-session-simple-actions";
import { createWsSessionTransportActions } from "./ws-session-transport-actions";

import { blocksPatchWithDerived } from "./ws-message-processing";
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
const wsSessionSourceKey = (sessionId: string): string => `ws-session:${sessionId}`;

function shouldTrackPromptReceipt(session: SessionEntry): boolean {
  return (
    session.supportsPromptReceipts && !!session.serverSessionId && isTurnActive(session.lifecycle)
  );
}

/**
 * Resolve every in-flight `sendRequest()` with `null` and clear the map, so
 * callers stop waiting the moment the socket is gone (transient drop or
 * deliberate teardown) instead of hanging until the 10s timeout.
 *
 * A request resolved as failed must not execute later as a stale side effect:
 * its envelope may still sit in `outboundQueue` (queued while the socket was
 * down), so drop it too. Non-request envelopes (prompts, resume, control)
 * keep the queue-and-flush policy — only rejected requests are removed.
 */
function rejectPendingRequests(session: SessionEntry): void {
  if (!session.pendingWsRequests.size) return;
  const requestIds = new Set(session.pendingWsRequests.keys());
  for (const cb of session.pendingWsRequests.values()) cb(null);
  session.pendingWsRequests.clear();
  const queue = session.outboundQueue;
  for (let i = queue.length - 1; i >= 0; i -= 1) {
    if (requestIds.has(queue[i].id)) queue.splice(i, 1);
  }
}

export const useWsSessionStore = create<WsSessionStore>((set, get) => {
  function getSession(sessionId: string): SessionEntry {
    return get().sessions[sessionId] ?? createSessionEntry();
  }

  function sendRaw(sessionId: string, envelope: WsEnvelope): void {
    const session = get().sessions[sessionId];
    if (session?.conn?.sendJson(envelope)) return;
    // The socket is not OPEN (reconnecting, or still CONNECTING). Dropping the
    // envelope here is silent data loss. Hold it and flush on `onOpen`, after
    // the reconnect `session.init` replay; the canonical user-message event is
    // created only after the backend persists the queued prompt.
    session?.outboundQueue.push(envelope);
  }

  /** Send queued envelopes in order; stop (and keep the rest) if the socket drops again. */
  function flushOutboundQueue(sessionId: string): void {
    const session = get().sessions[sessionId];
    if (!session?.conn) return;
    const queue = session.outboundQueue;
    // Drain by index and splice once at the end: shift() per envelope would
    // reindex the array each time (O(n²) on a long-outage backlog).
    let sent = 0;
    while (sent < queue.length && session.conn.sendJson(queue[sent])) sent += 1;
    if (sent > 0) queue.splice(0, sent);
  }

  function forceReconnectSession(sessionId: string): void {
    const session = get().sessions[sessionId];
    if (session?.conn) {
      rejectPendingRequests(session);
      session.conn.close(1000, "force-reconnect");
      set(updateSession(get(), sessionId, { conn: null, isConnected: false }));
    }
    get().connect(sessionId);
  }

  function queuePrompt(sessionId: string, text: string, options: PromptDispatchOptions = {}): void {
    const session = getSession(sessionId);
    set(updateSession(get(), sessionId, buildQueuedPromptPatch(session, text, options)));
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

  /**
   * Re-emit `session.init` after a transport reconnect so the backend's
   * per-connection `sdk_sessions` map gets rebuilt for this session id.
   *
   * Only fires when:
   *  - We already have a `featureId` (the init payload requires it).
   *  - This is a reconnect, not the first connect — detected by the
   *    presence of a previously-established `serverSessionId`.
   *
   * Provider-neutral: replays whatever provider/model/effort/mode the
   * session was last using. The backend `session.init` handler is
   * idempotent for an existing DB session — it re-binds the in-memory
   * handle from the DB row rather than creating a new one.
   */
  function reinitOnReconnect(sessionId: string): void {
    const session = get().sessions[sessionId];
    if (!session) return;
    if (!session.featureId || !session.serverSessionId || !session.cwd) return;
    sendRaw(
      sessionId,
      createSessionInit({
        cwd: session.cwd,
        featureId: session.featureId,
        provider: session.currentProviderId || undefined,
        model: session.currentModelId || undefined,
        thinkingEffort: session.currentThinkingEffort,
        permissionMode: session.permissionMode,
      }),
    );
  }
  const ctx: StoreAccessors = { get, set, getSession };

  const branchDeps: BranchDeps = {
    get,
    set,
    sendRequest: (sessionId, envelope) => get().sendRequest(sessionId, envelope),
  };

  const socketDeps: SocketHandlerDeps = { ctx, flushQueuedInitActions };

  return {
    sessions: {},
    branchConfirm: null,
    composerPrefill: null,
    forkNavigation: null,

    rewindToMessage(sessionId: string, messageId: number, confirmDiscard?: boolean) {
      void branch.rewindToMessage(branchDeps, sessionId, messageId, confirmDiscard);
    },
    forkFromMessage(sessionId: string, messageId: number) {
      void branch.forkFromMessage(branchDeps, sessionId, messageId);
    },
    resolveBranchConfirm(confirmed: boolean) {
      branch.resolveBranchConfirm(branchDeps, confirmed);
    },
    consumeComposerPrefill(sessionId: string) {
      if (get().composerPrefill?.sessionId === sessionId) set({ composerPrefill: null });
    },
    consumeForkNavigation(sessionId: string) {
      if (get().forkNavigation?.sessionId === sessionId) set({ forkNavigation: null });
    },

    connect(sessionId: string) {
      connectSession(
        {
          ctx,
          socketDeps,
          sourceKey: wsSessionSourceKey,
          rejectPendingRequests,
          forceReconnectSession,
          reinitOnReconnect,
          flushOutboundQueue,
        },
        sessionId,
      );
    },

    ...createWsSessionTransportActions({
      ctx,
      sendRaw,
      sourceKey: wsSessionSourceKey,
      rejectPendingRequests,
    }),

    sendPrompt(sessionId: string, text: string, options: PromptDispatchOptions = {}) {
      const session = getSession(sessionId);
      const trackProviderReceipt = shouldTrackPromptReceipt(session);
      const messageUuid = options.messageUuid ?? crypto.randomUUID();
      if (session.serverSessionId) {
        sendRaw(
          sessionId,
          createPromptSend(session.serverSessionId, text, {
            ...options,
            messageUuid,
            trackPromptReceipt: trackProviderReceipt,
          }),
        );
      } else {
        queuePrompt(sessionId, text, { ...options, messageUuid });
      }
    },

    respondToPermission(
      sessionId: string,
      requestId: string,
      decision: PermissionDecisionValue,
      feedback?: string,
      optionId?: string,
    ) {
      const session = getSession(sessionId);
      const currentRequestId = session.pendingPermission?.requestId ?? requestId;
      // Belt-and-braces: the UI also disables buttons while a submission is
      // in flight, but if anything slips through (keyboard shortcut race,
      // remount, etc.) we still want to drop the duplicate request.
      if (session.submittingPermissionRequestId === currentRequestId) {
        return;
      }
      const envelope = createPermissionRespond(
        session.serverSessionId,
        currentRequestId,
        decision,
        {
          feedback,
          optionId,
        },
      );
      set(
        updateSession(get(), sessionId, {
          submittingPermissionRequestId: currentRequestId,
        }),
      );
      void get()
        .sendRequest(sessionId, envelope)
        .then((payload) => {
          const error = parseErrorPayload(payload);
          if (error?.message || payload === null) {
            const session = getSession(sessionId);
            const message = error?.message ?? "Permission response timed out.";
            const errorBlock = makeErrorBlock(session, message, {
              idPrefix: "ws-permission-error",
            });
            // If the backend says the session/permission is unanswerable,
            // drop the gate so the user is not staring at buttons that
            // will only ever bounce back the same error. Timeouts (payload
            // === null) leave the gate in place — the WS reconnects and a
            // retry can still land.
            const isDeadSessionError = isGateClosingErrorCode(error?.code);
            const gatePatch: Partial<SessionEntry> = isDeadSessionError
              ? {
                  ...buildClearedGatePatch(session),
                  lifecycle: transitionTurn(session.lifecycle, {
                    type: "turn_errored",
                    message,
                  }),
                }
              : { submittingPermissionRequestId: null };
            set(
              updateSession(get(), sessionId, {
                ...blocksPatchWithDerived(session.streamingState, [...session.blocks, errorBlock]),
                ...gatePatch,
              }),
            );
            return;
          }
          const session = getSession(sessionId);
          const permissionPatch = advancePendingPermissionQueue(session.pendingPermissionQueue);
          set(
            updateSession(get(), sessionId, {
              ...permissionPatch,
              pendingRequestId: permissionPatch.pendingPermission?.requestId ?? "",
              submittingPermissionRequestId: null,
            }),
          );
        });
    },

    respondToQuestion(sessionId: string, response: AgentQuestionAnswers) {
      const session = getSession(sessionId);
      const messageUuid = crypto.randomUUID();
      sendRaw(
        sessionId,
        createPermissionRespond(session.serverSessionId, session.pendingRequestId, "allow_once", {
          updatedInput: buildAskUserQuestionUpdatedInput(
            session.pendingQuestionToolInput,
            response,
          ),
          messageUuid,
        }),
      );
      set(
        updateSession(get(), sessionId, {
          pendingQuestions: [],
          pendingQuestionToolInput: {},
          pendingRequestId: "",
          lifecycle: transitionTurn(session.lifecycle, {
            type: "question_answered",
          }),
        }),
      );
    },

    ...createWsSessionSimpleActions({
      ctx,
      sendRaw,
      sourceKey: wsSessionSourceKey,
      rejectPendingRequests,
      planRestorePrefix: PLAN_RESTORE_PREFIX,
    }),
  };
});

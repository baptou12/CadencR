import { createWsConnection, type WsConnection } from "@/lib/ws-connection";
import { getWsProtocols, getWsUrl } from "@/lib/ws-url";
import { registerReconnector, resetReconnectState, scheduleReconnect } from "@/lib/ws-reconnect";
import {
  reportManualReconnectRequired,
  useConnectionStatusStore,
} from "@/stores/connection-status-store";
import { flushStreamDeltas } from "./ws-delta-coalescer";
import type { StoreAccessors } from "./ws-envelope-handler";
import { makeErrorBlock } from "./ws-session-store-helpers";
import { createSessionEntry, type SessionEntry, updateSession } from "./ws-session-types";
import { isTurnActive, transitionTurn } from "./ws-turn-lifecycle";
import { blocksPatchWithDerived } from "./ws-message-processing";
import { resyncMessagesOnReconnect } from "./ws-session-resync";
import { handleSocketMessage, type SocketHandlerDeps } from "./ws-session-socket-handler";

interface ConnectSessionDeps {
  ctx: StoreAccessors;
  socketDeps: SocketHandlerDeps;
  sourceKey: (sessionId: string) => string;
  rejectPendingRequests: (session: SessionEntry) => void;
  forceReconnectSession: (sessionId: string) => void;
  reinitOnReconnect: (sessionId: string) => void;
  flushOutboundQueue: (sessionId: string) => void;
}

export function connectSession(deps: ConnectSessionDeps, sessionId: string): void {
  const {
    ctx,
    socketDeps,
    sourceKey,
    rejectPendingRequests,
    forceReconnectSession,
    reinitOnReconnect,
    flushOutboundQueue,
  } = deps;
  const { get, set } = ctx;
  const existing = get().sessions[sessionId];
  if (existing?.conn && (existing.conn.isOpen() || existing.conn.isConnecting())) {
    return;
  }

  const entry = existing ?? createSessionEntry();
  const reconnectKey = sourceKey(sessionId);
  registerReconnector(reconnectKey, () => forceReconnectSession(sessionId), {
    onManualRequired: reportManualReconnectRequired,
  });
  // A replaced mobile socket can remain registered on the service while its
  // close is in flight, so stale callbacks must not mutate the shared store.
  let conn: WsConnection;
  conn = createWsConnection({
    url: getWsUrl(),
    protocols: getWsProtocols(),
    onOpen: () => {
      if (get().sessions[sessionId]?.conn !== conn) return;
      resetReconnectState(reconnectKey);
      set(updateSession(get(), sessionId, { isConnected: true }));
      useConnectionStatusStore.getState().reportSource(reconnectKey, "connected");
      // If we already have a `serverSessionId`, this is a *reconnect*
      // (e.g. after OS sleep), not a fresh init. The backend's
      // `sdk_sessions` map is per-connection, so the new socket has
      // no idea about this session yet. Re-emit `session.init` with
      // the cached config so the backend rebuilds its in-memory
      // handle from the DB — otherwise every subsequent envelope
      // returns `SESSION_NOT_FOUND` (or, when `serverSessionId` is
      // wiped, the more confusing `INVALID_SESSION_ID`).
      // Provider-neutral: applies to Claude Code, OpenCode, Codex.
      reinitOnReconnect(sessionId);
      // Deliver whatever was sent while the socket was down (prompts,
      // permission responses, session.resume after wake). After the init
      // replay so the backend has rebuilt its handle for this session.
      flushOutboundQueue(sessionId);
      // Catch up on anything the agent streamed while the socket was
      // down (e.g. the mobile client was asleep). WS streaming only
      // delivers live; without this pull the gap is lost forever. Guarded
      // internally to a no-op until the initial load has run.
      void resyncMessagesOnReconnect(ctx, sessionId);
    },
    onClose: (intentional) => {
      if (get().sessions[sessionId]?.conn !== conn) return;
      if (intentional) return;
      // Apply any buffered tokens before the "connection lost" error block
      // so the transcript keeps them in order.
      flushStreamDeltas(ctx, sessionId);
      const session = get().sessions[sessionId];
      if (session) rejectPendingRequests(session);
      const wasRunning = session != null && isTurnActive(session.lifecycle);
      const closedDerived = wasRunning
        ? blocksPatchWithDerived(session.streamingState, [
            ...session.blocks,
            makeErrorBlock(session, "Connection lost while streaming. Reconnecting…", {
              idPrefix: "ws-err-close",
            }),
          ])
        : { blocks: session?.blocks ?? [] };
      set(
        updateSession(get(), sessionId, {
          conn: null,
          isConnected: false,
          // Do not clear `serverSessionId` or `runtimeSessionId` on a
          // transient close: the WS is just transport between the
          // desktop app and the local service. The `serverSessionId`
          // is a stable DB primary key — wiping it makes the renderer
          // send envelopes with `session_id: ""`, which the backend
          // rejects as `INVALID_SESSION_ID`. The next `onOpen`
          // re-emits `session.init` to rebuild the backend's per-
          // connection handle (see `reinitOnReconnect` above).
          lifecycle: transitionTurn(session?.lifecycle ?? createSessionEntry().lifecycle, {
            type: "connection_lost",
          }),
          ...closedDerived,
        }),
      );
      useConnectionStatusStore
        .getState()
        .reportSource(reconnectKey, "reconnecting", "Session WebSocket lost");
      if (!intentional) scheduleReconnect(reconnectKey, () => get().connect(sessionId));
    },
    onError: (intentional) => {
      if (get().sessions[sessionId]?.conn !== conn) return;
      if (intentional) return;
      flushStreamDeltas(ctx, sessionId);
      const session = get().sessions[sessionId];
      if (session) rejectPendingRequests(session);
      set(
        updateSession(get(), sessionId, {
          conn: null,
          isConnected: false,
          // See onClose above: `serverSessionId` and `runtimeSessionId`
          // are stable across transport hiccups; the reconnect path
          // re-emits `session.init` instead of wiping them.
          lifecycle: transitionTurn(session?.lifecycle ?? createSessionEntry().lifecycle, {
            type: "turn_errored",
          }),
        }),
      );
      useConnectionStatusStore
        .getState()
        .reportSource(reconnectKey, "reconnecting", "Session WebSocket error");
      if (!intentional) scheduleReconnect(reconnectKey, () => get().connect(sessionId));
    },
    onMessage: (data) => {
      if (get().sessions[sessionId]?.conn !== conn) return;
      handleSocketMessage(socketDeps, sessionId, data);
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
}

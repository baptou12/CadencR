/**
 * Single source of truth for agent status on the frontend.
 *
 * The store mirrors the per-session entries the backend pushes on
 * `app/session_status.*` envelopes. Every UI surface that displays
 * "agent is working / asking / idle" reads from here:
 *
 * - the sidebar (`ProjectFeatureRow`) via `useFeatureStatus(featureId)`
 *   which aggregates per-session entries on the fly;
 * - the conversation badge (`AgentSession`) and the input bar's
 *   "disabled while running" check (`AgentPromptBar`) via
 *   `useSessionStatus(sessionId)`;
 * - the unified-agents sidebar button counter (`UnifiedAgentsSidebarLink`)
 *   and the unified-agents grid header counter (`UnifiedAgentsView`)
 *   via `useLiveWorkingCount(sessionDbIds)`;
 * - the unified-agents "Recent" filter (`UnifiedAgentsViewData`) via
 *   `useLiveActiveSessionIds()`.
 *
 * `ws-session-store.sessions[id].lifecycle` is a separate WS-driven
 * concept (turn-level state machine) used for cross-feature concerns
 * like `powerSaveBlocker`, app-close confirmation, and "Stop all
 * agents". It is NOT the live status — only this store is.
 *
 * Wire-format contract with the backend (`domain::session_status`):
 *
 * - `session_status.update` carries a monotonic global `seq`. We reject
 *   any update whose seq is <= the seq we already applied for that
 *   session — that closes the "old event arrives after new one" race.
 * - `session_status.snapshot` carries the global counter at the moment
 *   the backend built it. We merge per-session: an entry is only
 *   overwritten if its current seq is <= the snapshot's seq, so a fresh
 *   live update can't be wiped by a lag-recovery snapshot.
 *
 * Reducers and validators live in `./session-status-handlers` to keep
 * this file focused on the WS lifecycle and Zustand wiring.
 *
 * Conforms to `frontend-performance.md`: every consumer reads via a
 * narrow selector and never subscribes to the whole store.
 */
import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import type { LiveAgentStatus, PendingKind } from "@/types/agent";
import { createEnvelope, parseEnvelope } from "@/lib/ws-envelope";
import { getWsProtocols, getWsUrl } from "@/lib/ws-url";
import { useConnectionStatusStore } from "@/stores/connection-status-store";
import { registerReconnector, unregisterReconnector } from "@/lib/ws-reconnect";
import { useWsSessionStore } from "@/stores/ws-session-store";
import { updateSession } from "@/stores/ws-session-types";
import { transitionTurn, type TurnLifecycle } from "@/stores/ws-turn-lifecycle";
import {
  applySnapshot,
  applyUpdate,
  handleAppEnvelope,
  notifyTransition,
} from "@/stores/session-status-handlers";

const APP_WS_SOURCE = "app-ws";

export type { LiveAgentStatus, PendingKind };

/** Per-session entry as received from the backend. */
export interface SessionStatusEntry {
  status: LiveAgentStatus;
  /** Only populated when `status === "question"`. `null` for agent/idle. */
  kind: PendingKind | null;
  featureId: number;
  seq: number;
}

interface SessionStatusState {
  ws: WebSocket | null;
  isConnected: boolean;
  /** Per-session entries keyed by `session_id` (the DB primary key). */
  bySession: Record<number, SessionStatusEntry>;
  connect: () => void;
  disconnect: () => void;
}

const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30000;

type IntentionalCloseWebSocket = WebSocket & {
  __intentionalClose?: () => void;
};

export const useSessionStatusStore = create<SessionStatusState>((set, get) => {
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let reconnectDelay = RECONNECT_BASE_MS;

  function scheduleReconnect(): void {
    if (reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      get().connect();
    }, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX_MS);
  }

  function dispatchEnvelope(
    domain: string,
    action: string,
    payload: Record<string, unknown>,
  ): void {
    if (handleAppEnvelope(domain, action, payload)) return;
    if (domain !== "app") return;
    if (action === "session_status.snapshot") {
      const bySession = applySnapshot(get().bySession, payload);
      set({ bySession });
      syncWsLifecycles(
        Object.entries(bySession).map(([id, entry]) => ({
          id: Number(id),
          entry,
        })),
      );
      return;
    }
    if (action === "session_status.update") {
      const result = applyUpdate(get().bySession, payload);
      if (result.next) set({ bySession: result.next });
      if (result.nextStatus && typeof payload.session_id === "number") {
        syncWsLifecycle(payload.session_id, {
          status: result.nextStatus,
          kind: isPendingKindPayload(payload.kind) ? payload.kind : null,
        });
      }
      if (result.featureId != null && result.nextStatus) {
        notifyTransition(result.featureId, result.prevStatus, result.nextStatus);
      }
    }
  }

  return {
    ws: null,
    isConnected: false,
    bySession: {},

    connect() {
      // Register so the connection watchdog can force-reconnect us on
      // wake/online without us having to wait for a TCP-level close.
      registerReconnector(APP_WS_SOURCE, () => {
        const live = get().ws;
        if (live && live.readyState !== WebSocket.CLOSED) {
          (live as IntentionalCloseWebSocket).__intentionalClose?.();
          live.close();
        }
        set({ ws: null, isConnected: false });
        get().connect();
      });

      const existing = get().ws;
      if (
        existing &&
        (existing.readyState === WebSocket.OPEN || existing.readyState === WebSocket.CONNECTING)
      ) {
        return;
      }

      const protocols = getWsProtocols();
      const ws = new WebSocket(getWsUrl(), protocols.length ? protocols : undefined);
      // `intentionalClose` flips to true in `disconnect()` *before* we call
      // `ws.close()`. The close handler then knows not to schedule a
      // reconnect and not to scribble on the current `store.ws` (which may
      // already be a freshly-created replacement — see Strict Mode race).
      let intentionalClose = false;

      ws.addEventListener("open", () => {
        reconnectDelay = RECONNECT_BASE_MS;
        // Preserve `bySession` so sidebar icons don't blink during the
        // 100–300 ms window before the snapshot arrives. `applySnapshot`
        // reconciles per-session via the seq, so any stale entries
        // self-correct (older entries get overwritten; newer ones survive).
        set({ isConnected: true });
        useConnectionStatusStore.getState().reportSource(APP_WS_SOURCE, "connected");
        // The watchdog already calls `probeHealth()` from `forceReconnectAll`
        // on wake, and the periodic 15 s poll covers the standalone case.
        // Reporting `connected` here is sufficient to clear the indicator.
        ws.send(JSON.stringify(createEnvelope("app", "subscribe.session_status", {})));
      });

      // Guard against React Strict Mode double-mount races: a closing
      // socket may fire `close` after `connect()` has already replaced
      // `store.ws` with a new instance. Both store mutations are gated
      // by an instance check (`get().ws === ws`).
      ws.addEventListener("close", () => {
        if (get().ws === ws) {
          set({ isConnected: false, ws: null });
        }
        if (!intentionalClose) {
          useConnectionStatusStore
            .getState()
            .reportSource(APP_WS_SOURCE, "reconnecting", "App WebSocket dropped");
          scheduleReconnect();
        } else {
          useConnectionStatusStore.getState().clearSource(APP_WS_SOURCE);
        }
      });

      ws.addEventListener("error", () => {
        if (get().ws === ws) set({ isConnected: false });
        if (!intentionalClose) {
          useConnectionStatusStore
            .getState()
            .reportSource(APP_WS_SOURCE, "reconnecting", "App WebSocket error");
        }
      });

      ws.addEventListener("message", (event) => {
        let envelope: ReturnType<typeof parseEnvelope>;
        try {
          envelope = parseEnvelope(event.data as string);
        } catch {
          return; // unparseable — skip
        }
        try {
          dispatchEnvelope(
            envelope.domain,
            envelope.action,
            envelope.payload as Record<string, unknown>,
          );
        } catch (err) {
          console.error("[session-status] dispatchEnvelope error:", err);
        }
      });

      (ws as IntentionalCloseWebSocket).__intentionalClose = () => {
        intentionalClose = true;
      };

      set({ ws });
    },

    disconnect() {
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      unregisterReconnector(APP_WS_SOURCE);
      useConnectionStatusStore.getState().clearSource(APP_WS_SOURCE);
      const ws = get().ws;
      if (ws) {
        (ws as IntentionalCloseWebSocket).__intentionalClose?.();
        ws.close();
      }
      set({ ws: null, isConnected: false });
    },
  };
});

function syncWsLifecycles(
  entries: Array<{
    id: number;
    entry: Pick<SessionStatusEntry, "status" | "kind">;
  }>,
): void {
  for (const { id, entry } of entries) syncWsLifecycle(id, entry);
}

function syncWsLifecycle(
  sessionDbId: number,
  entry: Pick<SessionStatusEntry, "status" | "kind">,
): void {
  const store = useWsSessionStore.getState();
  const match = Object.entries(store.sessions).find(
    ([, session]) => session.sessionDbId === sessionDbId,
  );
  if (!match) return;
  const [sessionId, session] = match;
  const lifecycle = lifecycleFromStatus(session.lifecycle, entry.status, entry.kind);
  if (lifecycle === session.lifecycle) return;
  useWsSessionStore.setState(updateSession(store, sessionId, { lifecycle }));
}

function lifecycleFromStatus(
  lifecycle: TurnLifecycle,
  status: LiveAgentStatus,
  kind: PendingKind | null,
): TurnLifecycle {
  if (status === "agent") return transitionTurn(lifecycle, { type: "stream_activity" });
  if (status === "question") {
    return transitionTurn(lifecycle, {
      type: kind === "question" ? "question_requested" : "permission_requested",
    });
  }
  if (status === "idle" && (lifecycle.phase === "active" || lifecycle.phase === "paused")) {
    return transitionTurn(lifecycle, {
      type: "turn_ended",
      reason: "completed",
    });
  }
  return lifecycle;
}

function isPendingKindPayload(value: unknown): value is PendingKind {
  return value === "permission" || value === "question";
}

/**
 * Reduce per-session entries down to a single feature-level
 * `(status, kind)`. Mirrors the Rust `aggregate_feature` used in tests.
 *
 * Question wins over Agent wins over Idle. When two sessions are both
 * Question, the entry with the lower `session_id` wins (deterministic).
 */
export function aggregateFeatureStatus(entries: readonly SessionStatusEntry[]): {
  status: LiveAgentStatus;
  kind: PendingKind | null;
} {
  let best: { status: LiveAgentStatus; kind: PendingKind | null } = {
    status: "idle",
    kind: null,
  };
  for (const e of entries) {
    if (e.status === "question") {
      if (best.status !== "question") {
        best = { status: "question", kind: e.kind };
      }
    } else if (e.status === "agent" && best.status === "idle") {
      best = { status: "agent", kind: null };
    }
  }
  return best;
}

const EMPTY_FEATURE_STATUS: {
  status: LiveAgentStatus;
  kind: PendingKind | null;
} = {
  status: "idle",
  kind: null,
};

/**
 * Per-session selector. Returns `null` when the store has no entry for
 * `sessionId` — callers should treat that as Idle (no event has yet
 * driven this session out of the default).
 */
export function useSessionStatus(sessionId: number | null | undefined): SessionStatusEntry | null {
  return useSessionStatusStore((s) =>
    sessionId == null ? null : (s.bySession[sessionId] ?? null),
  );
}

/**
 * Per-feature aggregate. `useShallow` skips re-rendering when the
 * resulting `{status, kind}` pair is unchanged across store mutations —
 * so a Delta-driven seq bump on an unrelated session never reaches React.
 */
export function useFeatureStatus(featureId: number | null | undefined): {
  status: LiveAgentStatus;
  kind: PendingKind | null;
} {
  return useSessionStatusStore(
    useShallow((s) => {
      if (featureId == null) return EMPTY_FEATURE_STATUS;
      const entries: SessionStatusEntry[] = [];
      for (const entry of Object.values(s.bySession)) {
        if (entry.featureId === featureId) entries.push(entry);
      }
      return aggregateFeatureStatus(entries);
    }),
  );
}

/**
 * Count of sessions in the given id set whose live status is `"agent"`
 * (actively working). Used by the unified-agents grid header so the
 * "running" badge stays in lock-step with the canonical live store
 * for sessions visible in the current grid. Returning a number means
 * unrelated seq bumps don't re-render the consumer.
 */
export function useLiveWorkingCount(sessionIds: readonly number[]): number {
  return useSessionStatusStore((s) => {
    let count = 0;
    for (const id of sessionIds) {
      if (s.bySession[id]?.status === "agent") count++;
    }
    return count;
  });
}

/**
 * Global count of `agent`-status sessions across the whole store —
 * regardless of any REST filter. Used by the unified-agents sidebar
 * button so a newly-started agent that hasn't appeared in the cached
 * `useGetUnifiedAgents` response yet still bumps the counter the
 * moment its `session_status.update` lands. (The REST query is
 * configured with `staleTime: Infinity` and won't refetch on its own.)
 */
export function useLiveTotalWorkingCount(): number {
  return useSessionStatusStore((s) => {
    let count = 0;
    for (const entry of Object.values(s.bySession)) {
      if (entry.status === "agent") count++;
    }
    return count;
  });
}

/**
 * Returns the sorted list of `sessionDbId`s with non-idle live status
 * (i.e. the agent is either working or asking). Used by the unified-agents
 * grid "Recent" filter to keep an agent visible while it's still active,
 * even if its REST `last_activity_at` is older than the freshness window.
 *
 * Sorted + array-shaped so `useShallow` can element-compare and skip
 * re-renders on `seq` bumps that don't change membership. Consumers that
 * need O(1) lookup should wrap this in a `Set` via `useMemo`.
 */
export function useLiveActiveSessionIds(): readonly number[] {
  return useSessionStatusStore(
    useShallow((s) => {
      const ids: number[] = [];
      for (const [k, v] of Object.entries(s.bySession)) {
        if (v.status !== "idle") ids.push(Number(k));
      }
      ids.sort((a, b) => a - b);
      return ids;
    }),
  );
}

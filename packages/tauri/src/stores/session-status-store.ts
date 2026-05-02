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
 *   `useSessionStatus(sessionId)`.
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
 * Kept deliberately small (one entry shape, two reducers, two hooks).
 * Conforms to `frontend-performance.md`: every consumer reads via a
 * narrow selector and never subscribes to the whole store.
 */
import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import type { LiveAgentStatus, PendingKind } from "@/types/agent";
import { createEnvelope, parseEnvelope } from "@/lib/ws-envelope";
import { queryClient } from "@/lib/queryClient";
import { getWsProtocols, getWsUrl } from "@/lib/ws-url";
import { notifyAgentDone, notifyAgentNeedsInput } from "@/lib/notify-agent-done";
import { invalidateByUrlPrefix } from "@/lib/queryClient";
import { getListFeaturesQueryKey, type Feature } from "@/api/generated";

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

const STATUS_VALUES: LiveAgentStatus[] = ["idle", "agent", "question"];
const PENDING_KIND_VALUES: PendingKind[] = [
  "permission",
  "question",
  "plan-approval",
  "prd-approval",
];

function isStatus(val: unknown): val is LiveAgentStatus {
  return typeof val === "string" && (STATUS_VALUES as string[]).includes(val);
}

function isPendingKind(val: unknown): val is PendingKind {
  return typeof val === "string" && (PENDING_KIND_VALUES as string[]).includes(val);
}

function lookupFeature(featureId: number): Feature | undefined {
  // Prefix-match all per-project listFeatures caches via the orval-generated key.
  const queries = queryClient.getQueriesData<Feature[]>({ queryKey: getListFeaturesQueryKey() });
  if (!queries) return undefined;
  for (const [, data] of queries) {
    const feature = data?.find((f) => f.id === featureId);
    if (feature) return feature;
  }
  return undefined;
}

function notifyTransition(
  featureId: number,
  prevStatus: LiveAgentStatus | undefined,
  nextStatus: LiveAgentStatus,
): void {
  const feature = lookupFeature(featureId);
  if (!feature) return;
  const routeType = feature.type === "ws-session" ? ("session" as const) : ("workflow" as const);
  const opts = {
    featureTitle: feature.title,
    featureId,
    projectId: feature.project_id,
    routeType,
  };
  if (nextStatus === "question" && prevStatus !== "question") {
    notifyAgentNeedsInput(opts);
  } else if (nextStatus === "idle" && prevStatus === "agent") {
    notifyAgentDone({ ...opts, status: "completed" });
  }
}

const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30000;

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

  function handleSnapshot(payload: Record<string, unknown>): void {
    const rawStates = (payload.states ?? {}) as Record<string, unknown>;
    const snapshotSeq = typeof payload.seq === "number" ? payload.seq : 0;
    const prev = get().bySession;

    const next: Record<number, SessionStatusEntry> = {};

    for (const [idKey, entryRaw] of Object.entries(rawStates)) {
      const sessionId = Number(idKey);
      if (!Number.isFinite(sessionId)) continue;
      if (!entryRaw || typeof entryRaw !== "object") continue;
      const obj = entryRaw as Record<string, unknown>;
      const featureId = typeof obj.feature_id === "number" ? obj.feature_id : null;
      if (featureId == null) continue;
      const status = isStatus(obj.status) ? obj.status : null;
      if (!status) continue;
      const kind = isPendingKind(obj.kind) ? obj.kind : null;

      // Preserve a more recent live entry if it has overtaken the snapshot.
      const existing = prev[sessionId];
      if (existing && existing.seq > snapshotSeq) {
        next[sessionId] = existing;
        continue;
      }
      next[sessionId] = { status, kind, featureId, seq: snapshotSeq };

      if (status === "question" && existing?.status !== "question") {
        notifyTransition(featureId, existing?.status, status);
      }
    }

    // Carry over live entries with seq > snapshotSeq that the snapshot
    // didn't include (the backend filters Idle entries from snapshots, so
    // a live "agent" event arriving just before the snapshot must be
    // preserved here).
    for (const [idKey, entry] of Object.entries(prev)) {
      const sessionId = Number(idKey);
      if (!Number.isFinite(sessionId)) continue;
      if (sessionId in next) continue;
      if (entry.seq > snapshotSeq) {
        next[sessionId] = entry;
      }
    }

    set({ bySession: next });
  }

  function handleUpdate(payload: Record<string, unknown>): void {
    const sessionId = typeof payload.session_id === "number" ? payload.session_id : null;
    const featureId = typeof payload.feature_id === "number" ? payload.feature_id : null;
    const seq = typeof payload.seq === "number" ? payload.seq : 0;
    if (sessionId == null || featureId == null) return;
    if (!isStatus(payload.status)) return;
    const kind = isPendingKind(payload.kind) ? payload.kind : null;

    const prev = get().bySession[sessionId];
    if (prev && seq <= prev.seq) {
      // Out-of-order — drop.
      return;
    }

    const sameValue =
      prev?.status === payload.status &&
      (prev?.kind ?? null) === kind &&
      prev?.featureId === featureId;

    if (sameValue) {
      // No-op: seq is global-monotonic so the next event is still > prev.seq.
      // Skipping the `set` keeps every selector subscribed to `bySession`
      // referentially stable through the long Agent-streaming runs.
      return;
    }

    set((state) => ({
      bySession: {
        ...state.bySession,
        [sessionId]: { status: payload.status as LiveAgentStatus, kind, featureId, seq },
      },
    }));

    notifyTransition(featureId, prev?.status, payload.status as LiveAgentStatus);
  }

  function handleEnvelope(domain: string, action: string, payload: Record<string, unknown>): void {
    if (domain === "editor" && action === "file_tree.changed") {
      // Fold the editor + git-stats + git-diff invalidations into a single
      // cache walk. Same logic the legacy app-ws-store had — moved here
      // so we keep one app-level WS connection for the whole frontend.
      void invalidateByUrlPrefix(queryClient, [
        "/api/editor/tree",
        "/api/editor/search",
        "/api/git/stats",
        "/api/git/diff",
      ]);
      return;
    }

    if (domain !== "app") return;
    if (action === "session_status.snapshot") handleSnapshot(payload);
    else if (action === "session_status.update") handleUpdate(payload);
  }

  return {
    ws: null,
    isConnected: false,
    bySession: {},

    connect() {
      const existing = get().ws;
      if (
        existing &&
        (existing.readyState === WebSocket.OPEN || existing.readyState === WebSocket.CONNECTING)
      ) {
        return;
      }

      const protocols = getWsProtocols();
      const ws = new WebSocket(getWsUrl(), protocols.length ? protocols : undefined);

      ws.addEventListener("open", () => {
        reconnectDelay = RECONNECT_BASE_MS;
        // Preserve `bySession` so sidebar icons don't blink during the
        // 100–300 ms window before the snapshot arrives. `handleSnapshot`
        // reconciles per-session via the seq, so any stale entries
        // self-correct (older entries get overwritten; newer ones survive).
        set({ isConnected: true });
        ws.send(JSON.stringify(createEnvelope("app", "subscribe.session_status", {})));
      });

      ws.addEventListener("close", () => {
        set({ isConnected: false, ws: null });
        scheduleReconnect();
      });

      ws.addEventListener("error", () => {
        set({ isConnected: false });
      });

      ws.addEventListener("message", (event) => {
        let envelope: ReturnType<typeof parseEnvelope>;
        try {
          envelope = parseEnvelope(event.data as string);
        } catch {
          return; // unparseable — skip
        }
        try {
          handleEnvelope(
            envelope.domain,
            envelope.action,
            envelope.payload as Record<string, unknown>,
          );
        } catch (err) {
          console.error("[session-status] handleEnvelope error:", err);
        }
      });

      set({ ws });
    },

    disconnect() {
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      const ws = get().ws;
      if (ws) {
        ws.close();
      }
      set({ ws: null, isConnected: false });
    },
  };
});

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

const EMPTY_FEATURE_STATUS: { status: LiveAgentStatus; kind: PendingKind | null } = {
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

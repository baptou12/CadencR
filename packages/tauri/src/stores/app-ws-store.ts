/**
 * Global app-level WebSocket store for cross-feature concerns.
 *
 * Handles: turn state broadcasting (seq-ordered to reject stale events).
 * Connects on app mount, reconnects with backoff on disconnect.
 *
 * Ordering contract with the backend (see `app_state::TurnStateBroadcaster`):
 *
 * - `turn_states.update` carries a monotonic global `seq`. If the incoming
 *   `seq` is <= the per-feature seq we've already applied, ignore it —
 *   something older caught up with us.
 * - `turn_states.snapshot` carries the current global `seq` at the moment
 *   the backend built it. We merge per-feature: for each feature we only
 *   overwrite entries whose per-feature seq is <= the snapshot's seq. This
 *   closes the "lag-recovery snapshot wipes a fresh live update" race.
 */
import { create } from "zustand";
import { createEnvelope, parseEnvelope } from "@/lib/ws-envelope";
import { queryClient } from "@/lib/queryClient";
import { getWsProtocols, getWsUrl } from "@/lib/ws-url";
import { notifyAgentDone, notifyAgentNeedsInput } from "@/lib/notify-agent-done";
import { invalidateByUrlPrefix } from "@/lib/queryClient";
import { getListFeaturesQueryKey, type Feature } from "@/api/generated";

export type TurnState = "agent" | "askUser";
export type PendingKind = "question" | "permission" | "plan-approval" | "prd-approval";

/** Per-feature turn state as received from the backend. */
export interface FeatureTurnStateEntry {
  turn: TurnState;
  /** Only populated when `turn === "askUser"` (from snapshot) or when a live
   *  update tagged a specific kind. `null` for "agent" turns. */
  kind: PendingKind | null;
}

interface AppWsState {
  ws: WebSocket | null;
  isConnected: boolean;
  featureTurnStates: Record<number, FeatureTurnStateEntry>;
  /** Per-feature seq of the most recent `turn_states.update` we applied. */
  featureTurnStateSeqs: Record<number, number>;
  connect: () => void;
  disconnect: () => void;
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

function isTurn(val: unknown): val is TurnState {
  return val === "agent" || val === "askUser";
}

function isPendingKind(val: unknown): val is PendingKind {
  return (
    val === "question" || val === "permission" || val === "plan-approval" || val === "prd-approval"
  );
}

function notifyFor(
  featureId: number,
  turn: TurnState | "none",
  prevTurn: TurnState | undefined,
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
  if (turn === "askUser" && prevTurn !== "askUser") {
    notifyAgentNeedsInput(opts);
  } else if (turn === "none" && prevTurn === "agent") {
    notifyAgentDone({ ...opts, status: "completed" });
  }
}

const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30000;

export const useAppWsStore = create<AppWsState>((set, get) => {
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
    const prevStates = get().featureTurnStates;
    const prevSeqs = get().featureTurnStateSeqs;

    const nextStates: Record<number, FeatureTurnStateEntry> = {};
    const nextSeqs: Record<number, number> = {};

    // Snapshot merges with live state per-feature: keep any feature whose
    // last live seq is newer than this snapshot's seq, because those updates
    // are authoritative.
    for (const [idKey, entryRaw] of Object.entries(rawStates)) {
      const featureId = Number(idKey);
      if (!Number.isFinite(featureId)) continue;
      const lastSeq = prevSeqs[featureId] ?? 0;
      if (lastSeq > snapshotSeq) {
        // Preserve live state. Keep the seq even when the live entry is a
        // tombstone (deleted via a `"none"` update) — otherwise a later
        // stale update with seq < lastSeq could resurrect the entry.
        nextSeqs[featureId] = lastSeq;
        const existing = prevStates[featureId];
        if (existing) nextStates[featureId] = existing;
        continue;
      }
      // Parse entry: backend sends `{ turn, kind? }` today. Legacy shape
      // (raw string) is tolerated for forward compatibility.
      let turn: TurnState | null = null;
      let kind: PendingKind | null = null;
      if (typeof entryRaw === "string" && isTurn(entryRaw)) {
        turn = entryRaw;
      } else if (entryRaw && typeof entryRaw === "object") {
        const obj = entryRaw as Record<string, unknown>;
        if (isTurn(obj.turn)) turn = obj.turn;
        if (isPendingKind(obj.kind)) kind = obj.kind;
      }
      if (!turn) continue;

      const prev = prevStates[featureId]?.turn;
      nextStates[featureId] = { turn, kind };
      nextSeqs[featureId] = snapshotSeq;

      // Fire "needs input" notification if the snapshot is the first time we
      // learn this feature is waiting. Prevents losing the notification when
      // the live update was delivered before the client connected.
      if (turn === "askUser" && prev !== "askUser") {
        notifyFor(featureId, "askUser", prev);
      }
    }

    // Features NOT present in the snapshot but present in the live map with a
    // higher per-feature seq must also be preserved. We preserve the seq even
    // when there is no live entry (tombstone case: a `"none"` update deleted
    // the entry but kept its seq). Dropping the seq here would let a later
    // stale update with an older seq slip through.
    for (const [idKey, seq] of Object.entries(prevSeqs)) {
      const featureId = Number(idKey);
      if (seq > snapshotSeq && !(featureId in nextSeqs)) {
        nextSeqs[featureId] = seq;
        const existing = prevStates[featureId];
        if (existing) {
          nextStates[featureId] = existing;
        }
      }
    }

    set({ featureTurnStates: nextStates, featureTurnStateSeqs: nextSeqs });
  }

  function handleUpdate(payload: Record<string, unknown>): void {
    const featureId = typeof payload.feature_id === "number" ? payload.feature_id : null;
    const turnRaw = payload.turn;
    const seq = typeof payload.seq === "number" ? payload.seq : 0;
    const kindRaw = payload.kind;
    if (featureId == null || typeof turnRaw !== "string") return;

    const prevSeq = get().featureTurnStateSeqs[featureId] ?? 0;
    if (seq <= prevSeq && prevSeq !== 0) {
      // Out-of-order event — drop it.
      return;
    }

    const prevEntry = get().featureTurnStates[featureId];
    const prevTurn = prevEntry?.turn;
    const nextKind = isPendingKind(kindRaw) ? kindRaw : null;
    const valueUnchanged = isTurn(turnRaw)
      ? prevEntry?.turn === turnRaw && (prevEntry?.kind ?? null) === nextKind
      : prevEntry === undefined;
    set((state) => {
      // Seq always advances; only rebuild the states map when the value changed
      // so selectors that don't care about seq avoid a re-render.
      const nextSeqs = { ...state.featureTurnStateSeqs, [featureId]: seq };
      if (valueUnchanged) {
        return { featureTurnStateSeqs: nextSeqs };
      }
      const nextStates = { ...state.featureTurnStates };
      if (isTurn(turnRaw)) {
        nextStates[featureId] = { turn: turnRaw, kind: nextKind };
      } else {
        delete nextStates[featureId];
      }
      return { featureTurnStates: nextStates, featureTurnStateSeqs: nextSeqs };
    });

    if (turnRaw === "askUser") {
      notifyFor(featureId, "askUser", prevTurn);
    } else if (turnRaw === "none") {
      notifyFor(featureId, "none", prevTurn);
    }
  }

  function handleEnvelope(domain: string, action: string, payload: Record<string, unknown>): void {
    if (domain === "editor" && action === "file_tree.changed") {
      // Fold the editor + git-stats invalidations into a single cache walk.
      void invalidateByUrlPrefix(queryClient, [
        "/api/editor/tree",
        "/api/editor/search",
        "/api/git/stats",
      ]);
      return;
    }

    if (domain !== "app") return;

    if (action === "turn_states.snapshot") {
      handleSnapshot(payload);
    } else if (action === "turn_states.update") {
      handleUpdate(payload);
    }
  }

  return {
    ws: null,
    isConnected: false,
    featureTurnStates: {},
    featureTurnStateSeqs: {},

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
        // Reset ONLY the seq counter. The backend seq counter is process-local
        // and resets to 0 on service restart, so stale client-side seqs would
        // reject every fresh update as "older" than what we already applied.
        // Preserve `featureTurnStates` so sidebar icons don't blink during the
        // 100–300 ms window before the snapshot arrives. `handleSnapshot`
        // already reconciles per-feature via the seq, so any stale entries
        // self-correct (tombstones remove; newer seqs overwrite).
        set({ isConnected: true, featureTurnStateSeqs: {} });
        // Subscribe to turn state broadcasts
        ws.send(JSON.stringify(createEnvelope("app", "subscribe.turn_states", {})));
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
          return; // genuinely unparseable — skip
        }
        try {
          handleEnvelope(
            envelope.domain,
            envelope.action,
            envelope.payload as Record<string, unknown>,
          );
        } catch (err) {
          console.error("[app-ws] handleEnvelope error:", err);
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

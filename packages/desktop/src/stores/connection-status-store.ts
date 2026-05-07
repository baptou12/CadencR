/**
 * Single source of truth for "is the backend reachable right now?".
 *
 * Inputs:
 *  - Each long-lived WebSocket (`ws-session`, terminal, workflow, session-
 *    status) reports its own state as a "source" via `reportSource`.
 *  - A periodic `/api/health` probe (every 15 s, plus on-demand via the
 *    watchdog) reports under the `health` source. The probe catches the
 *    "service hung but socket still open" case that WS events alone can't.
 *
 * Aggregation:
 *  - If the `health` source is `disconnected` -> global = `disconnected`
 *    (with the HTTP error as reason). This is the only path that produces
 *    a red indicator + error toast.
 *  - Else if any source is `reconnecting` -> global = `reconnecting`
 *    (amber indicator). No toast.
 *  - Else -> `connected`.
 *
 * Transitions to `disconnected` are debounced by 2 s before firing the
 * error toast so we don't spam the user during transient WS blips.
 *
 * The store also owns `forceReconnectAll()` which the watchdog calls on
 * sleep/wake. It pokes the WS reconnect registry (`lib/ws-reconnect`) and
 * runs an immediate health probe.
 */

import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import { toast } from "sonner";
import { pingHealth } from "@/api/client";
import { forceReconnectAll as forceReconnectAllWs } from "@/lib/ws-reconnect";

export type ConnectionStatus = "connected" | "reconnecting" | "disconnected";

interface SourceState {
  status: ConnectionStatus;
  reason: string | null;
}

interface ConnectionStatusState {
  status: ConnectionStatus;
  reason: string | null;
  /** Wall-clock millis of the last time we observed a healthy `connected`. */
  lastConnectedAt: number | null;
  /** Internal: per-source latest report so we can recompute on changes. */
  sources: Record<string, SourceState>;
  reportSource: (key: string, status: ConnectionStatus, reason?: string | null) => void;
  clearSource: (key: string) => void;
  /** Force every registered WS reconnector + a fresh health probe. */
  forceReconnectAll: () => void;
  /** Run a one-off health probe and update the `health` source. */
  probeHealth: () => Promise<void>;
}

/** Health-probe source key. The aggregator treats this one specially. */
const HEALTH_KEY = "health";
/** Disconnected toast debounce — short enough to feel responsive, long
 *  enough to skip transient WS reshuffles during navigation. */
const DISCONNECTED_TOAST_DEBOUNCE_MS = 2000;

function aggregate(sources: Record<string, SourceState>): {
  status: ConnectionStatus;
  reason: string | null;
} {
  const health = sources[HEALTH_KEY];
  if (health?.status === "disconnected") {
    return { status: "disconnected", reason: health.reason };
  }
  let reconnecting: SourceState | null = null;
  for (const [key, src] of Object.entries(sources)) {
    if (key === HEALTH_KEY) continue;
    if (src.status === "reconnecting") {
      reconnecting = src;
      break;
    }
  }
  if (reconnecting) {
    return { status: "reconnecting", reason: reconnecting.reason };
  }
  return { status: "connected", reason: null };
}

export const useConnectionStatusStore = create<ConnectionStatusState>((set, get) => ({
  status: "connected",
  reason: null,
  // Don't claim a `connected` timestamp at module load — we haven't
  // observed any source reach `connected` yet. The first transition from
  // !connected -> connected will set this.
  lastConnectedAt: null,
  sources: {},

  reportSource(key, status, reason = null) {
    const prev = get().sources[key];
    if (prev?.status === status && (prev.reason ?? null) === reason) return;
    const sources = { ...get().sources, [key]: { status, reason } };
    const agg = aggregate(sources);
    const wasConnected = get().status === "connected";
    set({
      sources,
      status: agg.status,
      reason: agg.reason,
      lastConnectedAt:
        agg.status === "connected" && !wasConnected ? Date.now() : get().lastConnectedAt,
    });
  },

  clearSource(key) {
    if (!(key in get().sources)) return;
    const sources = { ...get().sources };
    delete sources[key];
    const agg = aggregate(sources);
    const wasConnected = get().status === "connected";
    set({
      sources,
      status: agg.status,
      reason: agg.reason,
      lastConnectedAt:
        agg.status === "connected" && !wasConnected ? Date.now() : get().lastConnectedAt,
    });
  },

  async probeHealth(): Promise<void> {
    const result = await pingHealth();
    if (result.ok) {
      get().reportSource(HEALTH_KEY, "connected");
    } else {
      get().reportSource(HEALTH_KEY, "disconnected", result.reason);
    }
  },

  forceReconnectAll() {
    forceReconnectAllWs();
    void get().probeHealth();
  },
}));

// ─── Toast wiring ──────────────────────────────────────────────────────
//
// One module-level subscription so transitions fire exactly once. Component
// subscribers would multiply per mount and double-toast.
let pendingDisconnectedToast: ReturnType<typeof setTimeout> | null = null;
const DISCONNECTED_TOAST_ID = "backend-disconnected";
const RECONNECTED_TOAST_ID = "backend-reconnected";

useConnectionStatusStore.subscribe((state, prev) => {
  if (state.status === prev.status) return;

  if (state.status === "disconnected") {
    // Debounce: only show the error after we've been disconnected for >2s.
    if (pendingDisconnectedToast) clearTimeout(pendingDisconnectedToast);
    pendingDisconnectedToast = setTimeout(() => {
      pendingDisconnectedToast = null;
      const current = useConnectionStatusStore.getState();
      if (current.status !== "disconnected") return;
      toast.error(`Backend disconnected — ${current.reason ?? "unreachable"}`, {
        id: DISCONNECTED_TOAST_ID,
        duration: Infinity,
      });
    }, DISCONNECTED_TOAST_DEBOUNCE_MS);
    return;
  }

  // Recovered or shifted to reconnecting — clear pending error toast.
  if (pendingDisconnectedToast) {
    clearTimeout(pendingDisconnectedToast);
    pendingDisconnectedToast = null;
  }

  if (state.status === "connected") {
    toast.dismiss(DISCONNECTED_TOAST_ID);
    if (prev.status === "disconnected" || prev.status === "reconnecting") {
      toast.success("Reconnected to backend", { id: RECONNECTED_TOAST_ID, duration: 3000 });
    }
  }
});

// ─── Periodic health poll ──────────────────────────────────────────────
//
// 15 s is a deliberate compromise: tight enough to catch a hung backend
// inside the connection-recovery window most users notice (~20 s after
// they wake the laptop), loose enough that it doesn't show up in network
// inspectors as chatter. The watchdog hook adds on-demand probes for
// wake/online events so we don't have to wait a full interval there.
const HEALTH_POLL_INTERVAL_MS = 15_000;

let healthPollTimer: ReturnType<typeof setInterval> | null = null;

export function startHealthPolling(): void {
  if (healthPollTimer) return;
  // Don't run an initial probe at module-load time — main.tsx awaits the
  // backend before mounting anyway, and an extra probe at boot would race
  // the WS opens. The first scheduled tick fires after the interval.
  healthPollTimer = setInterval(() => {
    void useConnectionStatusStore.getState().probeHealth();
  }, HEALTH_POLL_INTERVAL_MS);
}

export function stopHealthPolling(): void {
  if (healthPollTimer) {
    clearInterval(healthPollTimer);
    healthPollTimer = null;
  }
}

// ─── Selectors ─────────────────────────────────────────────────────────

/**
 * Narrow selector for the indicator UI; never subscribes to `sources`.
 * Wrapped in `useShallow` so the consumer only re-renders when one of
 * the three primitive fields actually changes.
 */
export function useConnectionStatus(): {
  status: ConnectionStatus;
  reason: string | null;
  lastConnectedAt: number | null;
} {
  return useConnectionStatusStore(
    useShallow((s) => ({
      status: s.status,
      reason: s.reason,
      lastConnectedAt: s.lastConnectedAt,
    })),
  );
}

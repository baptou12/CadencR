/**
 * Global app-level WebSocket store for cross-feature concerns.
 *
 * Currently handles: turn state broadcasting (replaces 3s HTTP polling).
 * Connects on app mount, reconnects with backoff on disconnect.
 */
import { create } from "zustand";
import { createEnvelope, parseEnvelope } from "@/lib/ws-envelope";
import { queryClient } from "@/lib/queryClient";
import { getWsProtocols, getWsUrl } from "@/lib/ws-url";
import { notifyAgentDone, notifyAgentNeedsInput } from "@/lib/notify-agent-done";
import type { Feature } from "@/api/generated";

type TurnState = "claude" | "askUser";

interface AppWsState {
  ws: WebSocket | null;
  isConnected: boolean;
  featureTurnStates: Record<number, TurnState>;
  connect: () => void;
  disconnect: () => void;
}

function lookupFeature(featureId: number): Feature | undefined {
  for (const [, data] of queryClient.getQueriesData<Feature[]>({ queryKey: ["features", "list"] })) {
    const feature = data?.find(f => f.id === featureId);
    if (feature) return feature;
  }
  return undefined;
}

const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30000;

export const useAppWsStore = create<AppWsState>((set, get) => {
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let reconnectDelay = RECONNECT_BASE_MS;

  function scheduleReconnect() {
    if (reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      get().connect();
    }, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX_MS);
  }

  function handleEnvelope(domain: string, action: string, payload: Record<string, unknown>) {
    // File tree change events from the file watcher
    if (domain === "editor" && action === "file_tree.changed") {
      void queryClient.invalidateQueries({ queryKey: ["editor", "tree"] });
      void queryClient.invalidateQueries({ queryKey: ["editor", "search"] });
      return;
    }

    if (domain !== "app") return;

    if (action === "turn_states.snapshot") {
      const states = (payload.states ?? {}) as Record<string, string>;
      const mapped: Record<number, TurnState> = {};
      for (const [key, val] of Object.entries(states)) {
        if (val === "claude" || val === "askUser") {
          mapped[Number(key)] = val;
        }
      }
      set({ featureTurnStates: mapped });
    } else if (action === "turn_states.update") {
      const featureId = payload.feature_id as number;
      const turn = payload.turn as string;
      const prevTurn = get().featureTurnStates[featureId];
      set((state) => {
        const next = { ...state.featureTurnStates };
        if (turn === "claude" || turn === "askUser") {
          next[featureId] = turn;
        } else {
          delete next[featureId];
        }
        return { featureTurnStates: next };
      });

      // Trigger notifications on turn transitions
      const feature = lookupFeature(featureId);
      if (feature) {
        const routeType = feature.type === "ws-session" ? "session" as const : "workflow" as const;
        const opts = { featureTitle: feature.title, featureId, projectId: feature.project_id, routeType };
        if (turn === "askUser") {
          notifyAgentNeedsInput(opts);
        } else if (turn === "none" && prevTurn === "claude") {
          notifyAgentDone({ ...opts, status: "completed" });
        }
      }
    }
  }

  return {
    ws: null,
    isConnected: false,
    featureTurnStates: {},

    connect() {
      const existing = get().ws;
      if (existing && (existing.readyState === WebSocket.OPEN || existing.readyState === WebSocket.CONNECTING)) {
        return;
      }

      const protocols = getWsProtocols();
      const ws = new WebSocket(getWsUrl(), protocols.length ? protocols : undefined);

      ws.addEventListener("open", () => {
        reconnectDelay = RECONNECT_BASE_MS;
        set({ isConnected: true });
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
          handleEnvelope(envelope.domain, envelope.action, envelope.payload as Record<string, unknown>);
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

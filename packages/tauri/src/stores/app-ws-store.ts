/**
 * Global app-level WebSocket store for cross-feature concerns.
 *
 * Currently handles: turn state broadcasting (replaces 3s HTTP polling).
 * Connects on app mount, reconnects with backoff on disconnect.
 */
import { create } from "zustand";
import { createEnvelope, parseEnvelope } from "@/lib/ws-envelope";

function getWsUrl(): string {
  const httpUrl = import.meta.env.VITE_API_URL || "http://localhost:5005";
  return httpUrl.replace(/^http/, "ws") + "/ws";
}

export type TurnState = "claude" | "askUser";

interface AppWsState {
  ws: WebSocket | null;
  isConnected: boolean;
  featureTurnStates: Record<number, TurnState>;
  connect: () => void;
  disconnect: () => void;
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
      set((state) => {
        const next = { ...state.featureTurnStates };
        if (turn === "claude" || turn === "askUser") {
          next[featureId] = turn;
        } else {
          delete next[featureId];
        }
        return { featureTurnStates: next };
      });
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

      const ws = new WebSocket(getWsUrl());

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
        try {
          const envelope = parseEnvelope(event.data as string);
          handleEnvelope(envelope.domain, envelope.action, envelope.payload as Record<string, unknown>);
        } catch {
          // Ignore unparseable messages
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

import type { SessionEntry, WsSessionStore } from "./ws-session-types";

// Types for the store accessors we need

export interface StoreAccessors {
  get: () => WsSessionStore;
  set: (partial: Partial<WsSessionStore>) => void;
  getSession: (sessionId: string) => SessionEntry;
}

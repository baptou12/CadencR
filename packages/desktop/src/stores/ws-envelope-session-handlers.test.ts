import { describe, expect, it } from "vitest";

import { handleInitialized } from "./ws-envelope-session-handlers";
import { createSessionEntry, type SessionEntry, type WsSessionStore } from "./ws-session-types";
import type { StoreAccessors } from "./ws-envelope-types";

function createTestContext(session: SessionEntry): StoreAccessors {
  let state = { sessions: { s1: session } } as unknown as WsSessionStore;

  return {
    get: (): WsSessionStore => state,
    set: (partial: Partial<WsSessionStore>): void => {
      state = { ...state, ...partial };
    },
    getSession: (sessionId: string): SessionEntry => state.sessions[sessionId],
  };
}

describe("handleInitialized", () => {
  it("copies the numeric backend session id into sessionDbId for live status lookup", () => {
    const ctx = createTestContext(createSessionEntry());

    handleInitialized(ctx, "s1", {
      session_id: "123",
      provider: "codex_cli",
    });

    expect(ctx.getSession("s1").serverSessionId).toBe("123");
    expect(ctx.getSession("s1").sessionDbId).toBe(123);
  });
});

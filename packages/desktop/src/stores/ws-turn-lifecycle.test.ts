import { describe, expect, it } from "vitest";
import { persistedSessionToLifecycle } from "./ws-turn-lifecycle";
import type { SessionState } from "@/api/generated";

function session(overrides: Partial<SessionState> = {}): SessionState {
  return {
    agentType: "session",
    blocks: [],
    hasFileChanges: false,
    hasMore: false,
    inputTokens: 0,
    isIncremental: false,
    maxMessageId: 0,
    outputTokens: 0,
    permissionMode: "acceptEdits",
    accessMode: "default",
    resumable: false,
    sessionDbId: 1,
    status: "idle",
    wasCompacted: false,
    ...overrides,
  };
}

describe("persistedSessionToLifecycle", () => {
  it("treats empty pre-prompt paused snapshots as idle", () => {
    expect(persistedSessionToLifecycle(session({ status: "paused" }))).toEqual({
      phase: "idle",
    });
  });

  it("keeps real paused sessions paused when they have history or runtime state", () => {
    expect(
      persistedSessionToLifecycle(
        session({
          status: "paused",
          blocks: [{ id: "msg-1", type: "text", content: "hello" }],
        }),
      ),
    ).toEqual({ phase: "paused", reason: "user" });
    expect(
      persistedSessionToLifecycle(session({ status: "waiting", runtimeSessionId: "runtime-1" })),
    ).toEqual({ phase: "paused", reason: "user" });
  });

  it("keeps stale running snapshots idle unless a caller needs an active seed", () => {
    expect(persistedSessionToLifecycle(session({ status: "running" }))).toEqual({
      phase: "idle",
    });
    expect(
      persistedSessionToLifecycle(session({ status: "running" }), { runningStatus: "active" }),
    ).toEqual({ phase: "active" });
  });

  it("lets pending user-input gates win over placeholder detection", () => {
    expect(
      persistedSessionToLifecycle(
        session({
          status: "paused",
          pendingQuestions: { question: "Continue?" },
        }),
      ),
    ).toEqual({ phase: "paused", reason: "question" });
    expect(
      persistedSessionToLifecycle(
        session({
          status: "paused",
          pendingPermission: { request_id: "perm-1" },
        }),
      ),
    ).toEqual({ phase: "paused", reason: "permission" });
  });
});

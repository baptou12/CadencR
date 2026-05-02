import { describe, expect, it, vi } from "vitest";
import { toast } from "sonner";

import type { AgentBlockData } from "@/components/AgentBlock";
import { handleEnvelope, type StoreAccessors } from "./ws-envelope-handler";
import { createSessionEntry, type SessionEntry, type WsSessionStore } from "./ws-session-types";
import { transitionTurn } from "./ws-turn-lifecycle";

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

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

function makeTaskBlock(toolUseId: string): AgentBlockData {
  return {
    id: `block-${toolUseId}`,
    type: "tool_call",
    content: "",
    toolName: "Task",
    toolUseId,
    childBlocks: [],
    taskComplete: false,
  };
}

describe("handleEnvelope turn_complete", () => {
  it("marks every active subtask stream complete", () => {
    const session = createSessionEntry();
    const taskA = makeTaskBlock("task-a");
    const taskB = makeTaskBlock("task-b");

    session.blocks = [taskA, taskB];
    session.lifecycle = transitionTurn(session.lifecycle, { type: "prompt_sent" });
    session.streamingState.toolUseIdToBlock.set("task-a", taskA);
    session.streamingState.toolUseIdToBlock.set("task-b", taskB);
    session.streamingState.streams.set("child-a", {
      model: null,
      contentBlockIds: new Map(),
      parentToolUseId: "task-a",
    });
    session.streamingState.streams.set("child-b", {
      model: null,
      contentBlockIds: new Map(),
      parentToolUseId: "task-b",
    });

    const ctx = createTestContext(session);

    handleEnvelope(ctx, "s1", {
      domain: "session",
      action: "turn_complete",
      payload: {},
    });

    const updated = ctx.getSession("s1");
    expect(updated.lifecycle).toEqual({ phase: "terminal", reason: "completed" });
    expect(updated.blocks[0].taskComplete).toBe(true);
    expect(updated.blocks[1].taskComplete).toBe(true);
    for (const stream of updated.streamingState.streams.values()) {
      expect(stream.parentToolUseId).toBeNull();
    }
  });
});

describe("handleEnvelope mode.changed", () => {
  it("accepts a mode that exists in the active provider's catalog", () => {
    const session = createSessionEntry();
    session.currentProviderId = "claude_code";
    session.permissionMode = "acceptEdits";
    const ctx = createTestContext(session);

    handleEnvelope(ctx, "s1", {
      domain: "session",
      action: "mode.changed",
      payload: { mode: "auto" },
    });

    expect(ctx.getSession("s1").permissionMode).toBe("auto");
  });

  it("drops a mode the active provider doesn't support (stale FE catalog guard)", () => {
    const session = createSessionEntry();
    // OpenCode has no `auto` mode — the backend would reject it via
    // MODE_NOT_SUPPORTED, but if a stale envelope reaches us we still must
    // not poison the chip state.
    session.currentProviderId = "opencode";
    session.permissionMode = "acceptEdits";
    const ctx = createTestContext(session);

    handleEnvelope(ctx, "s1", {
      domain: "session",
      action: "mode.changed",
      payload: { mode: "auto" },
    });

    expect(ctx.getSession("s1").permissionMode).toBe("acceptEdits");
  });
});

describe("handleEnvelope provider.set.ok", () => {
  it("updates provider state but does NOT touch permissionMode (mode.changed follows)", () => {
    const session = createSessionEntry();
    session.currentProviderId = "claude_code";
    session.permissionMode = "plan";
    const ctx = createTestContext(session);

    handleEnvelope(ctx, "s1", {
      domain: "session",
      action: "provider.set.ok",
      payload: { provider: "codex_cli" },
    });

    const updated = ctx.getSession("s1");
    expect(updated.currentProviderId).toBe("codex_cli");
    expect(updated.runtimeProvider).toBe("codex_cli");
    // No optimistic update — the chip stays on the old mode until the backend
    // emits a `mode.changed` envelope as the second half of the provider switch.
    expect(updated.permissionMode).toBe("plan");
  });

  it("subsequent mode.changed from the backend lands the chip on the new provider's default", () => {
    const session = createSessionEntry();
    session.currentProviderId = "claude_code";
    session.permissionMode = "plan";
    const ctx = createTestContext(session);

    handleEnvelope(ctx, "s1", {
      domain: "session",
      action: "provider.set.ok",
      payload: { provider: "codex_cli" },
    });
    handleEnvelope(ctx, "s1", {
      domain: "session",
      action: "mode.changed",
      payload: { mode: "default" },
    });

    expect(ctx.getSession("s1").permissionMode).toBe("default");
  });
});

describe("handleEnvelope error handling", () => {
  it("routes MODE_NOT_SUPPORTED to a toast and leaves the agent stream untouched", () => {
    vi.mocked(toast.error).mockClear();
    const session = createSessionEntry();
    session.lifecycle = { phase: "idle" } as SessionEntry["lifecycle"];
    const ctx = createTestContext(session);

    handleEnvelope(ctx, "s1", {
      domain: "session",
      action: "error",
      payload: {
        code: "MODE_NOT_SUPPORTED",
        message: "Provider opencode does not support permission mode auto",
      },
    });

    expect(toast.error).toHaveBeenCalledWith(
      "Provider opencode does not support permission mode auto",
    );
    const updated = ctx.getSession("s1");
    // Lifecycle untouched (no turn was active) and no error block injected.
    expect(updated.lifecycle).toEqual({ phase: "idle" });
    expect(updated.blocks).toHaveLength(0);
  });

  it("falls back to the inline error block for ordinary errors", () => {
    vi.mocked(toast.error).mockClear();
    const session = createSessionEntry();
    const ctx = createTestContext(session);

    handleEnvelope(ctx, "s1", {
      domain: "session",
      action: "error",
      payload: { code: "SDK_ERROR", message: "SDK exploded" },
    });

    expect(toast.error).not.toHaveBeenCalled();
    const updated = ctx.getSession("s1");
    expect(updated.blocks.some((b) => b.isError)).toBe(true);
  });
});

import { describe, expect, it } from "vitest";

import type { AgentBlockData } from "@/components/AgentBlock";
import { handleEnvelope, type StoreAccessors } from "./ws-envelope-handler";
import { createSessionEntry, type SessionEntry, type WsSessionStore } from "./ws-session-types";
import { transitionTurn } from "./ws-turn-lifecycle";

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

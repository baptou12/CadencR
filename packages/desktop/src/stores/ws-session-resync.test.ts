import { describe, expect, it, vi, beforeEach } from "vitest";
import type { AgentBlockData } from "@/components/AgentBlock";
import { createSessionEntry, type SessionEntry, type WsSessionStore } from "./ws-session-types";
import { repairPersistedBlocksAfterTurn, resyncMessagesOnReconnect } from "./ws-session-resync";
import type { StoreAccessors } from "./ws-envelope-handler";

const apiMocks = vi.hoisted(() => ({
  getFeatureAgentState: vi.fn(),
}));

vi.mock("@/api/generated", () => ({
  getFeatureAgentState: apiMocks.getFeatureAgentState,
}));

vi.mock("@/hooks/useFeatureAgentState", () => ({
  serverBlocksToAgentBlocks: (blocks: AgentBlockData[]) => blocks,
}));

function makeBlock(id: string, content: string): AgentBlockData {
  return { id, type: "text", content };
}

function createCtx(session: SessionEntry): StoreAccessors {
  let state = { sessions: { s1: session } } as unknown as WsSessionStore;
  return {
    get: () => state,
    set: (partial: Partial<WsSessionStore>) => {
      state = { ...state, ...partial } as WsSessionStore;
    },
    getSession: (sessionId: string) => state.sessions[sessionId],
  };
}

function createSession(
  blocks: AgentBlockData[],
  lastAppliedMessageId: number | null,
): SessionEntry {
  return {
    ...createSessionEntry(),
    blocks,
    featureId: 1077,
    sessionDbId: 2586,
    lastAppliedMessageId,
  };
}

describe("resyncMessagesOnReconnect", () => {
  beforeEach(() => {
    apiMocks.getFeatureAgentState.mockReset();
  });

  it("appends messages that streamed while the socket was disconnected", async () => {
    const ctx = createCtx(createSession([makeBlock("msg-10", "before sleep")], 10));
    apiMocks.getFeatureAgentState.mockResolvedValue({
      sessions: [
        {
          sessionDbId: 2586,
          blocks: [makeBlock("msg-11", "during sleep"), makeBlock("msg-12", "more")],
          maxMessageId: 12,
        },
      ],
    });

    await resyncMessagesOnReconnect(ctx, "s1");

    const session = ctx.get().sessions.s1;
    expect(session.blocks.map((b) => b.id)).toEqual(["msg-10", "msg-11", "msg-12"]);
    expect(session.lastAppliedMessageId).toBe(12);
    // Cursor is derived from the newest block we already hold.
    expect(apiMocks.getFeatureAgentState).toHaveBeenCalledWith(1077, {
      after: JSON.stringify({ 2586: 10 }),
    });
  });

  it("de-dupes messages already received live (no duplicates, advances cursor)", async () => {
    // A live message (msg-11) advanced the blocks past lastAppliedMessageId.
    const ctx = createCtx(
      createSession([makeBlock("msg-10", "a"), makeBlock("msg-11", "live")], 10),
    );
    apiMocks.getFeatureAgentState.mockResolvedValue({
      sessions: [{ sessionDbId: 2586, blocks: [makeBlock("msg-11", "live")], maxMessageId: 11 }],
    });

    await resyncMessagesOnReconnect(ctx, "s1");

    const session = ctx.get().sessions.s1;
    expect(session.blocks.map((b) => b.id)).toEqual(["msg-10", "msg-11"]);
    expect(session.lastAppliedMessageId).toBe(11);
    // Cursor anchored to the newest block (msg-11), not the stale cursor (10).
    expect(apiMocks.getFeatureAgentState).toHaveBeenCalledWith(1077, {
      after: JSON.stringify({ 2586: 11 }),
    });
  });

  it("is a no-op before the initial load supplies a cursor", async () => {
    const ctx = createCtx(createSession([], null));
    await resyncMessagesOnReconnect(ctx, "s1");
    expect(apiMocks.getFeatureAgentState).not.toHaveBeenCalled();
  });
});

describe("repairPersistedBlocksAfterTurn", () => {
  beforeEach(() => {
    apiMocks.getFeatureAgentState.mockReset();
  });

  function taskWithChildren(childIds: string[]): AgentBlockData {
    return {
      ...makeBlock("msg-1", ""),
      type: "tool_call",
      childBlocks: childIds.map((id) => ({ ...makeBlock(id, id), type: "tool_call" as const })),
    };
  }

  it("grafts a nested server child that was lost from the middle, in server order", async () => {
    // Client holds [child-a, child-c]; the middle child (child-b) streamed while
    // its `content_block_start` was lost. It must be re-inserted at position 1,
    // not appended at the end — child order is display order.
    const ctx = createCtx(createSession([taskWithChildren(["child-a", "child-c"])], 1));
    apiMocks.getFeatureAgentState.mockResolvedValue({
      sessions: [
        {
          sessionDbId: 2586,
          blocks: [taskWithChildren(["child-a", "child-b", "child-c"])],
          maxMessageId: 1,
        },
      ],
    });

    await repairPersistedBlocksAfterTurn(ctx, "s1");

    const repairedParent = ctx.get().sessions.s1.blocks[0];
    expect(repairedParent.childBlocks?.map((c) => c.id)).toEqual(["child-a", "child-b", "child-c"]);
  });
});

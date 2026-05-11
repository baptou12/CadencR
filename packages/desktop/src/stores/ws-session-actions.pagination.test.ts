import { describe, expect, it, vi, beforeEach } from "vitest";
import type { AgentBlockData } from "@/components/AgentBlock";
import { createSessionEntry, type SessionEntry, type WsSessionStore } from "./ws-session-types";
import { applyPersistedState, loadOlderSessionMessages } from "./ws-session-actions";
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

function makeBlock(
  id: string,
  content: string,
  type: AgentBlockData["type"] = "text",
  extra: Partial<AgentBlockData> = {},
): AgentBlockData {
  return { id, type, content, ...extra };
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

function createPaginationSession(blocks: AgentBlockData[]): SessionEntry {
  return {
    ...createSessionEntry(),
    blocks,
    hasMore: true,
    oldestMessageId: 200,
    featureId: 1077,
    sessionDbId: 2586,
    historyPrependDisplayOffset: 5,
  };
}

describe("ws session history pagination", () => {
  beforeEach(() => {
    apiMocks.getFeatureAgentState.mockReset();
  });

  it("increments historyPrependDisplayOffset by rendered display rows, not raw blocks", async () => {
    const currentBlocks = [
      makeBlock("current", "Current", "text", {
        createdAt: "2026-05-05T10:00:00Z",
        model: "claude-sonnet-4-6",
      }),
    ];
    const olderBlocks = [
      makeBlock("hidden", "hidden tool output", "tool_result", { sourceToolName: "Read" }),
      makeBlock("older-a", "Older ", "text", {
        createdAt: "2026-05-05T09:00:00Z",
        model: "gpt-5.5",
      }),
      makeBlock("older-b", "chunk", "text", {
        createdAt: "2026-05-05T09:00:00Z",
        model: "gpt-5.5",
      }),
    ];
    const ctx = createCtx(createPaginationSession(currentBlocks));
    apiMocks.getFeatureAgentState.mockResolvedValue({
      sessions: [
        {
          sessionDbId: 2586,
          blocks: olderBlocks,
          hasMore: false,
          oldestMessageId: 100,
        },
      ],
    });

    await loadOlderSessionMessages(ctx, "s1");

    const session = ctx.get().sessions.s1;
    expect(session.historyPrependDisplayOffset).toBe(7);
    expect(session.blocks.map((block) => block.id)).toEqual([
      "hidden",
      "older-a",
      "older-b",
      "current",
    ]);
  });

  it("resets historyPrependDisplayOffset when persisted state replaces a session", () => {
    const ctx = createCtx(createPaginationSession([makeBlock("current", "Current")]));

    applyPersistedState(
      ctx,
      "s1",
      {
        blocks: [],
        lifecycle: { phase: "idle" },
      },
      "plan-restore:",
    );

    expect(ctx.get().sessions.s1.historyPrependDisplayOffset).toBe(0);
  });
});

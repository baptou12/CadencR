/**
 * Tests for insertAgentSession helper — ensures .started events
 * create agent entries while preserving blocks from earlier events.
 */

import { describe, it, expect, vi } from "vitest";
import { insertAgentSession, createAgentSession } from "./agent-event-handlers";
import type { AgentSessionState } from "@/types/workflow";
import type { AgentBlockData } from "@/components/AgentBlock";

vi.mock("@/stores/ws-session-store", () => ({
  createStreamingState: () => ({
    activeTextIndex: null,
    activeThinkingIndex: null,
    toolCalls: new Map(),
  }),
  processSdkMessage: () => [],
  applyMutations: () => [],
}));

function makeState(entries: [string, Partial<AgentSessionState>][] = []) {
  const agents = new Map<string, AgentSessionState>();
  for (const [key, partial] of entries) {
    agents.set(key, { ...createAgentSession(0), ...partial });
  }
  return { agents };
}

describe("insertAgentSession", () => {
  it("creates a new agent when none exists", () => {
    const state = makeState();
    const result = insertAgentSession(state, "risk:42", 42, "risk");
    const agent = result.agents.get("risk:42");
    expect(agent).toBeDefined();
    expect(agent!.sessionId).toBe(42);
    expect(agent!.agentType).toBe("risk");
    expect(agent!.blocks).toEqual([]);
    expect(agent!.status).toBe("running");
  });

  it("preserves existing blocks when agent entry already exists", () => {
    const existingBlocks = [
      {
        id: "ws-user-1",
        type: "user_message" as const,
        content: "hello",
        isError: false,
        createdAt: "2024-01-01",
      },
    ] as AgentBlockData[];
    const state = makeState([
      ["risk:42", { sessionId: 0, agentType: "risk", blocks: existingBlocks }],
    ]);

    const result = insertAgentSession(state, "risk:42", 42, "risk");
    const agent = result.agents.get("risk:42");
    expect(agent!.sessionId).toBe(42);
    expect(agent!.blocks).toEqual(existingBlocks);
  });

  it("resets non-block fields to fresh state even when entry exists", () => {
    const state = makeState([["retro:10", { sessionId: 0, agentType: "retro", status: "paused" }]]);

    const result = insertAgentSession(state, "retro:10", 10, "retro");
    const agent = result.agents.get("retro:10");
    expect(agent!.status).toBe("running");
    expect(agent!.sessionId).toBe(10);
  });

  it("does not mutate the original map", () => {
    const state = makeState();
    const result = insertAgentSession(state, "review-fixer:5", 5, "review-fixer");
    expect(result.agents).not.toBe(state.agents);
    expect(state.agents.size).toBe(0);
    expect(result.agents.size).toBe(1);
  });
});

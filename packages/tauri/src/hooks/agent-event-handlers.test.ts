/**
 * Tests for insertAgentSession helper — ensures .started events
 * create agent entries while preserving blocks from earlier events.
 */

import { describe, it, expect, vi } from "vitest";
import { insertAgentSession, createAgentSession, sessionDbKey } from "./agent-event-handlers";
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

function makeState(entries: [number, Partial<AgentSessionState>][] = []) {
  const activeAgents = new Map<number, AgentSessionState>();
  for (const [key, partial] of entries) {
    activeAgents.set(key, { ...createAgentSession(0), ...partial });
  }
  return { activeAgents };
}

describe("insertAgentSession", () => {
  it("creates a new agent when none exists", () => {
    const state = makeState();
    const result = insertAgentSession(state, 42, "risk");
    const key = sessionDbKey(42);
    const agent = result.activeAgents.get(key);
    expect(agent).toBeDefined();
    expect(agent!.sessionId).toBe(42);
    expect(agent!.agentType).toBe("risk");
    expect(agent!.blocks).toEqual([]);
    expect(agent!.status).toBe("running");
  });

  it("preserves existing blocks when agent entry already exists", () => {
    const existingBlocks = [
      { id: "ws-user-1", type: "user_message" as const, content: "hello", isError: false, createdAt: "2024-01-01" },
    ] as AgentBlockData[];
    const key = sessionDbKey(42);
    const state = makeState([[key, { sessionId: 0, agentType: "risk", blocks: existingBlocks }]]);

    const result = insertAgentSession(state, 42, "risk");
    const agent = result.activeAgents.get(key);
    expect(agent!.sessionId).toBe(42);
    expect(agent!.blocks).toEqual(existingBlocks);
  });

  it("resets non-block fields to fresh state even when entry exists", () => {
    const key = sessionDbKey(10);
    const state = makeState([[key, { sessionId: 0, agentType: "retro", status: "paused" }]]);

    const result = insertAgentSession(state, 10, "retro");
    const agent = result.activeAgents.get(key);
    expect(agent!.status).toBe("running");
    expect(agent!.sessionId).toBe(10);
  });

  it("does not mutate the original map", () => {
    const state = makeState();
    const result = insertAgentSession(state, 5, "review-fixer");
    expect(result.activeAgents).not.toBe(state.activeAgents);
    expect(state.activeAgents.size).toBe(0);
    expect(result.activeAgents.size).toBe(1);
  });
});

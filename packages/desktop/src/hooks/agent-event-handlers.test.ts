/**
 * Tests for insertAgentSession helper — ensures .started events
 * create agent entries while preserving blocks from earlier events.
 */

import { describe, it, expect, vi } from "vitest";
import { insertAgentSession, createAgentSession, handleAgentStream } from "./agent-event-handlers";
import type { AgentSessionState, WorkflowState } from "@/types/workflow";
import type { AgentBlockData } from "@/components/AgentBlock";

vi.mock("@/stores/ws-session-store", () => ({
  createStreamingState: () => ({
    activeTextIndex: null,
    activeThinkingIndex: null,
    toolCalls: new Map(),
  }),
  processSdkMessage: () => ({ mutations: [] }),
  applyMutations: () => [],
}));

function makeState(entries: [string, Partial<AgentSessionState>][] = []): {
  agents: Map<string, AgentSessionState>;
} {
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

describe("handleAgentStream", () => {
  it("adds workflow stream errors as visible agent blocks", () => {
    let state = makeState([["qi:7", { sessionId: 7, agentType: "execute" }]]) as WorkflowState;
    const set = (
      partial: Partial<WorkflowState> | ((current: WorkflowState) => Partial<WorkflowState>),
    ): void => {
      const patch = typeof partial === "function" ? partial(state) : partial;
      state = { ...state, ...patch };
    };

    handleAgentStream(
      {
        agent_slot: { type: "queue_item", id: 7 },
        session_id: 7,
        type: "error",
        error: "OpenCode stream failed",
      },
      set,
    );

    const agent = state.agents.get("qi:7");
    expect(agent?.status).toBe("error");
    expect(agent?.blocks).toHaveLength(1);
    expect(agent?.blocks[0]).toMatchObject({
      type: "text",
      content: "Error: OpenCode stream failed",
      isError: true,
    });
  });

  it("does not duplicate the same workflow stream error", () => {
    const existingError: AgentBlockData = {
      id: "existing-error",
      type: "text",
      content: "Error: OpenCode stream failed",
      isError: true,
    };
    let state = makeState([
      ["qi:7", { sessionId: 7, agentType: "execute", status: "running", blocks: [existingError] }],
    ]) as WorkflowState;
    const set = (
      partial: Partial<WorkflowState> | ((current: WorkflowState) => Partial<WorkflowState>),
    ): void => {
      const patch = typeof partial === "function" ? partial(state) : partial;
      state = { ...state, ...patch };
    };

    handleAgentStream(
      {
        agent_slot: { type: "queue_item", id: 7 },
        session_id: 7,
        type: "error",
        error: "OpenCode stream failed",
      },
      set,
    );

    const agent = state.agents.get("qi:7");
    expect(agent?.status).toBe("error");
    expect(agent?.blocks).toEqual([existingError]);
  });

  it("ignores malformed workflow stream errors without a session id", () => {
    let state = makeState() as WorkflowState;
    const set = (
      partial: Partial<WorkflowState> | ((current: WorkflowState) => Partial<WorkflowState>),
    ): void => {
      const patch = typeof partial === "function" ? partial(state) : partial;
      state = { ...state, ...patch };
    };

    handleAgentStream(
      {
        agent_slot: { type: "queue_item", id: 7 },
        type: "error",
        error: "OpenCode stream failed",
      },
      set,
    );

    expect(state.agents.size).toBe(0);
  });
});

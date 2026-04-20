import { describe, it, expect, vi } from "vitest";
import {
  createStreamingState,
  injectPlanIntoBlocks,
  processSdkMessage,
} from "./ws-message-processing";
import type { AgentBlockData } from "@/components/AgentBlock";

describe("injectPlanIntoBlocks", () => {
  const textBlock: AgentBlockData = { id: "1", type: "text", content: "hello" };

  function makePlanBlock(toolName: string, toolArgs?: string): AgentBlockData {
    return {
      id: "2",
      type: "tool_call",
      content: "",
      toolName,
      toolArgs: toolArgs ?? "{}",
    };
  }

  it("returns blocks unchanged when pendingPlanApproval is null", () => {
    const blocks = [textBlock, makePlanBlock("ExitPlanMode")];
    expect(injectPlanIntoBlocks(blocks, null)).toBe(blocks);
  });

  it("returns blocks unchanged when pendingPlanApproval has no plan", () => {
    const blocks = [textBlock, makePlanBlock("ExitPlanMode")];
    expect(injectPlanIntoBlocks(blocks, {})).toBe(blocks);
  });

  it("injects plan into ExitPlanMode block", () => {
    const blocks = [textBlock, makePlanBlock("ExitPlanMode")];
    const result = injectPlanIntoBlocks(blocks, { plan: "# My Plan" });
    expect(result).not.toBe(blocks);
    expect(JSON.parse(result[1].toolArgs!)).toEqual({ plan: "# My Plan" });
  });

  it("injects plan into __show_plan block", () => {
    const blocks = [textBlock, makePlanBlock("mcp__tool__show_plan")];
    const result = injectPlanIntoBlocks(blocks, { plan: "# Plan" });
    expect(JSON.parse(result[1].toolArgs!)).toEqual({ plan: "# Plan" });
  });

  it("injects plan into __show_prd block", () => {
    const blocks = [textBlock, makePlanBlock("mcp__tool__show_prd")];
    const result = injectPlanIntoBlocks(blocks, { plan: "# PRD" });
    expect(JSON.parse(result[1].toolArgs!)).toEqual({ plan: "# PRD" });
  });

  it("targets the last plan block when multiple exist", () => {
    const blocks = [
      makePlanBlock("ExitPlanMode", JSON.stringify({ plan: "old plan" })),
      textBlock,
      makePlanBlock("ExitPlanMode"),
    ];
    const result = injectPlanIntoBlocks(blocks, { plan: "new plan" });
    // First block already had plan, last block gets injected
    expect(JSON.parse(result[2].toolArgs!)).toEqual({ plan: "new plan" });
    // First block unchanged
    expect(result[0]).toBe(blocks[0]);
  });

  it("skips injection when plan already exists in toolArgs", () => {
    const blocks = [makePlanBlock("ExitPlanMode", JSON.stringify({ plan: "existing" }))];
    const result = injectPlanIntoBlocks(blocks, { plan: "new" });
    expect(result).toBe(blocks);
  });

  it("returns blocks unchanged when no plan tool_call found", () => {
    const blocks = [textBlock, { id: "3", type: "tool_call" as const, content: "", toolName: "Write" }];
    const result = injectPlanIntoBlocks(blocks, { plan: "# Plan" });
    expect(result).toBe(blocks);
  });

  it("handles malformed toolArgs gracefully", () => {
    const blocks = [makePlanBlock("ExitPlanMode", "not valid json")];
    const result = injectPlanIntoBlocks(blocks, { plan: "# Plan" });
    expect(result).toBe(blocks);
  });
});

describe("processSdkMessage – system messages", () => {
  it("logs every system message with [AGENT-SYSTEM] prefix", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const state = createStreamingState();
    try {
      processSdkMessage(
        { type: "system", subtype: "init", session_id: "s1" },
        state,
      );
      expect(info).toHaveBeenCalled();
      const [prefix, payload] = info.mock.calls[0];
      expect(prefix).toBe("[AGENT-SYSTEM] init");
      expect(payload).toMatchObject({ type: "system", subtype: "init" });
    } finally {
      info.mockRestore();
    }
  });

  it("emits a compact_divider append + compactBoundaryObserved signal", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const state = createStreamingState();
    try {
      const result = processSdkMessage(
        {
          type: "system",
          subtype: "compact_boundary",
          session_id: "s1",
          compact_metadata: { trigger: "auto", pre_tokens: 90000 },
        },
        state,
      );
      expect(result.signals.compactBoundaryObserved).toBe(true);
      expect(result.mutations).toHaveLength(1);
      const mutation = result.mutations[0];
      expect(mutation.action).toBe("append");
      expect(mutation.block.type).toBe("compact_divider");
      expect(mutation.block.content).toContain("\"trigger\":\"auto\"");
    } finally {
      info.mockRestore();
    }
  });

  it("emits no mutation for non-compact system subtypes", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const state = createStreamingState();
    try {
      const result = processSdkMessage(
        { type: "system", subtype: "init", session_id: "s1" },
        state,
      );
      expect(result.mutations).toHaveLength(0);
      expect(result.signals.compactBoundaryObserved).toBe(false);
    } finally {
      info.mockRestore();
    }
  });
});

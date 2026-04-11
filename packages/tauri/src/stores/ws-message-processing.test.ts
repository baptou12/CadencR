import { describe, it, expect } from "vitest";
import { injectPlanIntoBlocks } from "./ws-message-processing";
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

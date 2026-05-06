import { describe, expect, it } from "vitest";
import { markLastPlanBlock } from "./ws-session-types";
import type { AgentBlockData } from "@/components/AgentBlock";

describe("markLastPlanBlock", () => {
  it("marks show_prd blocks as approval blocks", () => {
    const blocks: AgentBlockData[] = [
      {
        id: "prd",
        type: "tool_call",
        content: "",
        toolName: "mcp__cadencr-prd__show_prd",
      },
    ];

    expect(markLastPlanBlock(blocks, "approved")[0].planApprovalStatus).toBe("approved");
  });
});

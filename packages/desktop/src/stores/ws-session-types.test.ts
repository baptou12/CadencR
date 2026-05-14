import { describe, expect, it } from "vitest";
import { markLastPlanBlock } from "./ws-session-types";
import type { AgentBlockData } from "@/components/AgentBlock";

describe("markLastPlanBlock", () => {
  it("marks ExitPlanMode blocks as approval blocks", () => {
    const blocks: AgentBlockData[] = [
      {
        id: "plan",
        type: "tool_call",
        content: "",
        toolName: "ExitPlanMode",
      },
    ];

    expect(markLastPlanBlock(blocks, "approved")[0].planApprovalStatus).toBe("approved");
  });
});

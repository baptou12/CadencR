import { describe, expect, it } from "vitest";
import type { AgentBlockData } from "@/components/AgentBlock";
import { mergeToolContent } from "./ws-tool-content";

describe("mergeToolContent", () => {
  it("appends Bash output delta patches without cumulative snapshots", () => {
    const previous = JSON.stringify({ command: "printf hi", status: "running" });
    const block: AgentBlockData = {
      id: "bash-1",
      type: "tool_call",
      content: previous,
      toolName: "Bash",
      toolArgs: previous,
      toolUseId: "tu-bash-1",
    };

    const first = mergeToolContent(
      block,
      JSON.stringify({ __cadencr_output_delta: "hi" }),
      "update",
    );
    const second = mergeToolContent(
      { ...block, content: first, toolArgs: first },
      JSON.stringify({ __cadencr_output_delta: " there" }),
      "update",
    );

    expect(JSON.parse(second)).toEqual({
      command: "printf hi",
      status: "running",
      output: "hi there",
    });
  });
});
